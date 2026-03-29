"""
Tarea Celery — generación de acta judicial con LLM.
Delega al servicio acta_generator para la lógica principal.
"""
import asyncio
import logging
import uuid

from app.tasks.celery_app import celery_app
from app.database import async_session

logger = logging.getLogger(__name__)


@celery_app.task(name="generate_acta", bind=True, max_retries=1)
def generate_acta(
    self,
    audiencia_id: str,
    formato: str = "A",
    usuario_id: str | None = None,
    acta_id: str | None = None,
):
    """
    Genera el acta oficial (tarea async via Celery).
    Si acta_id está presente, actualiza ese registro existente (estado="generando")
    en lugar de crear uno nuevo.
    """
    try:
        # asyncio.run() maneja correctamente el ciclo de vida del event loop,
        # incluyendo la limpieza de conexiones asyncpg antes de cerrar el loop.
        result = asyncio.run(
            _generate_acta_async(audiencia_id, formato, usuario_id, acta_id)
        )
        return result
    except Exception as exc:
        logger.error(f"Error en tarea generate_acta: {exc}", exc_info=True)
        # Marcar acta como "error" solo si la tarea NO va a reintentarse,
        # o si ya se agotaron los reintentos.
        will_retry = self.request.retries < self.max_retries
        if acta_id and not will_retry:
            try:
                asyncio.run(_marcar_error(acta_id, str(exc)))
            except Exception:
                pass
        raise self.retry(exc=exc, countdown=60)


async def _generate_acta_async(
    audiencia_id: str,
    formato: str,
    usuario_id: str | None,
    acta_id: str | None,
):
    """Genera el acta y actualiza el registro existente si acta_id está presente."""
    from app.services.acta_generator import generar_acta
    from app.database import make_celery_session

    celery_session = make_celery_session()
    async with celery_session() as db:
        acta_generada = await generar_acta(
            audiencia_id=uuid.UUID(audiencia_id),
            formato=formato,
            usuario_id=uuid.UUID(usuario_id) if usuario_id else uuid.uuid4(),
            db=db,
            acta_existente_id=uuid.UUID(acta_id) if acta_id else None,
        )
        await db.commit()
        return {
            "acta_id": str(acta_generada.id),
            "version": acta_generada.version,
            "estado": acta_generada.estado,
        }


async def _marcar_error(acta_id: str, detalle: str):
    """Marca el acta como 'error' para que el frontend deje de hacer polling."""
    from sqlalchemy import select
    from app.models.acta import Acta
    from app.database import make_celery_session

    celery_session = make_celery_session()
    async with celery_session() as db:
        result = await db.execute(select(Acta).where(Acta.id == uuid.UUID(acta_id)))
        acta = result.scalar_one_or_none()
        if acta and acta.estado == "generando":
            acta.estado = "error"
            acta.contenido_llm = f"Error en generación: {detalle[:500]}"
            await db.commit()
