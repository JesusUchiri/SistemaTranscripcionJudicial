"""
Modelo ORM: Segmento.
Cada segmento es un trozo de texto transcrito (streaming o batch).
"""
import uuid
from typing import Optional

from sqlalchemy import (
    Boolean,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Segmento(Base):
    __tablename__ = "segmentos"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    audiencia_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("audiencias.id"),
        nullable=False,
        index=True,
    )
    speaker_id: Mapped[str] = mapped_column(String(20), nullable=False)
    texto_ia: Mapped[str] = mapped_column(Text, nullable=False)
    texto_editado: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    texto_mejorado: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # Texto mejorado por Claude en tiempo real
    texto_batch: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # Propuesta generada por procesamiento Batch
    timestamp_inicio: Mapped[float] = mapped_column(Float, nullable=False)
    timestamp_fin: Mapped[float] = mapped_column(Float, nullable=False)
    confianza: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    es_provisional: Mapped[bool] = mapped_column(Boolean, default=False)
    editado_por_usuario: Mapped[bool] = mapped_column(Boolean, default=False)
    fuente: Mapped[str] = mapped_column(
        Enum("streaming", "batch", name="fuente_segmento"),
        default="streaming",
    )
    orden: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    palabras_json: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # Relationships
    audiencia = relationship("Audiencia", back_populates="segmentos")

    def __repr__(self) -> str:
        preview = (self.texto_ia[:40] + "...") if len(self.texto_ia) > 40 else self.texto_ia
        return f"<Segmento #{self.orden} [{self.speaker_id}] {preview}>"
