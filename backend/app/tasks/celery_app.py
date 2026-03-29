"""
Celery app configuration.
Sprint 1: stub, used by docker-compose.
Sprint 4: batch processing tasks.
"""
from celery import Celery

from app.config import settings

celery_app = Celery(
    "judiscribe",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="America/Lima",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)

# Registrar tareas explícitamente (autodiscover requiere módulos llamados tasks.py)
celery_app.conf.imports = [
    "app.tasks.generate_acta",
    "app.tasks.batch_process",
]
