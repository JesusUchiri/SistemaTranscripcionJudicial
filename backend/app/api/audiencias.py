"""
CRUD de audiencias.
POST, GET (list), GET (detail), PUT.
Multi-usuario: cada audiencia tiene created_by; transcriptor ve solo las suyas;
admin y supervisor ven todas.
"""
import uuid
from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.audiencia import Audiencia
from app.models.segmento import Segmento
from app.models.usuario import Usuario
from app.schemas.audiencia import (
    AudienciaCreate,
    AudienciaListResponse,
    AudienciaResponse,
    AudienciaUpdate,
)
import logging
from app.schemas.segmento import SegmentoResponse, BatchUpdateRequest, BatchUpdateResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/audiencias", tags=["audiencias"])


def _puede_acceder_audiencia(audiencia: Audiencia, usuario: Usuario) -> bool:
    """Transcriptor solo ve las suyas; admin y supervisor ven todas."""
    if usuario.rol in ("admin", "supervisor"):
        return True
    return audiencia.created_by == usuario.id


@router.post("", response_model=AudienciaResponse, status_code=status.HTTP_201_CREATED)
async def crear_audiencia(
    data: AudienciaCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Usuario, Depends(get_current_user)],
):
    audiencia = Audiencia(
        **data.model_dump(),
        created_by=current_user.id,
    )
    db.add(audiencia)
    await db.flush()
    await db.refresh(audiencia)
    return audiencia


@router.get("", response_model=AudienciaListResponse)
async def listar_audiencias(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Usuario, Depends(get_current_user)],
    fecha_desde: Optional[date] = Query(None),
    fecha_hasta: Optional[date] = Query(None),
    juzgado: Optional[str] = Query(None),
    estado: Optional[str] = Query(None),
    expediente: Optional[str] = Query(None),
    tipo_audiencia: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
):
    query = select(Audiencia)
    # Transcriptor solo ve sus audiencias; admin y supervisor ven todas
    if current_user.rol not in ("admin", "supervisor"):
        query = query.where(Audiencia.created_by == current_user.id)

    if fecha_desde:
        query = query.where(Audiencia.fecha >= fecha_desde)
    if fecha_hasta:
        query = query.where(Audiencia.fecha <= fecha_hasta)
    if juzgado:
        query = query.where(Audiencia.juzgado.ilike(f"%{juzgado}%"))
    if estado:
        query = query.where(Audiencia.estado == estado)
    if expediente:
        query = query.where(Audiencia.expediente.ilike(f"%{expediente}%"))
    if tipo_audiencia:
        query = query.where(Audiencia.tipo_audiencia == tipo_audiencia)

    # Count
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    # Pagination
    query = (
        query.order_by(Audiencia.fecha.desc(), Audiencia.hora_inicio.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )

    result = await db.execute(query)
    items = result.scalars().all()

    return AudienciaListResponse(items=items, total=total)


@router.get("/{audiencia_id}", response_model=AudienciaResponse)
async def obtener_audiencia(
    audiencia_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Usuario, Depends(get_current_user)],
):
    result = await db.execute(
        select(Audiencia).where(Audiencia.id == audiencia_id)
    )
    audiencia = result.scalar_one_or_none()
    if audiencia is None:
        raise HTTPException(status_code=404, detail="Audiencia no encontrada")
    if not _puede_acceder_audiencia(audiencia, current_user):
        raise HTTPException(status_code=404, detail="Audiencia no encontrada")
    return audiencia


@router.put("/{audiencia_id}", response_model=AudienciaResponse)
async def actualizar_audiencia(
    audiencia_id: uuid.UUID,
    data: AudienciaUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Usuario, Depends(get_current_user)],
):
    result = await db.execute(
        select(Audiencia).where(Audiencia.id == audiencia_id)
    )
    audiencia = result.scalar_one_or_none()
    if audiencia is None:
        raise HTTPException(status_code=404, detail="Audiencia no encontrada")
    if not _puede_acceder_audiencia(audiencia, current_user):
        raise HTTPException(status_code=404, detail="Audiencia no encontrada")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(audiencia, key, value)

    await db.flush()
    await db.refresh(audiencia)
    return audiencia


# ── Segmentos de una audiencia ───────────────────────────

@router.get("/{audiencia_id}/segmentos", response_model=list[SegmentoResponse])
async def obtener_segmentos(
    audiencia_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Usuario, Depends(get_current_user)],
):
    result = await db.execute(
        select(Audiencia).where(Audiencia.id == audiencia_id)
    )
    audiencia = result.scalar_one_or_none()
    if audiencia is None:
        raise HTTPException(status_code=404, detail="Audiencia no encontrada")
    if not _puede_acceder_audiencia(audiencia, current_user):
        raise HTTPException(status_code=404, detail="Audiencia no encontrada")
    result = await db.execute(
        select(Segmento)
        .where(Segmento.audiencia_id == audiencia_id)
        .order_by(Segmento.orden)
    )
    return result.scalars().all()


@router.put(
    "/{audiencia_id}/segmentos/{segmento_id}",
    response_model=SegmentoResponse,
)
async def editar_segmento(
    audiencia_id: uuid.UUID,
    segmento_id: uuid.UUID,
    data: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Usuario, Depends(get_current_user)],
):
    """Guardar texto editado por el digitador."""
    result = await db.execute(
        select(Audiencia).where(Audiencia.id == audiencia_id)
    )
    audiencia = result.scalar_one_or_none()
    if audiencia is None:
        raise HTTPException(status_code=404, detail="Audiencia no encontrada")
    if not _puede_acceder_audiencia(audiencia, current_user):
        raise HTTPException(status_code=404, detail="Audiencia no encontrada")
    result = await db.execute(
        select(Segmento).where(
            Segmento.id == segmento_id,
            Segmento.audiencia_id == audiencia_id,
        )
    )
    segmento = result.scalar_one_or_none()
    if segmento is None:
        raise HTTPException(status_code=404, detail="Segmento no encontrado")

    if "texto_editado" in data:
        segmento.texto_editado = data["texto_editado"]
        segmento.editado_por_usuario = True

    await db.flush()
    await db.refresh(segmento)
    return segmento


@router.post("/{audiencia_id}/segmentos/batch-update", response_model=BatchUpdateResponse)
async def batch_update_segmentos(
    audiencia_id: uuid.UUID,
    request: BatchUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Usuario, Depends(get_current_user)],
):
    """
    Sprint 8 F3: API batch-update.
    Acepta o rechaza múltiples propuestas batch de segmentos.
    Si se acepta, se actualiza el segmento (usando texto_batch como texto_mejorado/texto_ia).
    Si se rechaza, elimina la propuesta (texto_batch = None) para no volver a sugerir.
    """
    result = await db.execute(
        select(Audiencia).where(Audiencia.id == audiencia_id)
    )
    audiencia = result.scalar_one_or_none()
    if audiencia is None:
        raise HTTPException(status_code=404, detail="Audiencia no encontrada")
    if not _puede_acceder_audiencia(audiencia, current_user):
        raise HTTPException(status_code=403, detail="Sin permiso para esta audiencia")

    actualizados = 0
    errores = 0

    for decision in request.decisiones:
        try:
            # Buscar el segmento
            res = await db.execute(
                select(Segmento).where(
                    Segmento.id == decision.segment_id,
                    Segmento.audiencia_id == audiencia_id
                )
            )
            segmento = res.scalar_one_or_none()

            if not segmento:
                errores += 1
                continue
                
            # No procesamos si ya fue editado por el usuario
            if segmento.editado_por_usuario:
                errores += 1
                continue

            if decision.accion.lower() == "aceptar" and segmento.texto_batch:
                segmento.texto_mejorado = segmento.texto_batch
                segmento.texto_batch = None
                actualizados += 1
            elif decision.accion.lower() == "rechazar":
                segmento.texto_batch = None
                actualizados += 1
            else:
                errores += 1
        except Exception as e:
            logger.error(f"Error actualizando segmento {decision.segment_id}: {e}")
            errores += 1

    await db.commit()

    return BatchUpdateResponse(
        actualizados=actualizados,
        errores=errores
    )


# ── Audio de la audiencia ────────────────────────────────

@router.get("/{audiencia_id}/audio")
async def obtener_audio(
    audiencia_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Usuario, Depends(get_current_user)],
):
    """Servir el archivo WAV grabado de la audiencia."""
    import os
    from fastapi.responses import FileResponse

    result = await db.execute(
        select(Audiencia).where(Audiencia.id == audiencia_id)
    )
    audiencia = result.scalar_one_or_none()
    if audiencia is None:
        raise HTTPException(status_code=404, detail="Audiencia no encontrada")
    if not _puede_acceder_audiencia(audiencia, current_user):
        raise HTTPException(status_code=404, detail="Audiencia no encontrada")

    if not audiencia.audio_path or not os.path.exists(audiencia.audio_path):
        raise HTTPException(status_code=404, detail="Audio no disponible")

    # WAV con solo cabecera (44 bytes) o vacío no se puede decodificar en el navegador
    size = os.path.getsize(audiencia.audio_path)
    if size <= 44:
        raise HTTPException(
            status_code=404,
            detail="Audio no disponible (grabación vacía o sin datos)",
        )

    return FileResponse(
        audiencia.audio_path,
        media_type="audio/wav",
        filename=f"{audiencia.expediente}.wav",
    )
