"""
Tarea Celery — procesamiento batch post-audiencia.
Sprint 7: Deepgram Batch API + Alineación temporal + Generación de propuestas.
"""
import asyncio
import logging
import os
import uuid
from typing import List, Dict

from app.config import settings
from app.database import async_session
from sqlalchemy import select
from app.models.audiencia import Audiencia
from app.models.segmento import Segmento
from app.services.deepgram_batch import DeepgramBatchService

from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


def string_similarity(s1: str, s2: str) -> float:
    from difflib import SequenceMatcher
    return SequenceMatcher(None, s1, s2).ratio()


@celery_app.task(name="batch_process_audio", bind=True, max_retries=3)
def batch_process_audio(self, audiencia_id: str):
    """
    Procesa el audio grabado de una audiencia usando la API Batch.
    Alinea los resultados temporalmente y genera propuestas de mejora
    para los segmentos de streaming que no hayan sido editados por el usuario.
    """
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        result = loop.run_until_complete(_batch_process_async(audiencia_id))
        loop.close()
        return result
    except Exception as exc:
        logger.error(f"Error en tarea batch_process_audio: {exc}")
        raise self.retry(exc=exc, countdown=60)


async def _batch_process_async(audiencia_id: str):
    """Lógica core de procesamiento batch."""
    aid = uuid.UUID(audiencia_id)

    # 1. Obtener audio_path desde la audiencia (lo persiste transcription_ws al iniciar)
    async with async_session() as db:
        result = await db.execute(select(Audiencia).where(Audiencia.id == aid))
        audiencia = result.scalar_one_or_none()
    if audiencia is None:
        logger.warning(f"Audiencia {audiencia_id} no encontrada")
        return {"error": "Audiencia no encontrada"}

    audio_path = audiencia.audio_path or os.path.join(
        settings.AUDIO_STORAGE_PATH, f"{audiencia_id}.wav"
    )
    if not os.path.exists(audio_path):
        logger.warning(f"No se encontró archivo WAV en {audio_path}")
        return {"error": "Archivo no encontrado"}

    with open(audio_path, 'rb') as f:
        audio_bytes = f.read()

    # 2. Transcribir con Deepgram Batch
    logger.info(f"Iniciando transcripción batch para {audiencia_id}...")
    service = DeepgramBatchService()
    result = await service.transcribe_file(audio_bytes)
    all_words = result.get("words", [])

    if not all_words:
        logger.info("No se encontraron palabras en la transcripción batch.")
        return {"status": "success", "proposals": 0}

    # 3. Obtener segmentos streaming a contrastar
    proposals_created = 0
    logger.info("Buscando segmentos streaming para alinear temporalmente...")

    async with async_session() as db:
        # Registrar costo si hubo palabras (indicando procesamiento exitoso)
        if result.get("duration", 0.0) > 0:
            try:
                from app.services.cost_tracker import registrar_uso_deepgram
                await registrar_uso_deepgram(
                    db=db,
                    servicio="deepgram_batch_alignment",
                    modelo=settings.DEEPGRAM_MODEL,
                    duracion_segundos=result.get("duration", 0.0),
                    modo="batch",
                    diarize=True,
                    audiencia_id=aid,
                )
            except Exception as e:
                logger.error(f"No se pudo registrar costo batch CELERY: {e}")

        stmt = select(Segmento).where(
            Segmento.audiencia_id == aid,
            Segmento.fuente == "streaming"
        ).order_by(Segmento.timestamp_inicio)

        db_segments = (await db.scalars(stmt)).all()

        for seg in db_segments:
            # Si el usuario ya lo editó, respetamos su decisión y no generamos propuesta
            if seg.editado_por_usuario:
                continue

            # 4. Extraer texto batch alineado temporalmente
            # Recuperamos palabras que caen dentro del segmento (+/- un mínimo margen)
            margin = 0.5  # segundos
            start_t = seg.timestamp_inicio - margin
            end_t = seg.timestamp_fin + margin

            aligned_words = [
                w.get("word", "")
                for w in all_words
                if w.get("start", 0) >= start_t and w.get("end", 0) <= end_t
            ]
            batch_text = " ".join([w for w in aligned_words if w]).strip()

            if not batch_text:
                continue

            # 5. Comparar textos y crear propuesta
            current_text = seg.texto_mejorado or seg.texto_ia

            if batch_text and current_text:
                similarity = string_similarity(current_text.lower(), batch_text.lower())
                
                # Umbral configurable para ignorar diferencias menores o puntuales vs diferencias notables.
                # Si hay una diferencia apreciable pero son la misma frase (ratio < 0.95 y ratio > 0.4)
                if similarity < 0.95 and similarity > 0.4:
                    seg.texto_batch = batch_text
                    proposals_created += 1

        if proposals_created > 0:
            await db.commit()

    logger.info(f"Procesamiento batch completo. {proposals_created} propuestas de mejora generadas.")
    return {"status": "success", "proposals": proposals_created}

