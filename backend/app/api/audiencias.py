"""
CRUD de audiencias.
POST, GET (list), GET (detail), PUT.
Multi-usuario: cada audiencia tiene created_by; transcriptor ve solo las suyas;
admin y supervisor ven todas.
"""
import uuid
from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
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

    # Inyectar costos desde UsoApi
    if items:
        from app.models.uso_api import UsoApi
        audiencia_ids = [item.id for item in items]
        
        # Agrupar por audiencia y servicio
        costos_query = select(
            UsoApi.audiencia_id,
            func.sum(func.case((UsoApi.servicio.like("deepgram%"), UsoApi.costo_usd), else_=0.0)).label("dg_cost"),
            func.sum(func.case((UsoApi.servicio.like("claude%"), UsoApi.costo_usd), else_=0.0)).label("cl_cost")
        ).where(
            UsoApi.audiencia_id.in_(audiencia_ids)
        ).group_by(UsoApi.audiencia_id)

        costos_res = await db.execute(costos_query)
        costos_map = {row.audiencia_id: {"dg": row.dg_cost or 0.0, "cl": row.cl_cost or 0.0} for row in costos_res.all()}

        for item in items:
            c = costos_map.get(item.id, {"dg": 0.0, "cl": 0.0})
            setattr(item, "costo_deepgram_usd", c["dg"])
            setattr(item, "costo_claude_usd", c["cl"])
    else:
        for item in items:
            setattr(item, "costo_deepgram_usd", 0.0)
            setattr(item, "costo_claude_usd", 0.0)

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

    # Inyectar costos desde UsoApi
    from app.models.uso_api import UsoApi
    dg = await db.execute(
        select(func.sum(UsoApi.costo_usd)).where(UsoApi.audiencia_id == audiencia_id, UsoApi.servicio.like("deepgram%"))
    )
    cl = await db.execute(
        select(func.sum(UsoApi.costo_usd)).where(UsoApi.audiencia_id == audiencia_id, UsoApi.servicio.like("claude%"))
    )
    setattr(audiencia, "costo_deepgram_usd", dg.scalar() or 0.0)
    setattr(audiencia, "costo_claude_usd", cl.scalar() or 0.0)

    # Conteo de segmentos (para polling del estado de transcripción)
    seg_count = await db.execute(
        select(func.count()).select_from(Segmento).where(Segmento.audiencia_id == audiencia_id)
    )
    setattr(audiencia, "total_segmentos", seg_count.scalar() or 0)

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

    if "speaker_id" in data:
        segmento.speaker_id = data["speaker_id"]

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


# ── Merge segmentos ─────────────────────────────────────

@router.post("/{audiencia_id}/segmentos/merge", response_model=SegmentoResponse)
async def merge_segmentos(
    audiencia_id: uuid.UUID,
    data: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Usuario, Depends(get_current_user)],
):
    """
    Fusiona varios segmentos consecutivos en uno solo.
    Útil cuando se cambia el hablante de un segmento y coincide con el adyacente.
    body: { segment_ids: [uuid, uuid, ...] }
    """
    segment_ids = data.get("segment_ids", [])
    if len(segment_ids) < 2:
        raise HTTPException(status_code=400, detail="Se necesitan al menos 2 segmentos para fusionar")

    result = await db.execute(
        select(Segmento)
        .where(
            Segmento.audiencia_id == audiencia_id,
            Segmento.id.in_([uuid.UUID(str(sid)) for sid in segment_ids]),
        )
        .order_by(Segmento.orden)
    )
    segs = result.scalars().all()
    if len(segs) < 2:
        raise HTTPException(status_code=404, detail="Segmentos no encontrados")

    # Merge: keep the first, accumulate the rest
    first = segs[0]
    rest = segs[1:]

    # Combine texts
    textos_ia = [first.texto_ia]
    textos_mejorados = [first.texto_mejorado] if first.texto_mejorado else []
    textos_editados = [first.texto_editado] if first.texto_editado else []
    palabras = list(first.palabras_json or [])

    for seg in rest:
        textos_ia.append(seg.texto_ia)
        if seg.texto_mejorado:
            textos_mejorados.append(seg.texto_mejorado)
        if seg.texto_editado:
            textos_editados.append(seg.texto_editado)
        palabras.extend(seg.palabras_json or [])

    first.texto_ia = " ".join(textos_ia)
    if textos_mejorados:
        first.texto_mejorado = " ".join(textos_mejorados)
    if textos_editados:
        first.texto_editado = " ".join(textos_editados)
        first.editado_por_usuario = True
    first.timestamp_fin = segs[-1].timestamp_fin
    first.palabras_json = palabras if palabras else None
    first.es_provisional = False

    # Delete the rest
    for seg in rest:
        await db.delete(seg)

    await db.commit()
    await db.refresh(first)
    return first


# ── Audio de la audiencia ────────────────────────────────

@router.get("/{audiencia_id}/audio")
async def obtener_audio(
    audiencia_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[Usuario, Depends(get_current_user)],
    request: Request,
):
    """
    Sirve el archivo de audio con soporte de Range requests (necesario para seeking en WaveSurfer).
    Detecta el MIME type real por extensión para todos los formatos soportados.
    """
    import os
    from fastapi.responses import StreamingResponse

    _MIME_MAP = {
        ".wav":  "audio/wav",
        ".wave": "audio/wav",
        ".mp3":  "audio/mpeg",
        ".mp4":  "audio/mp4",
        ".m4a":  "audio/mp4",
        ".ogg":  "audio/ogg",
        ".oga":  "audio/ogg",
        ".webm": "audio/webm",
        ".flac": "audio/flac",
        ".aac":  "audio/aac",
        ".opus": "audio/ogg; codecs=opus",
    }

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

    file_size = os.path.getsize(audiencia.audio_path)
    if file_size < 8:
        raise HTTPException(status_code=404, detail="Audio no disponible (archivo vacío)")

    ext = os.path.splitext(audiencia.audio_path)[1].lower()
    media_type = _MIME_MAP.get(ext, "application/octet-stream")
    safe_name = "".join(c if c.isalnum() or c in "-_." else "_" for c in audiencia.expediente)
    content_disposition = f'inline; filename="{safe_name}{ext}"'

    # Soporte de Range requests para seeking en el navegador y WaveSurfer
    range_header = request.headers.get("range")
    if range_header:
        try:
            range_val = range_header.strip().replace("bytes=", "")
            start_str, end_str = range_val.split("-")
            start = int(start_str)
            end = int(end_str) if end_str else file_size - 1
            end = min(end, file_size - 1)
            chunk_size = end - start + 1

            def iterfile(path: str, s: int, length: int):
                with open(path, "rb") as f:
                    f.seek(s)
                    remaining = length
                    while remaining > 0:
                        data = f.read(min(65536, remaining))
                        if not data:
                            break
                        remaining -= len(data)
                        yield data

            return StreamingResponse(
                iterfile(audiencia.audio_path, start, chunk_size),
                status_code=206,
                media_type=media_type,
                headers={
                    "Content-Range": f"bytes {start}-{end}/{file_size}",
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(chunk_size),
                    "Content-Disposition": content_disposition,
                },
            )
        except Exception:
            pass  # Fallback a respuesta completa

    # Respuesta completa (sin Range)
    def iterfile_full(path: str):
        with open(path, "rb") as f:
            while True:
                data = f.read(65536)
                if not data:
                    break
                yield data

    return StreamingResponse(
        iterfile_full(audiencia.audio_path),
        status_code=200,
        media_type=media_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Disposition": content_disposition,
        },
    )
