"""
JudiScribe — SQLAlchemy async engine y session factory.
"""
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool, QueuePool
import logging

from app.config import settings

logger = logging.getLogger(__name__)


def make_celery_session():
    """
    Session factory para tareas Celery.

    Usa NullPool para evitar que las conexiones del pool queden ligadas
    al event loop de una llamada anterior. Cada tarea crea y destruye
    su propia conexión, lo que es correcto para procesos de larga duración.
    """
    celery_engine = create_async_engine(
        settings.DATABASE_URL,
        poolclass=NullPool,
        connect_args={"timeout": 30, "command_timeout": 60},
    )
    return async_sessionmaker(
        celery_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )


# Configuración de engine según ambiente
if settings.ENVIRONMENT == "production":
    # Producción con 2 workers uvicorn: cada worker tiene su propio pool.
    # pool_size=15 × 2 workers = 30 conexiones máx → bien dentro del límite de PG (100).
    # max_overflow=10 permite bursts cortos sin rechazar requests.
    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        pool_size=15,
        max_overflow=10,
        pool_pre_ping=True,
        pool_recycle=1800,   # Reciclar conexiones cada 30 min (más conservador)
        pool_timeout=30,     # Error si no hay conexión disponible en 30s
        connect_args={
            "timeout": 30,
            "command_timeout": 30,
        },
    )
    logger.info("✅ Database engine creado en modo PRODUCCIÓN (pool=15+10)")
else:
    # Desarrollo: permitir debugging y reloads
    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=settings.ENVIRONMENT == "development",
        pool_size=20,
        max_overflow=10,
        pool_pre_ping=True,
    )
    logger.info("✅ Database engine creado en modo DESARROLLO")

async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Base declarativa para todos los modelos ORM."""
    pass


async def get_db() -> AsyncSession:
    """Dependency para inyectar la sesión de BD en endpoints."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
