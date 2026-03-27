"""
WebSocket handler para transcripción en tiempo real.
Recibe audio del cliente, lo reenvía a Deepgram, y retorna texto transcrito.
Graba el audio en WAV en paralelo.
Multi-usuario: exige token en query ?token=JWT y que el usuario pueda acceder a la audiencia.
"""
import asyncio
import base64
import json
import logging
import os
import uuid
import wave
import urllib.parse
from datetime import datetime

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import async_session
from app.models.audiencia import Audiencia
from app.models.segmento import Segmento
from app.models.usuario import Usuario
from app.services.auth_service import decode_token, get_user_by_id
from app.services.deepgram_streaming import DeepgramStreamingService
from app.services.real_time_enhancement import get_enhancement_service
from app.services.text_processing import detect_question, clean_transcript, preprocess_raw_transcript

logger = logging.getLogger(__name__)

# Active sessions: audiencia_id → session data
active_sessions: dict[str, dict] = {}


DEMO_AUDIENCIA_ID = "00000000-0000-0000-0000-000000000000"


def _puede_acceder_audiencia(audiencia: Audiencia, usuario: Usuario) -> bool:
    if usuario.rol in ("admin", "supervisor"):
        return True
    # La audiencia DEMO es accesible para cualquier usuario autenticado y activo
    if str(audiencia.id) == DEMO_AUDIENCIA_ID:
        return True
    return audiencia.created_by == usuario.id


async def transcription_websocket(websocket: WebSocket, audiencia_id: str):
    """
    WebSocket endpoint for real-time transcription.
    Query param: token (JWT). Si falta o es inválido, o el usuario no puede acceder a la audiencia, se cierra.

    En producción (Traefik/nginx): configurar timeout largo para esta ruta (ej. 3600s)
    para que grabaciones largas no se corten por timeout del proxy.
    """
    await websocket.accept()

    query_string = websocket.scope.get("query_string", b"").decode()
    params = urllib.parse.parse_qs(query_string)
    token_list = params.get("token", [])
    token = token_list[0] if token_list else None

    if not token:
        await websocket.close(code=4401, reason="Token requerido")
        return

    token_data = decode_token(token)
    if token_data is None or token_data.user_id is None:
        await websocket.close(code=4401, reason="Token inválido o expirado")
        return

    async with async_session() as db:
        user = await get_user_by_id(db, token_data.user_id)
        if user is None or not user.activo:
            await websocket.close(code=4401, reason="Usuario no encontrado o inactivo")
            return
        try:
            aid = uuid.UUID(audiencia_id)
        except ValueError:
            await websocket.close(code=4404, reason="Audiencia no encontrada")
            return
        result = await db.execute(select(Audiencia).where(Audiencia.id == aid))
        audiencia = result.scalar_one_or_none()
        if audiencia is None:
            await websocket.close(code=4404, reason="Audiencia no encontrada")
            return
        if not _puede_acceder_audiencia(audiencia, user):
            await websocket.close(code=4403, reason="Sin permiso para esta audiencia")
            return

    # ── Guard: una sola sesión activa por audiencia ──────────────────────────
    # Si ya hay una sesión para esta audiencia, rechazar la nueva conexión.
    # En uso judicial solo un digitador transcribe cada audiencia a la vez.
    if audiencia_id in active_sessions:
        logger.warning(f"Conexión rechazada — audiencia {audiencia_id} ya tiene sesión activa")
        await websocket.close(code=4409, reason="Audiencia ya tiene una sesión de transcripción activa")
        return

    logger.info(f"WebSocket connected for audiencia: {audiencia_id}")

    # Audio recording: nombre único por sesión (evita colisión si hubiera dos intentos)
    audio_dir = settings.AUDIO_STORAGE_PATH
    os.makedirs(audio_dir, exist_ok=True)
    session_short_id = str(uuid.uuid4())[:8]
    audio_path = os.path.join(audio_dir, f"{audiencia_id}_{session_short_id}.wav")

    # WAV: 1 canal, 16 bits, 16000 Hz (coincide con lo que envía el frontend)
    audio_file = wave.open(audio_path, "wb")
    audio_file.setnchannels(1)
    audio_file.setsampwidth(2)
    audio_file.setframerate(16000)

    segment_counter = 0
    session_state = {"claude_total": 0.0}
    pending_tasks = set()
    enhancement_service = get_enhancement_service()
    previous_segments = []  # Contexto para mejoramiento
    
    # Buffer de consolidación - acumula segmentos del mismo speaker hasta completar frase
    consolidation_buffer = {
        "speaker_id": None,
        "segments": [],  # Lista de textos parciales
        "timestamps": [],  # Start/end de cada segmento
        "words": [],  # Todas las palabras acumuladas
        "last_check_length": 0,  # Para evitar chequeos repetitivos
        "intermediate_ids": [],  # IDs de segmentos intermedios enviados al frontend
    }
    
    # Palabras que indican frase incompleta (conectores, preposiciones)
    INCOMPLETE_ENDINGS = [
        "que", "para", "y", "o", "si", "pero", "cuando", "porque",
        "a", "de", "con", "en", "por", "sin", "sobre", "hasta",
        "desde", "hacia", "ante", "bajo", "según", "mediante",
        "durante", "como", "cual", "cuales", "quien", "quienes",
        "donde", "adonde", "el", "la", "los", "las", "un", "una",
        "unos", "unas", "este", "esta", "estos", "estas", "ese",
        "esa", "esos", "esas", "aquel", "aquella", "aquellos", "aquellas"
    ]

    # Respuestas cortas VÁLIDAS en contexto judicial (no requieren continuación)
    COMPLETE_SHORT_RESPONSES = {
        # Afirmaciones/negaciones
        "sí", "si", "no", "correcto", "exacto", "afirmativo", "negativo",
        # Respuestas procesales
        "niego", "afirmo", "consiento", "me opongo", "acepto", "rechazo",
        "de acuerdo", "conforme", "me acojo", "me allano", "desisto",
        # Juramentaciones
        "lo juro", "sí juro", "prometo decir la verdad",
        # Identificaciones
        "presente", "ausente", "notificado",
        # Confirmaciones de entendimiento
        "entendido", "comprendido", "así es", "efectivamente",
        # Solicitudes breves
        "protesto", "objeción", "reservo", "me reservo",
    }

    def _is_incomplete_by_pattern(text: str) -> bool:
        """Determina si el texto parece incompleto por patrones simples."""
        if not text or not text.strip():
            return False

        clean_text = text.strip().lower()
        words = clean_text.split()
        if not words:
            return False

        # Verificar si es una respuesta corta válida (completa por definición)
        if clean_text.rstrip('.,;:!?') in COMPLETE_SHORT_RESPONSES:
            return False  # Está completa, no es incompleta

        last_word = words[-1].rstrip('.,;:!?')

        # Termina en palabra conectora
        if last_word in INCOMPLETE_ENDINGS:
            return True

        # Si tiene puntuación final, está completa
        if text.strip()[-1] in '.?!':
            return False

        # Sprint 6: No considerar como "incompleta" frases muy cortas;
        # se procesarán rápido vía el flujo intermedio
        if len(words) < 5:
            return True

        # No termina en puntuación y tiene entre 5-15 palabras
        if len(words) >= 5 and len(words) <= 15:
            return True

        # Más de 15 palabras sin puntuación → probablemente completa
        return False

    async def _send_intermediate_segment(text: str, speaker_id: str, start: float, end: float, words: list):
        """
        Envía un segmento intermedio al frontend que se muestra INMEDIATAMENTE
        como texto visible (no provisional/sombra). Se usa el mismo esquema que
        is_final=true pero con un flag 'intermediate' para que el frontend sepa
        que podría ser reemplazado por una versión mejorada.
        """
        nonlocal segment_counter
        
        segment_id = uuid.uuid4()
        segment_counter += 1
        
        # Guardar el ID para poder reemplazarlo después
        consolidation_buffer["intermediate_ids"].append(str(segment_id))
        
        logger.info(f"[DIAG] Sending _send_intermediate_segment: {len(words)} words, id={segment_id}")
        
        # Preprocesar artefactos de ASR (repeticiones dobles/triples) y luego limpiar
        text = clean_transcript(preprocess_raw_transcript(text))
        
        result_to_send = {
            "type": "transcript",
            "segment_id": str(segment_id),
            "is_final": True,  # True para que el frontend lo muestre como texto sólido
            "is_intermediate": True,  # Flag para indicar que podría ser reemplazado
            "speaker": speaker_id,
            "text": text,
            "texto_mejorado": None,  # Sin mejora de Claude aún
            "confidence": sum(w.get("confidence", 1.0) for w in words) / len(words) if words else 1.0,
            "start": start,
            "end": end,
            "words": words,
        }
        
        await websocket.send_json(result_to_send)
        logger.info(f"[INTERMEDIATE] Sent segment '{text[:50]}...' as visible text (id={segment_id})")
        
        # Guardar en DB como segmento temporal
        try:
            async with async_session() as db:
                segmento = Segmento(
                    id=segment_id,
                    audiencia_id=uuid.UUID(audiencia_id),
                    speaker_id=speaker_id,
                    texto_ia=text,
                    timestamp_inicio=start,
                    timestamp_fin=end,
                    confianza=result_to_send["confidence"],
                    es_provisional=False,
                    fuente="streaming",
                    orden=segment_counter,
                    palabras_json=words,
                )
                db.add(segmento)
                await db.commit()
        except Exception as db_err:
            logger.debug(f"Intermediate segment not persisted: {db_err}")
        
        return str(segment_id)

    async def _process_consolidated_segment(buffer_data: dict, current_segment_counter: int):
        """Procesa el buffer de consolidación como un único segmento mejorado sin bloquear."""
        nonlocal previous_segments

        if not buffer_data["segments"]:
            return

        # Texto completo consolidado — preprocesar para eliminar artefactos de ASR
        # antes de enviarlo a Claude (repeticiones, alucinaciones tipo "Port Port Port")
        consolidated_text = preprocess_raw_transcript(" ".join(buffer_data["segments"]))
        speaker_id = buffer_data["speaker_id"]
        start_time = buffer_data["timestamps"][0]["start"]
        end_time = buffer_data["timestamps"][-1]["end"]
        all_words = buffer_data["words"]
        intermediate_ids = buffer_data["intermediate_ids"]

        # Calcular confianza promedio
        avg_confidence = sum(w.get("confidence", 1.0) for w in all_words) / len(all_words) if all_words else 1.0

        # Notificar al frontend que Claude está mejorando estos segmentos
        try:
            await websocket.send_json({
                "type": "enhancing",
                "segment_ids": intermediate_ids,
            })
        except Exception:
            pass

        # Mejorar con Claude
        try:
            logger.info(f"🧠 [CLAUDE] Llamando enhance_segment con {len(consolidated_text)} chars...")
            enhancement = await enhancement_service.enhance_segment(
                text=consolidated_text,
                speaker_id=speaker_id,
                previous_segments=previous_segments,
                audiencia_id=audiencia_id,
            )
            logger.info(f"🧠 [CLAUDE] enhance_segment retornó: keys={list(enhancement.keys())}")
            
            texto_mejorado = enhancement["enhanced"]
            enhancement_confidence = enhancement["confidence"]
            is_question = enhancement["is_question"]
            usd_cost = enhancement.get("usd_cost", 0.0)
            
            logger.info(f"💰 [COSTO] usd_cost={usd_cost}, session_total_antes={session_state['claude_total']}")
            
            if usd_cost > 0.0:
                session_state["claude_total"] += usd_cost
                logger.info(f"💰 [COSTO] session_total_despues={session_state['claude_total']}")
                try:
                    cost_msg = {
                        "type": "cost_update",
                        "claude_usd": session_state["claude_total"]
                    }
                    logger.info(f"💰 [COSTO] Enviando al WS: {cost_msg}")
                    await websocket.send_json(cost_msg)
                    logger.info(f"💰 [COSTO] ✅ cost_update enviado exitosamente: ${session_state['claude_total']:.5f}")
                except Exception as ws_err:
                    logger.error(f"💰 [COSTO] ❌ Failed to send cost_update: {ws_err}")
            else:
                logger.warning(f"💰 [COSTO] ⚠️ usd_cost es 0.0 — Claude no reportó tokens?")

            logger.info(f"Enhanced [(+${usd_cost:.5f})]: '{consolidated_text[:50]}...' → '{texto_mejorado[:50]}...'")
            
        except Exception as enhance_err:
            logger.error(f"🧠 [CLAUDE] ❌ Enhancement failed: {enhance_err}", exc_info=True)
            texto_mejorado = clean_transcript(consolidated_text)
            enhancement_confidence = 0.0
            is_question = False
        
        # Actualizar contexto ANTES de enviar (para próximas decisiones)
        previous_segments.append({
            "speaker_id": speaker_id,
            "texto_ia": consolidated_text,
            "texto_mejorado": texto_mejorado,
        })
        
        if len(previous_segments) > 25:
            previous_segments.pop(0)

        # Siempre usar un UUID nuevo: el frontend detecta addedIds=[new_id] != oldIds
        # y activa el reemplazo localizado (con animación word-diff de Claude).
        # Reutilizar intermediate_ids[0] dejaba addedIds=[] → re-render completo.
        segment_id = uuid.uuid4()

        result_to_send = {
            "type": "transcript",
            "segment_id": str(segment_id),
            "is_final": True,
            "is_intermediate": False,
            "replaces": intermediate_ids,  # IDs de segmentos intermedios a reemplazar
            "speaker": speaker_id,
            "text": consolidated_text,
            "texto_mejorado": texto_mejorado,
            "is_question": is_question,
            "enhancement_confidence": enhancement_confidence,
            "confidence": avg_confidence,
            "start": start_time,
            "end": end_time,
            "words": all_words,
        }

        try:
            await websocket.send_json(result_to_send)
        except Exception:
            pass

        # Run legal dictionary check on the enhanced text
        try:
            from app.services.legal_dictionary import get_legal_dictionary
            dictionary = get_legal_dictionary()
            suggestions = dictionary.check_segment(texto_mejorado)

            for suggestion in suggestions:
                try:
                    await websocket.send_json({
                        "type": "suggestion",
                        "segment_order": current_segment_counter,
                        **suggestion.to_dict(),
                    })
                except Exception:
                    pass
        except Exception as dict_err:
            logger.debug(f"Dictionary check skipped: {dict_err}")

        # ── Paso 1: Guardar el segmento definitivo (nunca debe fallar) ──
        try:
            async with async_session() as db:
                segmento = Segmento(
                    id=segment_id,
                    audiencia_id=uuid.UUID(audiencia_id),
                    speaker_id=speaker_id,
                    texto_ia=consolidated_text,
                    texto_mejorado=texto_mejorado,
                    timestamp_inicio=start_time,
                    timestamp_fin=end_time,
                    confianza=avg_confidence,
                    es_provisional=False,
                    fuente="streaming",
                    orden=current_segment_counter,
                    palabras_json=all_words,
                )
                db.add(segmento)
                await db.commit()
                logger.info(f"✅ Segmento definitivo guardado: {segment_id} (texto_mejorado={'SÍ' if texto_mejorado else 'NO'})")
        except Exception as db_err:
            logger.error(f"❌ Error CRÍTICO guardando segmento definitivo {segment_id}: {db_err}", exc_info=True)

        # ── Paso 2: Eliminar segmentos intermedios con bulk DELETE ──
        # Usamos DELETE directo (sin ORM) para mayor robustez y atomicidad.
        if intermediate_ids:
            try:
                from sqlalchemy import delete as sql_delete
                uuids = [uuid.UUID(iid) for iid in intermediate_ids]
                async with async_session() as db:
                    await db.execute(
                        sql_delete(Segmento).where(Segmento.id.in_(uuids))
                    )
                    await db.commit()
                logger.info(f"🗑️ {len(intermediate_ids)} segmentos intermedios eliminados")
            except Exception as cleanup_err:
                logger.warning(f"⚠️ Error limpiando segmentos intermedios (no crítico): {cleanup_err}")

    def _trigger_consolidation():
        nonlocal segment_counter, consolidation_buffer
        if not consolidation_buffer["segments"]:
            return
            
        # Snapshot the buffer to process asynchronously
        buffer_copy = {
            "segments": list(consolidation_buffer["segments"]),
            "speaker_id": consolidation_buffer["speaker_id"],
            "timestamps": list(consolidation_buffer["timestamps"]),
            "words": list(consolidation_buffer["words"]),
            "intermediate_ids": list(consolidation_buffer["intermediate_ids"]),
        }
        
        # Adelantar el counter PRIMERO y usar el valor nuevo para el consolidado.
        # Si lo capturáramos antes del incremento, coincidiría con el último
        # intermedio (que también usó ese valor), causando duplicados de 'orden'
        # en la DB cuando el DELETE de intermedios falla.
        segment_counter += 1
        current_counter = segment_counter

        # Limpiar buffer inmediatamente
        consolidation_buffer["segments"] = []
        consolidation_buffer["timestamps"] = []
        consolidation_buffer["words"] = []
        consolidation_buffer["last_check_length"] = 0
        consolidation_buffer["intermediate_ids"] = []
        
        # Lanzar tarea en background y guardar referencia viva para esperarla al final de la sesion
        task = asyncio.create_task(_process_consolidated_segment(buffer_copy, current_counter))
        pending_tasks.add(task)
        task.add_done_callback(pending_tasks.discard)

    async def on_transcript(result: dict):
        """Callback invoked for each Deepgram transcript result."""
        nonlocal segment_counter, consolidation_buffer

        try:
            current_speaker = result["speaker"]
            is_final = result.get("is_final", False)

            # Enviar resultados provisionales de Deepgram (interim) al frontend
            if not is_final:
                logger.debug(f"[DIAG] Sending interim to frontend: {len(result.get('words', []))} words")
                await websocket.send_json(result)
                return

            # ── Resultado final de Deepgram ──
            # Cambio de speaker → consolidar buffer del speaker anterior con Claude
            if consolidation_buffer["speaker_id"] is not None and consolidation_buffer["speaker_id"] != current_speaker:
                if consolidation_buffer["segments"]:
                    logger.info(f"Speaker changed: {consolidation_buffer['speaker_id']} → {current_speaker}, triggering consolidation")
                    _trigger_consolidation()
                consolidation_buffer["speaker_id"] = current_speaker

            # Si es el primer segmento, establecer speaker
            if consolidation_buffer["speaker_id"] is None:
                consolidation_buffer["speaker_id"] = current_speaker

            # Agregar segmento actual al buffer para consolidación con Claude
            consolidation_buffer["segments"].append(result["text"])
            consolidation_buffer["timestamps"].append({
                "start": result["start"],
                "end": result["end"],
            })
            current_words = result.get("words", [])
            if current_words:
                consolidation_buffer["words"].extend(current_words)

            # ── Enviar INMEDIATAMENTE como segmento intermedio visible ──
            # El usuario ve texto sólido sin esperar a que la frase "parezca completa".
            # El texto provisional (gris) se elimina y reemplaza instantáneamente.
            await _send_intermediate_segment(
                text=result["text"],
                speaker_id=current_speaker,
                start=result["start"],
                end=result["end"],
                words=current_words,
            )

            # ── Decidir si Claude debe consolidar ahora ──
            # La consolidación principal ocurre en on_utterance_end (1000ms silencio).
            # Aquí solo disparamos en casos límite para no acumular infinito.
            buffer_text = " ".join(consolidation_buffer["segments"])
            word_count = len(buffer_text.split())
            # 1. Límite duro: > 50 palabras sin pausa detectada → consolidar ya
            if word_count > 50:
                logger.info(f"Triggering consolidation ({word_count} palabras): límite 50")
                _trigger_consolidation()
            # 2. El fragmento tiene puntuación final → oración completa segura
            elif result["text"].strip() and result["text"].strip()[-1] in '.?!':
                logger.info(f"Triggering consolidation: puntuación final detectada")
                _trigger_consolidation()

        except Exception as e:
            logger.error(f"Error processing transcript: {e}", exc_info=True)

    async def on_utterance_end(data: dict):
        """Deepgram signals natural end of utterance — trigger consolidation immediately.
        This gives the best segment boundaries since Deepgram's VAD detected silence.
        """
        try:
            if consolidation_buffer["segments"]:
                logger.info("UtteranceEnd: triggering consolidation (natural speech boundary)")
                _trigger_consolidation()

            await websocket.send_json({
                "type": "utterance_end",
                "timestamp": data.get("last_word_end", 0),
            })
        except Exception as e:
            logger.warning(f"on_utterance_end error: {e}")

    async def on_speech_started(data: dict):
        """Deepgram signals start of speech activity."""
        try:
            await websocket.send_json({
                "type": "speech_started",
                "timestamp": data.get("timestamp", 0),
            })
        except Exception:
            pass

    # Create Deepgram service
    dg_service = DeepgramStreamingService(
        on_transcript=on_transcript,
        on_utterance_end=on_utterance_end,
        on_speech_started=on_speech_started,
    )

    try:
        # Connect to Deepgram
        try:
            await dg_service.connect()
            logger.info(f"✅ Deepgram connection successful for audiencia: {audiencia_id}")
        except Exception as dg_err:
            logger.error(f"❌ Deepgram connection failed: {dg_err}", exc_info=True)
            await websocket.send_json({
                "type": "error",
                "message": f"Error conectando a Deepgram: {str(dg_err)}",
            })
            await websocket.close(code=4500, reason="Deepgram connection failed")
            return

        # Update audiencia status (skip if demo/non-existent)
        try:
            async with async_session() as db:
                result = await db.execute(
                    select(Audiencia).where(Audiencia.id == uuid.UUID(audiencia_id))
                )
                audiencia = result.scalar_one_or_none()
                if audiencia:
                    audiencia.estado = "en_curso"
                    audiencia.audio_path = audio_path
                    await db.commit()
        except (ValueError, Exception) as e:
            logger.info(f"Skipping DB update for audiencia {audiencia_id}: {e}")

        # Send connection status
        await websocket.send_json({
            "type": "status",
            "status": "connected",
            "message": "Conexión establecida con Deepgram Nova-3",
        })

        # Store in active sessions
        active_sessions[audiencia_id] = {
            "websocket": websocket,
            "deepgram": dg_service,
            "started_at": datetime.now(),
        }

        logger.info(f"[DIAG] Entrando al loop de recepción para audiencia: {audiencia_id}")
        # Main receive loop — get audio from client, forward to Deepgram
        while True:
            message = await websocket.receive_text()
            try:
                data = json.loads(message)
            except json.JSONDecodeError as e:
                logger.warning(f"WebSocket message no es JSON válido: {e}")
                continue

            msg_type = data.get("type")
            if msg_type == "audio_chunk":
                seq = data.get("sequence", 0)
                # Echo de diagnóstico: confirma al frontend que el backend recibió el chunk
                if seq <= 5:
                    logger.info(f"[DIAG] audio_chunk recibido seq={seq}, dg_running={dg_service.is_connected}")
                    await websocket.send_json({"type": "debug", "msg": f"backend recibio seq={seq}, dg_running={dg_service.is_connected}"})
                try:
                    payload = data.get("data")
                    if not payload:
                        logger.warning("audio_chunk sin campo 'data'")
                        continue
                    audio_bytes = base64.b64decode(payload)
                    logger.debug(f"audio_chunk decodificado: seq={seq}, bytes={len(audio_bytes)}")
                    try:
                        audio_file.writeframes(audio_bytes)
                    except Exception as wave_err:
                        logger.warning(f"Error escribiendo audio a disco: {wave_err}")
                    
                    await dg_service.send_audio(audio_bytes)
                except Exception as e:
                    logger.warning(f"Error procesando audio_chunk seq={seq}: {e}")
                    continue

            elif msg_type == "stop":
                logger.info(f"Transcription stopped for audiencia: {audiencia_id}")
                # Consolidar buffer pendiente antes de cerrar
                if consolidation_buffer["segments"]:
                    logger.info("Triggering final consolidation before stop...")
                    _trigger_consolidation()
                
                # Esperar a que TODAS las peticiones de Inteligencia Artificial de Claude
                # terminen de devolver el texto definitivo y el CÁLCULO DE COSTOS FINAL ANTES de
                # permitir a FastAPI DESTRUIR físicamente la conexión del Websocket al Front.
                if pending_tasks:
                    logger.info(f"Esperando {len(pending_tasks)} tareas de IA antes de cerrar websocket...")
                    await asyncio.gather(*pending_tasks, return_exceptions=True)
                break

    except WebSocketDisconnect as e:
        logger.info(f"WebSocket disconnected for audiencia: {audiencia_id} (code={getattr(e, 'code', '?')})")
        if consolidation_buffer["segments"]:
            try:
                _trigger_consolidation()
            except Exception:
                pass
        if pending_tasks:
            # Aunque se desconectó, no cerremos el bucle asíncrono the Python subyacente para no fallar el costo
            # y poder grabar al menos a la Base de Datos.
            await asyncio.gather(*pending_tasks, return_exceptions=True)
    except Exception as e:
        logger.error(f"WebSocket error for audiencia {audiencia_id}: {e}", exc_info=True)
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e),
            })
        except Exception:
            pass
    finally:
        # Cleanup
        await dg_service.close()
        audio_file.close()

        # Helper para la duración
        duracion_segundos = 0.0
        try:
            if os.path.exists(audio_path):
                # Calcular duración de un WAV de 16000Hz 16-bit Mono (32000 bytes/s)
                file_size = os.path.getsize(audio_path)
                duracion_segundos = max(0.0, (file_size - 44) / 32000)
        except Exception:
            pass

        # Guardar sesión: audio_path y estado "transcrita"
        try:
            aid = uuid.UUID(audiencia_id)
            async with async_session() as db:
                result = await db.execute(
                    select(Audiencia).where(Audiencia.id == aid)
                )
                audiencia = result.scalar_one_or_none()
                if audiencia:
                    if os.path.exists(audio_path):
                        audiencia.audio_path = audio_path
                    audiencia.estado = "transcrita"
                    audiencia.audio_duration_seconds = duracion_segundos
                    await db.commit()
                    logger.info(f"Sesión guardada: audiencia {audiencia_id} → transcrita (audio: {audio_path})")

                # Registrar costo Deepgram Streaming
                if duracion_segundos > 0:
                    try:
                        from app.services.cost_tracker import registrar_uso_deepgram
                        await registrar_uso_deepgram(
                            db=db,
                            servicio="deepgram_streaming",
                            modelo=settings.DEEPGRAM_MODEL,
                            duracion_segundos=duracion_segundos,
                            modo="streaming",
                            diarize=True,
                            audiencia_id=aid,
                            usuario_id=audiencia.created_by if audiencia else None,
                        )
                    except Exception as metric_err:
                        logger.error(f"Error registrando costo streaming: {metric_err}")

        except (ValueError, Exception) as e:
            logger.warning(f"No se pudo actualizar audiencia al cerrar sesión: {e}")

        # Remove from active sessions
        active_sessions.pop(audiencia_id, None)
        logger.info(f"Cleanup complete for audiencia: {audiencia_id}")
