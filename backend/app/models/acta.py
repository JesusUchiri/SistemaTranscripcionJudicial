"""
Modelo ORM: Acta.
Representa un borrador o versión final del acta de audiencia generado por LLM.
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Acta(Base):
    __tablename__ = "actas"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    audiencia_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("audiencias.id"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    formato: Mapped[str] = mapped_column(
        String(10), nullable=False, default="A"
    )  # A=Unipersonal, B=Apelaciones
    estado: Mapped[str] = mapped_column(
        String(20), nullable=False, default="borrador"
    )  # borrador, revisado, aprobado
    contenido_llm: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    contenido_editado: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    prompt_utilizado: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    modelo_llm: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    tokens_used: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    confianza: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    generado_por: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    aprobada_por: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True
    )
    aprobada_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    audiencia = relationship("Audiencia", backref="actas")

    def __repr__(self) -> str:
        return f"<Acta audiencia={self.audiencia_id} v{self.version} ({self.estado})>"
