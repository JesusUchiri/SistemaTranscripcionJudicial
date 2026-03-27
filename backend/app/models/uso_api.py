"""
Modelo ORM: UsoApi.
Registra cada llamada a una API externa (Deepgram, Anthropic/Claude) con los
datos reales de facturación extraídos de la respuesta de la API.

Esto elimina la necesidad de hardcodear tarifas: el costo se calcula una vez
en el momento de la llamada usando las constantes de pricing vigentes.
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UsoApi(Base):
    __tablename__ = "uso_api"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    audiencia_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("audiencias.id"), nullable=True, index=True
    )
    usuario_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=True, index=True
    )

    # ── Qué servicio se usó ─────────────────────────────────
    # Valores: "deepgram_streaming", "deepgram_batch",
    #          "claude_acta", "claude_enhancement", "claude_context",
    #          "claude_prediction", "claude_inferir_roles"
    servicio: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    modelo: Mapped[str] = mapped_column(String(100), nullable=False)

    # ── Datos de Deepgram (extraídos de la respuesta) ───────
    duracion_segundos: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # ── Datos de Claude (extraídos de message.usage) ────────
    input_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # ── Costo calculado al momento de la llamada ────────────
    costo_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"<UsoApi {self.servicio} ${self.costo_usd:.6f}>"
