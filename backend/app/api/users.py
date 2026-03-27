"""
Endpoints de administración de usuarios (solo para admin).
Permite ver estadísticas de uso (conteo de transcripciones, costos Deepgram + Claude).

Fuente de costos:
  1° Registros reales de la tabla `uso_api` (datos exactos de cada llamada API)
  2° Estimación legacy a partir de duración y tokens (fallback para datos antiguos)
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_role
from app.database import get_db
from app.models.acta import Acta
from app.models.audiencia import Audiencia
from app.models.uso_api import UsoApi
from app.models.usuario import Usuario
from app.schemas.users import UsuarioListResponse, UsuarioStats
from app.services.cost_tracker import (
    DEEPGRAM_RATES,
    calcular_costo_claude,
    calcular_costo_deepgram,
    _get_claude_rates,
    CLAUDE_DEFAULT_RATES,
)

router = APIRouter(prefix="/api/users", tags=["admin"])


async def _get_user_stats(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """
    Calcula transcripciones, duración y costos para un usuario.

    Usa datos reales de la tabla `uso_api` cuando existen.
    Para datos legacy (antes del sistema de tracking), estima usando
    la duración de audio y tokens de actas.
    """
    # ── Conteo y duración total ──
    dg_query = select(
        func.count(Audiencia.id).label("count"),
        func.sum(Audiencia.audio_duration_seconds).label("total_duration"),
    ).where(Audiencia.created_by == user_id)
    dg_result = await db.execute(dg_query)
    dg = dg_result.one()

    count = dg.count or 0
    total_duration = float(dg.total_duration or 0)

    # ── Costos REALES desde uso_api ──
    # Buscar registros de uso vinculados a audiencias de este usuario
    costo_query = select(
        func.sum(
            func.case(
                (UsoApi.servicio.like("deepgram%"), UsoApi.costo_usd),
                else_=0.0,
            )
        ).label("costo_dg"),
        func.sum(
            func.case(
                (UsoApi.servicio.like("claude%"), UsoApi.costo_usd),
                else_=0.0,
            )
        ).label("costo_cl"),
        func.count(UsoApi.id).label("registros"),
    ).where(
        UsoApi.usuario_id == user_id,
    )
    costo_result = await db.execute(costo_query)
    costos = costo_result.one()

    # También buscar por audiencia_id (algunas llamadas se vinculan por audiencia)
    costo_aud_query = select(
        func.sum(
            func.case(
                (UsoApi.servicio.like("deepgram%"), UsoApi.costo_usd),
                else_=0.0,
            )
        ).label("costo_dg"),
        func.sum(
            func.case(
                (UsoApi.servicio.like("claude%"), UsoApi.costo_usd),
                else_=0.0,
            )
        ).label("costo_cl"),
        func.count(UsoApi.id).label("registros"),
    ).where(
        UsoApi.audiencia_id.in_(
            select(Audiencia.id).where(Audiencia.created_by == user_id)
        ),
        UsoApi.usuario_id.is_(None),  # Solo los que no están ya contados por usuario
    )
    costo_aud_result = await db.execute(costo_aud_query)
    costos_aud = costo_aud_result.one()

    total_registros = (costos.registros or 0) + (costos_aud.registros or 0)
    costo_deepgram_real = float(costos.costo_dg or 0) + float(costos_aud.costo_dg or 0)
    costo_claude_real = float(costos.costo_cl or 0) + float(costos_aud.costo_cl or 0)

    if total_registros > 0:
        # Hay registros reales → usarlos
        return {
            "count": count,
            "duration": total_duration,
            "costo_deepgram": costo_deepgram_real,
            "costo_claude": costo_claude_real,
        }

    # ── FALLBACK LEGACY: estimar a partir de duración y tokens ──
    # (para datos creados antes del sistema de tracking)
    costo_deepgram = calcular_costo_deepgram(total_duration, modo="streaming", diarize=True)

    # Claude: tokens de actas (legacy)
    claude_query = select(
        func.sum(Acta.tokens_used).label("total_tokens"),
        Acta.modelo_llm,
    ).join(
        Audiencia, Acta.audiencia_id == Audiencia.id
    ).where(
        Audiencia.created_by == user_id,
        Acta.tokens_used.isnot(None),
    ).group_by(Acta.modelo_llm)

    claude_result = await db.execute(claude_query)
    claude_rows = claude_result.all()

    costo_claude = 0.0
    for row in claude_rows:
        tokens = float(row.total_tokens or 0)
        rates = _get_claude_rates(row.modelo_llm) if row.modelo_llm else CLAUDE_DEFAULT_RATES
        # Estimación ponderada 70/30 para legacy
        rate_ponderado = 0.70 * rates["input"] + 0.30 * rates["output"]
        costo_claude += tokens * rate_ponderado

    return {
        "count": count,
        "duration": total_duration,
        "costo_deepgram": costo_deepgram,
        "costo_claude": costo_claude,
    }


@router.get("", response_model=UsuarioListResponse)
async def list_users_with_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[Usuario, Depends(require_role("admin"))],
):
    """Retorna la lista de usuarios con estadísticas de transcripción y costo."""
    users_query = select(Usuario).order_by(Usuario.created_at.desc())
    result = await db.execute(users_query)
    users = result.scalars().all()

    items = []
    for user in users:
        # Admins no realizan transcripciones
        if user.rol == "admin":
            items.append(UsuarioStats(
                id=user.id,
                email=user.email,
                nombre=user.nombre,
                rol=user.rol,
                activo=user.activo,
                created_at=user.created_at,
                transcripciones_count=0,
                duracion_total_segundos=0.0,
                costo_deepgram_usd=0.0,
                costo_claude_usd=0.0,
                costo_total_usd=0.0,
            ))
            continue

        s = await _get_user_stats(db, user.id)
        items.append(UsuarioStats(
            id=user.id,
            email=user.email,
            nombre=user.nombre,
            rol=user.rol,
            activo=user.activo,
            created_at=user.created_at,
            transcripciones_count=s["count"],
            duracion_total_segundos=s["duration"],
            costo_deepgram_usd=s["costo_deepgram"],
            costo_claude_usd=s["costo_claude"],
            costo_total_usd=s["costo_deepgram"] + s["costo_claude"],
        ))

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
