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


@celery_app.task(name="generate_acta", bind=True, max_retries=2)
def generate_acta(self, audiencia_id: str, formato: str = "A", usuario_id: str | None = None):
    """
    Genera el acta oficial de audiencia (tarea asíncrona via Celery):
    1. Recopila todos los segmentos editados
    2. Envía a Claude Sonnet 4 con prompt jurídico
    3. Genera documento con formato oficial (A=Unipersonal, B=Apelaciones)
    4. Guarda versión en BD
    """
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        result = loop.run_until_complete(
            _generate_acta_async(audiencia_id, formato, usuario_id)
        )
        loop.close()
        return result
    except Exception as exc:
        logger.error(f"Error en tarea generate_acta: {exc}")
        raise self.retry(exc=exc, countdown=30)


async def _generate_acta_async(audiencia_id: str, formato: str, usuario_id: str | None):
    """Wrapper async para ejecutar la generación dentro del event loop de Celery."""
    from app.services.acta_generator import generar_acta

    async with async_session() as db:
        acta = await generar_acta(
            audiencia_id=uuid.UUID(audiencia_id),
            formato=formato,
            usuario_id=uuid.UUID(usuario_id) if usuario_id else uuid.uuid4(),
            db=db,
        )
        await db.commit()
        return {
            "acta_id": str(acta.id),
            "version": acta.version,
            "estado": acta.estado,
        }
