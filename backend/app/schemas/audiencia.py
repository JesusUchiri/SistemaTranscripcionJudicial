"""
Pydantic schemas para Audiencia.
"""
import uuid
from datetime import date, datetime, time
from typing import Optional

from pydantic import BaseModel


class AudienciaCreate(BaseModel):
    expediente: str
    juzgado: str
    tipo_audiencia: str
    instancia: str
    fecha: date
    hora_inicio: time
    hora_fin: Optional[time] = None
    sala: Optional[str] = None
    delito: Optional[str] = None
    imputado_nombre: Optional[str] = None
    agraviado_nombre: Optional[str] = None
    especialista_causa: Optional[str] = None
    especialista_audiencia: Optional[str] = None


class AudienciaUpdate(BaseModel):
    hora_fin: Optional[time] = None
    sala: Optional[str] = None
    delito: Optional[str] = None
    imputado_nombre: Optional[str] = None
    agraviado_nombre: Optional[str] = None
    especialista_causa: Optional[str] = None
    especialista_audiencia: Optional[str] = None
    estado: Optional[str] = None
    audio_path: Optional[str] = None
    audio_duration_seconds: Optional[float] = None


class AudienciaResponse(BaseModel):
    id: uuid.UUID
    expediente: str
    juzgado: str
    tipo_audiencia: str
    instancia: str
    fecha: date
    hora_inicio: time
    hora_fin: Optional[time]
    sala: Optional[str]
    delito: Optional[str]
    imputado_nombre: Optional[str]
    agraviado_nombre: Optional[str]
    especialista_causa: Optional[str]
    especialista_audiencia: Optional[str]
    estado: str
    audio_path: Optional[str]
    audio_duration_seconds: Optional[float]
    deepgram_session_id: Optional[str]
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime

    costo_deepgram_usd: Optional[float] = 0.0
    costo_claude_usd: Optional[float] = 0.0

    model_config = {"from_attributes": True}


class AudienciaListResponse(BaseModel):
    items: list[AudienciaResponse]
    total: int
