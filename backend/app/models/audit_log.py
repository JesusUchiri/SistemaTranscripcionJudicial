"""
Modelo ORM: AuditLog.
Registra acciones críticas del sistema (exportaciones DOCX/PDF, actualizaciones batch, aprobaciones).
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    accion: Mapped[str] = mapped_column(String(50), nullable=False) # 'export_docx', 'export_pdf', 'batch_update'
    entidad_tipo: Mapped[Optional[str]] = mapped_column(String(50), nullable=True) # 'audiencia', 'acta', 'segmento'
    entidad_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    usuario_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("usuarios.id"), nullable=False
    )
    detalles: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)  # Metadatos adicionales
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Relationships
    usuario = relationship("Usuario")

    def __repr__(self) -> str:
        return f"<AuditLog {self.accion} by {self.usuario_id}>"
