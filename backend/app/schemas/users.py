"""
Pydantic schemas para administración de usuarios.
"""
import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class UsuarioStats(BaseModel):
    id: uuid.UUID
    email: str
    nombre: str
    rol: str
    activo: bool
    created_at: datetime
    transcripciones_count: int
    duracion_total_segundos: float
    costo_deepgram_usd: float
    costo_claude_usd: float
    costo_total_usd: float  # deepgram + claude

    model_config = {"from_attributes": True}


class UsuarioListResponse(BaseModel):
    items: list[UsuarioStats]
    total: int


class UpdateRoleRequest(BaseModel):
    rol: str
