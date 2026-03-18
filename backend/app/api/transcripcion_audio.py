"""
Endpoint para subir archivos de audio y transcribirlos con Deepgram batch API.
"""
import logging
import os
import uuid
from datetime import date, time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.database import get_db
from app.models.audiencia import Audiencia
from app.models.segmento import Segmento
from app.models.usuario import Usuario
from app.services.deepgram_batch import DeepgramBatchService
from app.utils.audio_compress import compress_for_transcription

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/transcripcion-audio", tags=["transcripcion-audio"])

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
    "video/webm",  # Some recorders save as webm with audio
}

# Max file size: 2GB (soporta WAV estéreo hasta ~2h, MP3/AAC/FLAC hasta 40h)
MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024


def _normalize_mime(content_type: str, filename: str) -> str:
    """Normalize MIME type based on content_type and file extension."""
    # Strip params like "audio/wav; codecs=1" → "audio/wav"
    base_type = (content_type or "").split(";")[0].strip().lower()

    if base_type and base_type in ALLOWED_MIME_TYPES:
        return base_type

    # Fallback: derive from file extension
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


@router.post("", status_code=status.HTTP_200_OK)
async def transcribir_audio(
    audio: UploadFile = File(..., description="Archivo de audio a transcribir"),
    expediente: str = Form(..., description="Número de expediente"),
    juzgado: str = Form(..., description="Juzgado"),
    tipo_audiencia: str = Form("Audiencia de Audio Subido", description="Tipo de audiencia"),
    instancia: str = Form("Primera Instancia", description="Instancia"),
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """
    Sube un archivo de audio, lo transcribe con Deepgram y crea la audiencia
    con todos sus segmentos en una sola operación.
    """
    # Validate file type
    logger.info(f"Upload recibido: filename={audio.filename}, content_type={audio.content_type!r}")
    mime_type = _normalize_mime(audio.content_type, audio.filename)
    logger.info(f"MIME normalizado: {mime_type}")
    if mime_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Tipo de archivo no soportado: {audio.content_type}. "
                   f"Se aceptan: WAV, MP3, MP4, M4A, OGG, WebM, FLAC, AAC"
        )

    # Stream the file to disk in chunks to avoid loading everything in RAM
    os.makedirs(settings.AUDIO_STORAGE_PATH, exist_ok=True)
    audio_id = str(uuid.uuid4())
    ext = os.path.splitext(audio.filename or ".wav")[1] or ".wav"
    audio_filename = f"{audio_id}{ext}"
    audio_path = os.path.join(settings.AUDIO_STORAGE_PATH, audio_filename)

    audio_size = 0
    CHUNK = 8 * 1024 * 1024  # 8MB chunks
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
                        detail=f"El archivo es demasiado grande. Máximo: {MAX_FILE_SIZE // (1024**3)}GB"
                    )
                f.write(chunk)
    except HTTPException:
        if os.path.exists(audio_path):
            os.unlink(audio_path)
        raise

    if audio_size == 0:
        os.unlink(audio_path)
        raise HTTPException(status_code=400, detail="El archivo de audio está vacío")

    # Create the audiencia record first
    from datetime import datetime
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

    # Compress audio before sending to Deepgram (FFmpeg: 16kHz mono 64kbps MP3)
    transcribe_path, was_compressed = await compress_for_transcription(audio_path)
    transcribe_mime = "audio/mpeg" if was_compressed else mime_type

    # Transcribe with Deepgram (read from disk — no double RAM usage)
    try:
        service = DeepgramBatchService()
        result = await service.transcribe_file(transcribe_path, transcribe_mime)
    except Exception as e:
        # Update audiencia state to reflect error
        audiencia.estado = "pendiente"
        await db.flush()
        raise HTTPException(
            status_code=500,
            detail=f"Error en la transcripción con Deepgram: {str(e)}"
        )
    finally:
        if was_compressed and os.path.exists(transcribe_path):
            os.unlink(transcribe_path)

    # Save segments to DB
    segments_data = result.get("segments", [])

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

    # ── Auto-crear hablantes con colores distintos para cada speaker detectado ──
    from app.models.hablante import Hablante
    from app.api.hablantes import COLORES_POR_ORDEN

    unique_speakers = list(dict.fromkeys(
        seg_data["speaker_id"] for seg_data in segments_data
    ))
    for idx, speaker_id in enumerate(unique_speakers):
        # Verificar si ya existe
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

    # Update audiencia with transcription info
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


@router.post("/{audiencia_id}/retranscribir", status_code=status.HTTP_200_OK)
async def retranscribir_audio_existente(
    audiencia_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: Usuario = Depends(get_current_user),
):
    """
    Re-transcribe el audio de una audiencia existente.
    Útil si se quiere mejorar la transcripción con un modelo actualizado.
    """
    result = await db.execute(
        select(Audiencia).where(Audiencia.id == audiencia_id)
    )
    audiencia = result.scalar_one_or_none()
    if audiencia is None:
        raise HTTPException(status_code=404, detail="Audiencia no encontrada")

    # Check permissions
    if current_user.rol not in ("admin", "supervisor"):
        if audiencia.created_by != current_user.id:
            raise HTTPException(status_code=404, detail="Audiencia no encontrada")

    # Check audio exists
    if not audiencia.audio_path or not os.path.exists(audiencia.audio_path):
        raise HTTPException(status_code=404, detail="No hay archivo de audio disponible")

    # Determine mime type from extension
    ext = os.path.splitext(audiencia.audio_path)[1].lower()
    ext_map = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".mp4": "audio/mp4",
        ".m4a": "audio/mp4",
        ".ogg": "audio/ogg",
        ".webm": "audio/webm",
        ".flac": "audio/flac",
    }
    mime_type = ext_map.get(ext, "audio/wav")

    # Delete existing segments
    existing = await db.execute(
        select(Segmento).where(Segmento.audiencia_id == audiencia_id)
    )
    for seg in existing.scalars().all():
        await db.delete(seg)

    # Compress audio before sending to Deepgram
    transcribe_path, was_compressed = await compress_for_transcription(audiencia.audio_path)
    transcribe_mime = "audio/mpeg" if was_compressed else mime_type

    # Re-transcribe
    try:
        service = DeepgramBatchService()
        result = await service.transcribe_file(transcribe_path, transcribe_mime)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error en la transcripción: {str(e)}"
        )
    finally:
        if was_compressed and os.path.exists(transcribe_path):
            os.unlink(transcribe_path)

    # Save new segments
    segments_data = result.get("segments", [])

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

    audiencia.estado = "transcrita"
    audiencia.audio_duration_seconds = result.get("duration", 0.0)

    await db.flush()

    return {
        "audiencia_id": str(audiencia.id),
        "total_segmentos": len(segments_data),
        "duracion_segundos": result.get("duration", 0.0),
        "hablantes_detectados": result.get("speakers_count", 0),
        "mensaje": f"Audio re-transcrito. {len(segments_data)} segmentos generados.",
    }
