"""
Endpoint para subir archivos de audio y transcribirlos con Deepgram batch API.

Flujo de 2 pasos (nuevo):
  POST /subir    — sube el archivo, crea la audiencia (estado="pendiente"), sin transcribir
  POST /procesar — aplica edición (regiones + filtros) y transcribe con Deepgram

El endpoint original (POST /) sigue disponible para compatibilidad.
"""
import logging
import os
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.database import get_db, async_session
from app.models.audiencia import Audiencia
from app.models.segmento import Segmento
from app.models.usuario import Usuario
from app.services.deepgram_batch import DeepgramBatchService
from app.utils.audio_compress import compress_for_transcription, optimize_for_storage
from app.utils.audio_editor import trim_regions, apply_filters, get_audio_duration

logger = logging.getLogger(__name__)

router = APIRouter(tags=["transcripcion-audio"])

# Tipos de audio permitidos
ALLOWED_MIME_TYPES = {
    "audio/wav",
    "audio/wave",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/ogg",
    "audio/webm",
    "audio/flac",
    "audio/x-flac",
    "audio/aac",
    "audio/m4a",
    "audio/x-m4a",
    "video/webm",
}

MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024  # 2GB


# ── Pydantic models ──────────────────────────────────────────────────────────

class RegionInput(BaseModel):
    start: float
    end: float


class FiltersInput(BaseModel):
    noise_reduction: bool = False
    normalize: bool = False
    volume: float = 1.0
    highpass: bool = False


class ProcesarRequest(BaseModel):
    audiencia_id: uuid.UUID
    regions: list[RegionInput] = []
    filters: FiltersInput = FiltersInput()


# ── Helpers ──────────────────────────────────────────────────────────────────

def _normalize_mime(content_type: str, filename: str) -> str:
    """Normaliza el MIME type basado en content_type y extensión."""
    base_type = (content_type or "").split(";")[0].strip().lower()
    if base_type and base_type in ALLOWED_MIME_TYPES:
        return base_type
    ext = os.path.splitext(filename or "")[1].lower()
    ext_map = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".mp4": "audio/mp4",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
        ".webm": "audio/webm",
        ".flac": "audio/flac",
        ".aac": "audio/aac",
    }
    return ext_map.get(ext, base_type or "audio/wav")


def _mime_from_path(audio_path: str) -> str:
    ext = os.path.splitext(audio_path)[1].lower()
    ext_map = {
        ".wav": "audio/wav", ".mp3": "audio/mpeg", ".mp4": "audio/mp4",
        ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".webm": "audio/webm",
        ".flac": "audio/flac", ".aac": "audio/aac",
    }
    return ext_map.get(ext, "audio/wav")


async def _guardar_segmentos(db: AsyncSession, audiencia: Audiencia, segments_data: list[dict]) -> list[str]:
    """Guarda segmentos y auto-crea hablantes. Devuelve lista de speaker_ids únicos."""
    from app.models.hablante import Hablante
    from app.api.hablantes import COLORES_POR_ORDEN

    for seg_data in segments_data:
        segmento = Segmento(
            audiencia_id=audiencia.id,
            speaker_id=seg_data["speaker_id"],
            texto_ia=seg_data["texto_ia"],
            timestamp_inicio=seg_data["timestamp_inicio"],
            timestamp_fin=seg_data["timestamp_fin"],
            confianza=seg_data.get("confianza", 0.95),
            es_provisional=False,
            fuente="batch",
            orden=seg_data["orden"],
        )
        db.add(segmento)

    unique_speakers = list(dict.fromkeys(
        seg_data["speaker_id"] for seg_data in segments_data
    ))
    for idx, speaker_id in enumerate(unique_speakers):
        existing = await db.execute(
            select(Hablante).where(
                Hablante.audiencia_id == audiencia.id,
                Hablante.speaker_id == speaker_id,
            )
        )
        if existing.scalar_one_or_none() is None:
            color = COLORES_POR_ORDEN[idx % len(COLORES_POR_ORDEN)]
            hablante = Hablante(
                audiencia_id=audiencia.id,
                speaker_id=speaker_id,
                rol="otro",
                etiqueta=f"{speaker_id.upper()}:",
                color=color,
                orden=idx,
                auto_detectado=True,
            )
            db.add(hablante)

    return unique_speakers


async def _transcribir_desde_disco(
    audio_path: str,
    mime_type: str,
    db: AsyncSession,
    audiencia: Audiencia,
) -> dict:
    """Comprime si es necesario, transcribe con Deepgram, limpia temporales y registra costo."""
    transcribe_path, was_compressed = await compress_for_transcription(audio_path)
    transcribe_mime = "audio/mpeg" if was_compressed else mime_type
    try:
        service = DeepgramBatchService()
        result = await service.transcribe_file(transcribe_path, transcribe_mime)
        
        # Registrar costo
        duracion = result.get("duration", 0.0)
        costo = 0.0
        if duracion > 0:
            try:
                from app.services.cost_tracker import registrar_uso_deepgram
                uso = await registrar_uso_deepgram(
                    db=db,
                    servicio="deepgram_batch",
                    modelo=settings.DEEPGRAM_MODEL,
                    duracion_segundos=duracion,
                    modo="batch",
                    diarize=True,
                    audiencia_id=audiencia.id,
                    usuario_id=audiencia.created_by,
                )
                costo = uso.costo_usd
            except Exception as e:
                logger.error(f"Error registrando costo Deepgram: {e}")
                
        result["usd_cost"] = costo

        return result
    finally:
        if was_compressed and os.path.exists(transcribe_path):
            os.unlink(transcribe_path)


async def _stream_upload_to_disk(audio: UploadFile, audio_path: str) -> int:
    """
    Guarda el archivo subido en disco en chunks sin bloquear el event loop.
    Las escrituras a disco usan asyncio.to_thread para no bloquear uvicorn.
    """
    import asyncio
    audio_size = 0
    CHUNK = 4 * 1024 * 1024  # 4MB — balance entre I/O overhead y memoria
    try:
        with open(audio_path, "wb") as f:
            while True:
                chunk = await audio.read(CHUNK)
                if not chunk:
                    break
                audio_size += len(chunk)
                if audio_size > MAX_FILE_SIZE:
                    raise HTTPException(
                        status_code=400,
                        detail="El archivo es demasiado grande. Máximo: 2GB",
                    )
                # Escritura no bloqueante: el event loop sigue libre mientras el
                # kernel escribe en disco (crítico con uvicorn --workers 2)
                await asyncio.to_thread(f.write, chunk)
    except HTTPException:
        if os.path.exists(audio_path):
            os.unlink(audio_path)
        raise
    if audio_size == 0:
        os.unlink(audio_path)
        raise HTTPException(status_code=400, detail="El archivo de audio está vacío")
    return audio_size


# ── Endpoint original (compatibilidad) ──────────────────────────────────────

@router.post("", status_code=status.HTTP_200_OK)
async def transcribir_audio(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Sube y transcribe en una sola operación (endpoint original)."""
    # max_part_size=2GB para superar el límite de 1MB de Starlette por defecto
    form = await request.form(max_part_size=10 * 1024 * 1024)  # 10MB en RAM, resto a temp file
    audio: UploadFile = form.get("audio")
    expediente: str = form.get("expediente", "")
    juzgado: str = form.get("juzgado", "")
    tipo_audiencia: str = form.get("tipo_audiencia", "Audiencia de Audio Subido")
    instancia: str = form.get("instancia", "Primera Instancia")

    if not audio or not expediente or not juzgado:
        raise HTTPException(status_code=400, detail="Campos requeridos: audio, expediente, juzgado")

    logger.info(f"Upload recibido: filename={audio.filename}, content_type={audio.content_type!r}")
    mime_type = _normalize_mime(audio.content_type, audio.filename)
    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Tipo de archivo no soportado: {audio.content_type}. "
                   f"Se aceptan: WAV, MP3, MP4, M4A, OGG, WebM, FLAC, AAC",
        )

    os.makedirs(settings.AUDIO_STORAGE_PATH, exist_ok=True)
    audio_id = str(uuid.uuid4())
    ext = os.path.splitext(audio.filename or ".wav")[1] or ".wav"
    audio_path = os.path.join(settings.AUDIO_STORAGE_PATH, f"{audio_id}{ext}")

    await _stream_upload_to_disk(audio, audio_path)

    now = datetime.now()
    audiencia = Audiencia(
        expediente=expediente,
        juzgado=juzgado,
        tipo_audiencia=tipo_audiencia,
        instancia=instancia,
        fecha=now.date(),
        hora_inicio=now.time(),
        estado="en_curso",
        audio_path=audio_path,
        created_by=current_user.id,
    )
    db.add(audiencia)
    await db.flush()
    await db.refresh(audiencia)

    try:
        result = await _transcribir_desde_disco(audio_path, mime_type, db, audiencia)
    except Exception as e:
        audiencia.estado = "pendiente"
        await db.flush()
        raise HTTPException(status_code=500, detail=f"Error en la transcripción con Deepgram: {str(e)}")

    segments_data = result.get("segments", [])
    unique_speakers = await _guardar_segmentos(db, audiencia, segments_data)
    audiencia.estado = "transcrita"
    audiencia.audio_duration_seconds = result.get("duration", 0.0)
    await db.flush()

    return {
        "audiencia_id": str(audiencia.id),
        "expediente": audiencia.expediente,
        "estado": "transcrita",
        "total_segmentos": len(segments_data),
        "duracion_segundos": result.get("duration", 0.0),
        "hablantes_detectados": len(unique_speakers),
        "mensaje": f"Audio transcrito exitosamente. {len(segments_data)} segmentos generados con {len(unique_speakers)} hablantes.",
    }


# ── Nuevo flujo 2 pasos ──────────────────────────────────────────────────────




@router.post("/subir", status_code=status.HTTP_200_OK)
async def subir_audio(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """
    Paso 1 — Sube el archivo y crea la audiencia (estado='pendiente').
    No transcribe: devuelve audiencia_id + duracion para que el usuario
    pueda ajustar el audio antes de procesar.
    """
    # max_part_size=2GB para superar el límite de 1MB de Starlette por defecto
    form = await request.form(max_part_size=10 * 1024 * 1024)  # 10MB en RAM, resto a temp file
    audio: UploadFile = form.get("audio")
    expediente: str = form.get("expediente", "")
    juzgado: str = form.get("juzgado", "")
    tipo_audiencia: str = form.get("tipo_audiencia", "Audiencia de Audio Subido")
    instancia: str = form.get("instancia", "Primera Instancia")

    if not audio or not expediente or not juzgado:
        raise HTTPException(status_code=400, detail="Campos requeridos: audio, expediente, juzgado")

    logger.info(f"[subir] filename={audio.filename}, content_type={audio.content_type!r}")
    mime_type = _normalize_mime(audio.content_type, audio.filename)
    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Tipo de archivo no soportado: {audio.content_type}. "
                   f"Se aceptan: WAV, MP3, MP4, M4A, OGG, WebM, FLAC, AAC",
        )

    os.makedirs(settings.AUDIO_STORAGE_PATH, exist_ok=True)
    audio_id = str(uuid.uuid4())
    ext = os.path.splitext(audio.filename or ".wav")[1] or ".wav"
    audio_path = os.path.join(settings.AUDIO_STORAGE_PATH, f"{audio_id}{ext}")

    await _stream_upload_to_disk(audio, audio_path)

    now = datetime.now()
    audiencia = Audiencia(
        expediente=expediente,
        juzgado=juzgado,
        tipo_audiencia=tipo_audiencia,
        instancia=instancia,
        fecha=now.date(),
        hora_inicio=now.time(),
        estado="pendiente",
        audio_path=audio_path,
        created_by=current_user.id,
    )
    db.add(audiencia)
    await db.flush()
    await db.refresh(audiencia)

    # Obtener duración real con ffprobe (rápido)
    duracion = await get_audio_duration(audio_path) or 0.0
    if duracion > 0:
        audiencia.audio_duration_seconds = duracion
        await db.flush()

    audiencia_id_str = str(audiencia.id)
    logger.info(f"[subir] Audiencia creada: {audiencia_id_str}, duración: {duracion:.1f}s")

    # Optimización FLAC síncrona para que el front reciba el archivo ligero en el editor
    try:
        orig_size_mb = os.path.getsize(audio_path) / 1024 / 1024
        optimized_path, was_optimized = await optimize_for_storage(audio_path)
        
        if was_optimized:
            audiencia.audio_path = optimized_path
            await db.commit()
            opt_size_mb = os.path.getsize(optimized_path) / 1024 / 1024
            logger.info(f"[subir] {audiencia_id_str}: {orig_size_mb:.1f}MB → FLAC {opt_size_mb:.1f}MB")
            
            if os.path.exists(audio_path):
                os.unlink(audio_path)
        else:
            await db.commit()
    except Exception as e:
        logger.error(f"[subir] Error optimizando en subir_audio {audiencia_id_str}: {e}")
        await db.commit()

    return {
        "audiencia_id": audiencia_id_str,
        "duracion_segundos": duracion,
        "mensaje": "Audio subido. Ajusta las regiones y filtros antes de procesar.",
    }


async def _run_transcripcion_background(
    audiencia_id: uuid.UUID,
    regions: list[dict],
    filters_dict: dict,
) -> None:
    """
    Ejecuta la transcripción completa en un hilo de background independiente del ciclo
    HTTP. Usa su propia sesión de BD para que el commit no dependa de la request
    original (que puede haber sido cancelada por un timeout de nginx).
    """
    async with async_session() as db:
        try:
            result_db = await db.execute(select(Audiencia).where(Audiencia.id == audiencia_id))
            audiencia = result_db.scalar_one_or_none()
            if audiencia is None:
                logger.error(f"[bg_transcripcion] Audiencia {audiencia_id} no encontrada")
                return

            mime_type = _mime_from_path(audiencia.audio_path)
            audiencia.estado = "en_curso"
            await db.commit()

            temp_files: list[str] = []
            working_path = audiencia.audio_path

            try:
                # 1. Recortar regiones
                if regions:
                    from app.utils.audio_editor import trim_regions as _trim
                    trimmed_path, was_trimmed = await _trim(working_path, regions)
                    if was_trimmed:
                        temp_files.append(trimmed_path)
                        working_path = trimmed_path

                # 2. Aplicar filtros
                from app.utils.audio_editor import apply_filters as _filters
                filtered_path, was_filtered = await _filters(working_path, filters_dict)
                if was_filtered:
                    temp_files.append(filtered_path)
                    working_path = filtered_path

                # 3. Comprimir + transcribir con Deepgram
                result = await _transcribir_desde_disco(working_path, mime_type, db, audiencia)

            except Exception as e:
                logger.error(f"[bg_transcripcion] Error transcribiendo {audiencia_id}: {e}", exc_info=True)
                audiencia.estado = "pendiente"  # volver a pendiente para que el usuario pueda reintentar
                await db.commit()
                return
            finally:
                for tmp in temp_files:
                    if os.path.exists(tmp):
                        os.unlink(tmp)

            segments_data = result.get("segments", [])
            await _guardar_segmentos(db, audiencia, segments_data)
            audiencia.estado = "transcrita"
            audiencia.audio_duration_seconds = result.get("duration", 0.0)
            await db.commit()  # commit explícito — independiente del ciclo HTTP
            logger.info(f"[bg_transcripcion] {audiencia_id} completado: {len(segments_data)} segmentos")

        except Exception as e:
            logger.error(f"[bg_transcripcion] Error fatal en {audiencia_id}: {e}", exc_info=True)
            try:
                await db.rollback()
            except Exception:
                pass


@router.post("/procesar", status_code=status.HTTP_202_ACCEPTED)
async def procesar_audio(
    req: ProcesarRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """
    Paso 2 — Lanza transcripción en background y devuelve 202 inmediatamente.

    La transcripción puede tardar varios minutos para audios largos. El cliente
    debe hacer polling a GET /api/audiencias/{id} y esperar estado='transcrita' o 'error'.

    - regions: lista de {start, end} en segundos; vacía = procesar todo el audio
    - filters: ruido, normalización, volumen, graves
    """
    result_db = await db.execute(
        select(Audiencia).where(Audiencia.id == req.audiencia_id)
    )
    audiencia = result_db.scalar_one_or_none()
    if audiencia is None:
        raise HTTPException(status_code=404, detail="Audiencia no encontrada")

    if current_user.rol not in ("admin", "supervisor"):
        if audiencia.created_by != current_user.id:
            raise HTTPException(status_code=404, detail="Audiencia no encontrada")

    if not audiencia.audio_path or not os.path.exists(audiencia.audio_path):
        raise HTTPException(status_code=404, detail="No hay archivo de audio disponible")

    regions_dicts = [{"start": r.start, "end": r.end} for r in req.regions]
    filters_dict = req.filters.model_dump()

    background_tasks.add_task(
        _run_transcripcion_background,
        req.audiencia_id,
        regions_dicts,
        filters_dict,
    )

    return {
        "audiencia_id": str(audiencia.id),
        "estado": "en_curso",
        "mensaje": "Transcripción iniciada. Consulta el estado con GET /api/audiencias/{id}",
    }


# ── Retranscribir (refactorizado con helpers) ────────────────────────────────

@router.post("/{audiencia_id}/retranscribir", status_code=status.HTTP_200_OK)
async def retranscribir_audio_existente(
    audiencia_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """Re-transcribe el audio de una audiencia existente."""
    result_db = await db.execute(
        select(Audiencia).where(Audiencia.id == audiencia_id)
    )
    audiencia = result_db.scalar_one_or_none()
    if audiencia is None:
        raise HTTPException(status_code=404, detail="Audiencia no encontrada")

    if current_user.rol not in ("admin", "supervisor"):
        if audiencia.created_by != current_user.id:
            raise HTTPException(status_code=404, detail="Audiencia no encontrada")

    if not audiencia.audio_path or not os.path.exists(audiencia.audio_path):
        raise HTTPException(status_code=404, detail="No hay archivo de audio disponible")

    mime_type = _mime_from_path(audiencia.audio_path)

    existing = await db.execute(
        select(Segmento).where(Segmento.audiencia_id == audiencia_id)
    )
    for seg in existing.scalars().all():
        await db.delete(seg)

    try:
        result = await _transcribir_desde_disco(audiencia.audio_path, mime_type, db, audiencia)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error en la transcripción: {str(e)}")

    segments_data = result.get("segments", [])
    await _guardar_segmentos(db, audiencia, segments_data)
    audiencia.estado = "transcrita"
    audiencia.audio_duration_seconds = result.get("duration", 0.0)
    await db.flush()

    return {
        "audiencia_id": str(audiencia.id),
        "total_segmentos": len(segments_data),
        "duracion_segundos": result.get("duration", 0.0),
        "hablantes_detectados": result.get("speakers_count", 0),
        "costo_total_usd": result.get("usd_cost", 0.0),
        "mensaje": f"Audio re-transcrito. {len(segments_data)} segmentos generados.",
    }
