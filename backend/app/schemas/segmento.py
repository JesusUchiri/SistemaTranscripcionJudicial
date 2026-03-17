"""
Pydantic schemas para Segmento.
"""
import uuid
from typing import Optional

from pydantic import BaseModel


class SegmentoCreate(BaseModel):
    audiencia_id: uuid.UUID
    speaker_id: str
    texto_ia: str
    timestamp_inicio: float
    timestamp_fin: float
    confianza: float = 1.0
    es_provisional: bool = False
    fuente: str = "streaming"
    orden: int
    palabras_json: Optional[dict] = None


class SegmentoUpdate(BaseModel):
    texto_editado: Optional[str] = None
    editado_por_usuario: Optional[bool] = None


class SegmentoResponse(BaseModel):
    id: uuid.UUID
    audiencia_id: uuid.UUID
    speaker_id: str
    texto_ia: str
    texto_editado: Optional[str]
    texto_mejorado: Optional[str] = None
    texto_batch: Optional[str] = None
    timestamp_inicio: float
    timestamp_fin: float
    confianza: float
    es_provisional: bool
    editado_por_usuario: bool
    fuente: str
    orden: int
    palabras_json: Optional[dict]

    model_config = {"from_attributes": True}


# ── Sprint 8: Revisión de Propuestas y Merge ──

class BatchDecision(BaseModel):
    segment_id: uuid.UUID
    accion: str  # "aceptar" | "rechazar"


class BatchUpdateRequest(BaseModel):
    decisiones: list[BatchDecision]


class BatchUpdateResponse(BaseModel):
    actualizados: int
    errores: int
