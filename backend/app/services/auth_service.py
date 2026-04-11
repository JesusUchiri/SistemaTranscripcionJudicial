"""
Servicio de autenticación: JWT + bcrypt + Google OAuth.
Access token (15min) + Refresh token (7d) con httpOnly cookie.
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from app.config import settings
from app.models.usuario import Usuario
from app.schemas.auth import TokenData


def hash_password(password: str) -> str:
    """Hashea una contraseña con bcrypt."""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Verifica una contraseña contra su hash bcrypt."""
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(
    user_id: uuid.UUID, rol: str, expires_delta: Optional[timedelta] = None
) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload = {
        "sub": str(user_id),
        "rol": rol,
        "exp": expire,
        "type": "access",
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(user_id: uuid.UUID) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )
    payload = {
        "sub": str(user_id),
        "exp": expire,
        "type": "refresh",
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> Optional[TokenData]:
    """Decode and validate a JWT token."""
    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
        user_id = payload.get("sub")
        rol = payload.get("rol")
        if user_id is None:
            return None
        return TokenData(user_id=uuid.UUID(user_id), rol=rol)
    except JWTError:
        return None


async def authenticate_user(
    db: AsyncSession, email: str, password: str
) -> Optional[Usuario]:
    """Verify credentials and return user or None."""
    result = await db.execute(select(Usuario).where(Usuario.email == email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        return None
    if not user.activo:
        return None
    return user


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> Optional[Usuario]:
    result = await db.execute(select(Usuario).where(Usuario.id == user_id))
    return result.scalar_one_or_none()


async def authenticate_google_user(
    db: AsyncSession, google_id_token: str
) -> Optional[Usuario]:
    """Verifica el token de Google y devuelve el usuario (lo crea si no existe)."""
    try:
        # Si no hay ID de cliente configurado, lanzamos error informativo
        if not settings.GOOGLE_CLIENT_ID:
            print("GOOGLE_CLIENT_ID no está configurado.")
            return None

        # Verificar el token con Google
        idinfo = id_token.verify_oauth2_token(
            google_id_token, google_requests.Request(), settings.GOOGLE_CLIENT_ID
        )

        email = idinfo["email"]
        nombre = idinfo.get("name", email.split("@")[0])

        # Buscar usuario por email
        result = await db.execute(select(Usuario).where(Usuario.email == email))
        user = result.scalar_one_or_none()

        if user is None:
            # Crear usuario nuevo como transcriptor (digitador) por defecto
            user = Usuario(
                email=email,
                nombre=nombre,
                # Password aleatorio para cumplir con la restricción de NOT NULL
                password_hash=hash_password(str(uuid.uuid4())),
                rol="transcriptor",
                activo=True
            )
            db.add(user)
            await db.flush()
            await db.refresh(user)
        
        if not user.activo:
            return None
            
        return user

    except Exception as e:
        print(f"Error en Google Auth: {e}")
        return None
