"""
Endpoints de administración de usuarios (solo para admin).
Permite ver estadísticas de uso (conteo de transcripciones, costos).
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_role
from app.database import get_db
from app.models.audiencia import Audiencia
from app.models.usuario import Usuario
from app.schemas.users import UsuarioListResponse, UsuarioStats

router = APIRouter(prefix="/api/users", tags=["admin"])

# Costo por minuto (Deepgram Nova-2 aprox)
COSTO_MINUTO_USD = 0.0043


@router.get("", response_model=UsuarioListResponse)
async def list_users_with_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[Usuario, Depends(require_role("admin"))],
):
    """Retorna la lista de usuarios con estadísticas de transcripción y costo."""
    # Query for users
    users_query = select(Usuario).order_by(Usuario.created_at.desc())
    result = await db.execute(users_query)
    users = result.scalars().all()

    items = []
    for user in users:
        # Get count and duration for this user
        stats_query = select(
            func.count(Audiencia.id).label("count"),
            func.sum(Audiencia.audio_duration_seconds).label("total_duration"),
        ).where(Audiencia.created_by == user.id)
        
        stats_result = await db.execute(stats_query)
        stats = stats_result.one()
        
        count = stats.count or 0
        duration = float(stats.total_duration or 0)
        cost = (duration / 60) * COSTO_MINUTO_USD

        items.append(
            UsuarioStats(
                id=user.id,
                email=user.email,
                nombre=user.nombre,
                rol=user.rol,
                activo=user.activo,
                created_at=user.created_at,
                transcripciones_count=count,
                duracion_total_segundos=duration,
                costo_total_usd=cost,
            )
        )

    return UsuarioListResponse(items=items, total=len(items))


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[Usuario, Depends(require_role("admin"))],
):
    """Permite eliminar un usuario (no se puede eliminar a sí mismo)."""
    if admin.id == user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No puedes eliminarte a ti mismo.",
        )

    user = await db.get(Usuario, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado.",
        )

    # Check if user has audiencias (cascade delete? Or just set active=False?)
    # For now, let's just delete the user record (SQLAlchemy cascade should handle if defined)
    await db.delete(user)
    await db.commit()
    return None


@router.patch("/{user_id}/toggle-active", response_model=UsuarioStats)
async def toggle_user_active(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[Usuario, Depends(require_role("admin"))],
):
    """Activa o desactiva un usuario."""
    user = await db.get(Usuario, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado.",
        )

    user.activo = not user.activo
    await db.commit()
    await db.refresh(user)
    
    # Re-calculate stats for the response
    stats_query = select(
        func.count(Audiencia.id).label("count"),
        func.sum(Audiencia.audio_duration_seconds).label("total_duration"),
    ).where(Audiencia.created_by == user.id)
    
    stats_result = await db.execute(stats_query)
    stats = stats_result.one()
    
    count = stats.count or 0
    duration = float(stats.total_duration or 0)
    cost = (duration / 60) * COSTO_MINUTO_USD

    return UsuarioStats(
        id=user.id,
        email=user.email,
        nombre=user.nombre,
        rol=user.rol,
        activo=user.activo,
        created_at=user.created_at,
        transcripciones_count=count,
        duracion_total_segundos=duration,
        costo_total_usd=cost,
    )
