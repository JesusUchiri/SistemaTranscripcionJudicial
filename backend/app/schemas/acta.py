"""
Pydantic schemas para Acta.
"""
import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ActaCreate(BaseModel):
    formato: str = "A"  # A=Unipersonal, B=Apelaciones


class ActaResponse(BaseModel):
    id: uuid.UUID
    audiencia_id: uuid.UUID
    version: int
    formato: str
    estado: str
    contenido_llm: Optional[str] = None
    contenido_editado: Optional[str] = None
    modelo_llm: Optional[str] = None
    tokens_used: Optional[int] = None
    confianza: Optional[float] = None
    generado_por: uuid.UUID
    aprobada_por: Optional[uuid.UUID] = None
    aprobada_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ActaUpdate(BaseModel):
    contenido_editado: Optional[str] = None
    estado: Optional[str] = None
