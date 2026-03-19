"""
Modelo ORM — Hablante (participante de audiencia).

Cada audiencia tiene múltiples hablantes detectados por diarización.
El digitador asigna un rol judicial a cada speaker_id de Deepgram.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.database import Base


class Hablante(Base):
    """Participante detectado en una audiencia judicial."""

    __tablename__ = "hablantes"
    __table_args__ = (
        UniqueConstraint("audiencia_id", "speaker_id", name="uq_hablante_audiencia_speaker"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    audiencia_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("audiencias.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Identificador de Deepgram (ej: "SPEAKER_00")
    speaker_id: Mapped[str] = mapped_column(String(50), nullable=False)

    # Rol asignado por el digitador
    rol: Mapped[str] = mapped_column(
        Enum(
            "juez",
            "juez_director",
            "jueces_colegiado",
            "fiscal",
            "defensa_imputado",
            "defensa_agraviado",
            "imputado",
            "agraviado",
            "victima",
            "asesor_victimas",
            "perito",
            "testigo",
            "asistente",
            "partes_general",
            "otro",
            name="rol_hablante",
        ),
        nullable=False,
        default="otro",
    )

    # Etiqueta que aparece en el Canvas (ej: "JUEZ:", "FISCAL:")
    etiqueta: Mapped[str] = mapped_column(String(100), nullable=False, default="OTRO:")

    # Nombre real del participante (opcional)
    nombre: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Color hex para distinguir visualmente
    color: Mapped[str] = mapped_column(String(7), nullable=False, default="#94A3B8")

    # Orden de aparición en la audiencia
    orden: Mapped[int] = mapped_column(Integer, default=0)

    # ¿Auto-detectado o asignado manualmente?
    auto_detectado: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relación
    audiencia = relationship("Audiencia", backref="hablantes")
