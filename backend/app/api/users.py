"""
Endpoints de administración de usuarios (solo para admin).
Permite ver estadísticas de uso (conteo de transcripciones, costos Deepgram + Claude).
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_role
from app.database import get_db
from app.models.acta import Acta
from app.models.audiencia import Audiencia
from app.models.uso_api import UsoApi
from app.models.usuario import Usuario
from app.schemas.users import UsuarioListResponse, UsuarioStats, UpdateRoleRequest
from app.services.cost_tracker import (
    DEEPGRAM_RATES,
    calcular_costo_claude,
    calcular_costo_deepgram,
    _get_claude_rates,
    CLAUDE_DEFAULT_RATES,
)

router = APIRouter(prefix="/api/users", tags=["admin"])


async def _get_user_stats(db: AsyncSession, user_id: uuid.UUID) -> dict:
    dg_query = select(
        func.count(Audiencia.id).label("count"),
        func.sum(Audiencia.audio_duration_seconds).label("total_duration"),
    ).where(Audiencia.created_by == user_id)
    dg_result = await db.execute(dg_query)
    dg = dg_result.one()

    count = dg.count or 0
    total_duration = float(dg.total_duration or 0)

    costo_query = select(
        func.sum(case((UsoApi.servicio.like("deepgram%"), UsoApi.costo_usd), else_=0.0)).label("costo_dg"),
        func.sum(case((UsoApi.servicio.like("claude%"), UsoApi.costo_usd), else_=0.0)).label("costo_cl"),
        func.count(UsoApi.id).label("registros"),
    ).where(UsoApi.usuario_id == user_id)
    
    costo_result = await db.execute(costo_query)
    costos = costo_result.one()

    costo_aud_query = select(
        func.sum(case((UsoApi.servicio.like("deepgram%"), UsoApi.costo_usd), else_=0.0)).label("costo_dg"),
        func.sum(case((UsoApi.servicio.like("claude%"), UsoApi.costo_usd), else_=0.0)).label("costo_cl"),
        func.count(UsoApi.id).label("registros"),
    ).where(
        UsoApi.audiencia_id.in_(select(Audiencia.id).where(Audiencia.created_by == user_id)),
        UsoApi.usuario_id.is_(None),
    )
    costo_aud_result = await db.execute(costo_aud_query)
    costos_aud = costo_aud_result.one()

    total_registros = (costos.registros or 0) + (costos_aud.registros or 0)
    costo_deepgram_real = float(costos.costo_dg or 0) + float(costos_aud.costo_dg or 0)
    costo_claude_real = float(costos.costo_cl or 0) + float(costos_aud.costo_cl or 0)

    if total_registros > 0:
        return {
            "count": count,
            "duration": total_duration,
            "costo_deepgram": costo_deepgram_real,
            "costo_claude": costo_claude_real,
        }

    costo_deepgram = calcular_costo_deepgram(total_duration, modo="streaming", diarize=True)
    return {
        "count": count,
        "duration": total_duration,
        "costo_deepgram": costo_deepgram,
        "costo_claude": 0.0,
    }


@router.get("", response_model=UsuarioListResponse)
async def list_users_with_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[Usuario, Depends(require_role("admin"))],
):
    users_query = select(Usuario).order_by(Usuario.created_at.desc())
    result = await db.execute(users_query)
    users = result.scalars().all()

    items = []
    for user in users:
        if user.rol == "admin":
            items.append(UsuarioStats(
                id=user.id, email=user.email, nombre=user.nombre,
                rol=user.rol, activo=user.activo, created_at=user.created_at,
                transcripciones_count=0, duracion_total_segundos=0.0,
                costo_deepgram_usd=0.0, costo_claude_usd=0.0, costo_total_usd=0.0,
            ))
            continue

        s = await _get_user_stats(db, user.id)
        items.append(UsuarioStats(
            id=user.id, email=user.email, nombre=user.nombre,
            rol=user.rol, activo=user.activo, created_at=user.created_at,
            transcripciones_count=s["count"],
            duracion_total_segundos=s["duration"],
            costo_deepgram_usd=s["costo_deepgram"],
            costo_claude_usd=s["costo_claude"],
            costo_total_usd=s["costo_deepgram"] + s["costo_claude"],
        ))

    return UsuarioListResponse(items=items, total=len(items))


@router.patch("/{user_id}/role", response_model=UsuarioStats)
async def update_user_role(
    user_id: uuid.UUID,
    request: UpdateRoleRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[Usuario, Depends(require_role("admin"))],
):
    if admin.id == user_id:
        raise HTTPException(status_code=400, detail="No puedes cambiar tu propio rol.")

    if request.rol not in ("admin", "transcriptor", "supervisor"):
        raise HTTPException(status_code=400, detail="Rol inválido.")

    user = await db.get(Usuario, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    user.rol = request.rol
    await db.commit()
    await db.refresh(user)

    if user.rol == "admin":
        return UsuarioStats(
            id=user.id, email=user.email, nombre=user.nombre,
            rol=user.rol, activo=user.activo, created_at=user.created_at,
            transcripciones_count=0, duracion_total_segundos=0.0,
            costo_deepgram_usd=0.0, costo_claude_usd=0.0, costo_total_usd=0.0,
        )

    s = await _get_user_stats(db, user.id)
    return UsuarioStats(
        id=user.id, email=user.email, nombre=user.nombre,
        rol=user.rol, activo=user.activo, created_at=user.created_at,
        transcripciones_count=s["count"],
        duracion_total_segundos=s["duration"],
        costo_deepgram_usd=s["costo_deepgram"],
        costo_claude_usd=s["costo_claude"],
        costo_total_usd=s["costo_deepgram"] + s["costo_claude"],
    )


@router.patch("/{user_id}/toggle-active", response_model=UsuarioStats)
async def toggle_user_active(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[Usuario, Depends(require_role("admin"))],
):
    user = await db.get(Usuario, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    user.activo = not user.activo
    await db.commit()
    await db.refresh(user)

    if user.rol == "admin":
        return UsuarioStats(
            id=user.id, email=user.email, nombre=user.nombre,
            rol=user.rol, activo=user.activo, created_at=user.created_at,
            transcripciones_count=0, duracion_total_segundos=0.0,
            costo_deepgram_usd=0.0, costo_claude_usd=0.0, costo_total_usd=0.0,
        )

    s = await _get_user_stats(db, user.id)
    return UsuarioStats(
        id=user.id, email=user.email, nombre=user.nombre,
        rol=user.rol, activo=user.activo, created_at=user.created_at,
        transcripciones_count=s["count"],
        duracion_total_segundos=s["duration"],
        costo_deepgram_usd=s["costo_deepgram"],
        costo_claude_usd=s["costo_claude"],
        costo_total_usd=s["costo_deepgram"] + s["costo_claude"],
    )


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: Annotated[Usuario, Depends(require_role("admin"))],
):
    if admin.id == user_id:
        raise HTTPException(status_code=400, detail="No puedes eliminarte a ti mismo.")

    user = await db.get(Usuario, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")

    await db.delete(user)
    await db.commit()
    return None
