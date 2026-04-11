"""
Pydantic schemas para autenticación.
"""
import uuid
from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: str
    password: str


class GoogleLoginRequest(BaseModel):
    id_token: str


class RegisterRequest(BaseModel):
    email: str
    nombre: str
    password: str
    rol: str = "transcriptor"


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    user_id: uuid.UUID | None = None
    rol: str | None = None


class UsuarioResponse(BaseModel):
    id: uuid.UUID
    email: str
    nombre: str
    rol: str
    activo: bool

    model_config = {"from_attributes": True}
