"""
Endpoints de administración de usuarios (solo para admin).
Permite ver estadísticas de uso (conteo de transcripciones, costos Deepgram + Claude).
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
from app.models.usuario import Usuario
from app.schemas.users import UsuarioListResponse, UsuarioStats

router = APIRouter(prefix="/api/users", tags=["admin"])

# ── Deepgram Nova-3 pricing ─────────────────────────────────────────
# https://deepgram.com/pricing
# Pre-recorded (batch): $0.0043 / min
# Streaming:            $0.0059 / min
DEEPGRAM_BATCH_USD_PER_MIN = 0.0043
DEEPGRAM_STREAM_USD_PER_MIN = 0.0059

# ── Claude pricing (USD per token) ─────────────────────────────────
# Estimación conservadora: ~70% input / 30% output
# claude-3-5-haiku: input $0.80/MTok, output $4.00/MTok  → ~$0.0000016/tok
# claude-sonnet-4:  input $3.00/MTok, output $15.00/MTok → ~$0.0000066/tok
CLAUDE_COST_PER_TOKEN: dict[str, float] = {
    "claude-3-haiku":    0.00000028,  # $0.25/$1.25 per MTok input/output (Claude 3 Haiku)
    "claude-3-5-haiku":  0.0000016,   # $0.80/$4.00 per MTok
    "claude-haiku-4-5":  0.0000016,
    "claude-3-5-sonnet": 0.0000066,   # $3/$15 per MTok
    "claude-sonnet-4":   0.0000066,
}
CLAUDE_COST_DEFAULT = 0.00000028  # fallback (claude-3-haiku, el más barato)


def _claude_cost_per_token(modelo: str | None) -> float:
    if not modelo:
        return CLAUDE_COST_DEFAULT
    for key, rate in CLAUDE_COST_PER_TOKEN.items():
        if key in modelo:
            return rate
    return CLAUDE_COST_DEFAULT


async def _get_user_stats(db: AsyncSession, user_id: uuid.UUID) -> dict:
    """Calcula transcripciones, duración y costos para un usuario."""
    # Deepgram: sum duration from audiencias
    dg_query = select(
        func.count(Audiencia.id).label("count"),
        func.sum(Audiencia.audio_duration_seconds).label("total_duration"),
    ).where(Audiencia.created_by == user_id)
    dg_result = await db.execute(dg_query)
    dg = dg_result.one()

    count = dg.count or 0
    duration = float(dg.total_duration or 0)
    # Assume streaming for audiencias without explicit fuente (conservative: streaming rate)
    costo_deepgram = (duration / 60) * DEEPGRAM_STREAM_USD_PER_MIN

    # Claude: sum tokens from actas linked to this user's audiencias
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

    costo_claude = sum(
        float(row.total_tokens or 0) * _claude_cost_per_token(row.modelo_llm)
        for row in claude_rows
    )

    return {
        "count": count,
        "duration": duration,
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
