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
from app.services.text_processing import detect_question

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

    logger.info(f"WebSocket connected for audiencia: {audiencia_id}")

    # Audio recording setup — guarda WebM tal como lo envía el navegador
    audio_dir = settings.AUDIO_STORAGE_PATH
    os.makedirs(audio_dir, exist_ok=True)
    audio_path = os.path.join(audio_dir, f"{audiencia_id}.webm")
    audio_file = open(audio_path, "wb")

    segment_counter = 0
    enhancement_service = get_enhancement_service()
    previous_segments = []  # Contexto para mejoramiento
    
    # Buffer de consolidación - acumula segmentos del mismo speaker hasta completar frase
    consolidation_buffer = {
        "speaker_id": None,
        "segments": [],  # Lista de textos parciales
        "timestamps": [],  # Start/end de cada segmento
        "words": [],  # Todas las palabras acumuladas
        "last_check_length": 0,  # Para evitar chequeos repetitivos
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

        # Sprint 6: No procesar como segmento final bloques de menos de 5 palabras
        # salvo respuestas cortas válidas (ya verificadas arriba)
        if len(words) < 5:
            # Si tiene 1-4 palabras y termina en puntuación, puede estar completa
            if text.strip()[-1] in '.?!':
                return False
            return True

        # No termina en puntuación (y no es muy corto)
        if len(words) >= 5 and not text.strip()[-1] in '.?!':
            # Pero si tiene más de 15 palabras sin puntuación, probablemente está completo
            if len(words) > 15:
                return False
            return True

        return False

    async def _process_consolidated_segment():
        """Procesa el buffer de consolidación como un único segmento mejorado."""
        nonlocal segment_counter, consolidation_buffer, previous_segments
        
        if not consolidation_buffer["segments"]:
            return
        
        # Texto completo consolidado
        consolidated_text = " ".join(consolidation_buffer["segments"])
        speaker_id = consolidation_buffer["speaker_id"]
        start_time = consolidation_buffer["timestamps"][0]["start"]
        end_time = consolidation_buffer["timestamps"][-1]["end"]
        all_words = consolidation_buffer["words"]
        
        # Calcular confianza promedio
        avg_confidence = sum(w.get("confidence", 1.0) for w in all_words) / len(all_words) if all_words else 1.0
        
        # Mejorar con Claude
        try:
            enhancement = await enhancement_service.enhance_segment(
                text=consolidated_text,
                speaker_id=speaker_id,
                previous_segments=previous_segments,
            )
            
            texto_mejorado = enhancement["enhanced"]
            enhancement_confidence = enhancement["confidence"]
            is_question = enhancement["is_question"]
            
            logger.info(f"Enhanced: '{consolidated_text[:50]}...' → '{texto_mejorado[:50]}...'")
            
        except Exception as enhance_err:
            logger.warning(f"Enhancement failed, using original: {enhance_err}")
            texto_mejorado = consolidated_text
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
        
        # Enviar segmento consolidado y mejorado al frontend
        segment_counter += 1
        result_to_send = {
            "type": "transcript",
            "is_final": True,
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
        
        await websocket.send_json(result_to_send)
        
        # Run legal dictionary check on the enhanced text
        try:
            from app.services.legal_dictionary import get_legal_dictionary
            dictionary = get_legal_dictionary()
            suggestions = dictionary.check_segment(texto_mejorado)
            
            for suggestion in suggestions:
                await websocket.send_json({
                    "type": "suggestion",
                    "segment_order": segment_counter,
                    **suggestion.to_dict(),
                })
        except Exception as dict_err:
            logger.debug(f"Dictionary check skipped: {dict_err}")
        
        # Guardar en base de datos
        try:
            async with async_session() as db:
                segmento = Segmento(
                    audiencia_id=uuid.UUID(audiencia_id),
                    speaker_id=speaker_id,
                    texto_ia=consolidated_text,
                    texto_mejorado=texto_mejorado,
                    timestamp_inicio=start_time,
                    timestamp_fin=end_time,
                    confianza=avg_confidence,
                    es_provisional=False,
                    fuente="streaming",
                    orden=segment_counter,
                    palabras_json=all_words,
                )
                db.add(segmento)
                await db.commit()
        except Exception as db_err:
            logger.debug(f"Segment not persisted (demo mode?): {db_err}")
        
        # Limpiar buffer completamente
        consolidation_buffer["speaker_id"] = speaker_id  # Mantener speaker
        consolidation_buffer["segments"] = []
        consolidation_buffer["timestamps"] = []
        consolidation_buffer["words"] = []
        consolidation_buffer["last_check_length"] = 0

    async def on_transcript(result: dict):
        """Callback invoked for each Deepgram transcript result."""
        nonlocal segment_counter, consolidation_buffer
        
        try:
            current_speaker = result["speaker"]
            is_final = result.get("is_final", False)
            
            # Enviar resultados provisionales al frontend sin modificar
            if not is_final:
                await websocket.send_json(result)
                return
            
            # Para resultados finales: acumular en buffer de consolidación
            # Si cambia el speaker, procesar buffer anterior y empezar nuevo
            if consolidation_buffer["speaker_id"] is not None and consolidation_buffer["speaker_id"] != current_speaker:
                # Cambió el speaker - procesar lo acumulado del speaker anterior
                if consolidation_buffer["segments"]:
                    logger.info(f"Speaker changed: {consolidation_buffer['speaker_id']} → {current_speaker}, processing buffer")
                    await _process_consolidated_segment()
                
                # Reiniciar buffer para nuevo speaker
                consolidation_buffer["speaker_id"] = current_speaker
                consolidation_buffer["segments"] = []
                consolidation_buffer["timestamps"] = []
                consolidation_buffer["words"] = []
                consolidation_buffer["last_check_length"] = 0
            
            # Si es el primer segmento, establecer speaker
            if consolidation_buffer["speaker_id"] is None:
                consolidation_buffer["speaker_id"] = current_speaker
            
            # Agregar segmento actual al buffer
            consolidation_buffer["segments"].append(result["text"])
            consolidation_buffer["timestamps"].append({
                "start": result["start"],
                "end": result["end"],
            })
            if result.get("words"):
                consolidation_buffer["words"].extend(result["words"])
            
            # Construir texto completo del buffer
            buffer_text = " ".join(consolidation_buffer["segments"])
            word_count = len(buffer_text.split())
            
            # Chequeo simple de completitud por patrones
            looks_incomplete = _is_incomplete_by_pattern(buffer_text)
            
            # Decisión de procesar:
            should_process = False
            reason = ""
            
            # 1. Si tiene más de 50 palabras, procesar (límite de seguridad)
            if word_count > 50:
                should_process = True
                reason = f"límite de palabras ({word_count})"
            
            # 2. Si NO parece incompleto por patrones, procesar
            elif not looks_incomplete:
                should_process = True
                reason = "frase parece completa (no termina en conector)"
            
            # 3. Si parece incompleto PERO tiene más de 20 palabras, chequear con Claude
            elif looks_incomplete and word_count > 20:
                # Solo chequear con Claude si el buffer creció significativamente
                if word_count - consolidation_buffer["last_check_length"] >= 5:
                    try:
                        logger.info(f"Checking completion with Claude: '{buffer_text[:60]}...'")
                        completion_check = await enhancement_service.is_sentence_complete(
                            text=buffer_text,
                            speaker_id=current_speaker,
                            previous_segments=previous_segments,
                        )
                        consolidation_buffer["last_check_length"] = word_count
                        
                        if completion_check["is_complete"]:
                            should_process = True
                            reason = f"Claude confirmó completitud: {completion_check['reason']}"
                        else:
                            reason = f"Claude dice incompleto: {completion_check['reason']}"
                    except Exception as check_err:
                        logger.warning(f"Claude check failed: {check_err}, using pattern")
                        # Si falla Claude, confiar en el patrón
                        pass
            
            if should_process:
                logger.info(f"Processing buffer ({word_count} palabras): {reason}")
                await _process_consolidated_segment()
            else:
                # Frase incompleta - enviar como provisional para feedback visual
                logger.debug(f"Buffer incompleto ({word_count} palabras): {reason}")
                await websocket.send_json({
                    "type": "transcript",
                    "is_final": False,  # Provisional
                    "speaker": current_speaker,
                    "text": buffer_text,
                    "confidence": result["confidence"],
                    "start": consolidation_buffer["timestamps"][0]["start"],
                    "end": consolidation_buffer["timestamps"][-1]["end"],
                    "words": consolidation_buffer["words"],
                })

        except Exception as e:
            logger.error(f"Error processing transcript: {e}", exc_info=True)

    async def on_utterance_end(data: dict):
        """Deepgram signals end of an utterance."""
        try:
            await websocket.send_json({
                "type": "utterance_end",
                "timestamp": data.get("last_word_end", 0),
            })
        except Exception:
            pass

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
                try:
                    payload = data.get("data")
                    if not payload:
                        logger.warning("audio_chunk sin campo 'data'")
                        continue
                    audio_bytes = base64.b64decode(payload)
                    audio_file.write(audio_bytes)
                    await dg_service.send_audio(audio_bytes)
                except Exception as e:
                    logger.warning(f"Error procesando audio_chunk: {e}")
                    continue

            elif msg_type == "stop":
                logger.info(f"Transcription stopped for audiencia: {audiencia_id}")
                break

    except WebSocketDisconnect as e:
        logger.info(f"WebSocket disconnected for audiencia: {audiencia_id} (code={getattr(e, 'code', '?')})")
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
                    await db.commit()
                    logger.info(f"Sesión guardada: audiencia {audiencia_id} → transcrita (audio: {audio_path})")
        except (ValueError, Exception) as e:
            logger.warning(f"No se pudo actualizar audiencia al cerrar sesión: {e}")

        # Remove from active sessions
        active_sessions.pop(audiencia_id, None)
        logger.info(f"Cleanup complete for audiencia: {audiencia_id}")
