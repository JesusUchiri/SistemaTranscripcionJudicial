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

# Configuración de engine según ambiente
if settings.ENVIRONMENT == "production":
    # Producción: usar QueuePool con timeouts más altos
    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        pool_size=10,
        max_overflow=5,
        pool_pre_ping=True,
        pool_recycle=3600,  # Reciclar conexiones cada hora
        connect_args={
            "timeout": 30,  # Timeout de conexión: 30s
            "command_timeout": 30,
        },
    )
    logger.info("✅ Database engine creado en modo PRODUCCIÓN")
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
