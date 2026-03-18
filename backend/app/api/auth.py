"""
Endpoints de autenticación: login, register, refresh.
"""
import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_role
from app.config import settings
from app.database import get_db
from app.models.usuario import Usuario
from app.schemas.auth import (
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UsuarioResponse,
)
from app.services.auth_service import (
    authenticate_user,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(
    request: LoginRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    try:
        user = await authenticate_user(db, request.email, request.password)
    except Exception as e:
        err_msg = str(e).lower()
        if any(x in err_msg for x in ("connection", "connect", "refused", "timeout", "network", "unreachable")):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No se pudo conectar a la base de datos. Revisa backend/CONECTAR_DOKPLOY_LOCAL.txt (túnel SSH o que Postgres/Redis sean accesibles).",
            )
        raise

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas",
        )

    access_token = create_access_token(user.id, user.rol)
    refresh_token = create_refresh_token(user.id)

    # En producción (HTTPS + dominios cruzados): secure=True, samesite="none"
    is_production = settings.ENVIRONMENT == "production"
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=is_production,
        samesite="none" if is_production else "lax",
        max_age=7 * 24 * 3600,  # 7 days
    )

    return TokenResponse(access_token=access_token)


@router.post("/register", response_model=UsuarioResponse)
async def register(
    request: RegisterRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[Usuario, Depends(require_role("admin"))],
):
    """Solo un admin puede registrar usuarios nuevos."""
    # Check if email exists
    existing = await db.execute(
        select(Usuario).where(Usuario.email == request.email)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El email ya está registrado",
        )

    if request.rol not in ("admin", "transcriptor", "supervisor"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Rol inválido",
        )

    user = Usuario(
        email=request.email,
        nombre=request.nombre,
        password_hash=hash_password(request.password),
        rol=request.rol,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Renovar access token usando refresh token (cookie httpOnly o body)."""
    token = request.cookies.get("refresh_token") or ""
    if not token:
        body = await request.body()
        if body:
            try:
                token = json.loads(body).get("refresh_token", "") or token
            except (json.JSONDecodeError, TypeError):
                pass
    token_data = decode_token(token)
    if token_data is None or token_data.user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token inválido",
        )

    from app.services.auth_service import get_user_by_id
    user = await get_user_by_id(db, token_data.user_id)
    if user is None or not user.activo:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario no encontrado",
        )

    access_token = create_access_token(user.id, user.rol)
    return TokenResponse(access_token=access_token)


@router.get("/me", response_model=UsuarioResponse)
async def get_me(
    current_user: Annotated[Usuario, Depends(get_current_user)],
):
    return current_user
