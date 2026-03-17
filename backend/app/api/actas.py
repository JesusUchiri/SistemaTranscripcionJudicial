"""
API de Actas — generación y consulta de actas de audiencia.

POST generar-acta: genera borrador con Claude Sonnet 4
GET actas: lista versiones del acta
PUT acta: editar contenido del borrador
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.acta import Acta
from app.models.audiencia import Audiencia
from app.models.usuario import Usuario
from app.schemas.acta import ActaCreate, ActaResponse, ActaUpdate
from app.services.acta_generator import generar_acta

router = APIRouter(
    prefix="/api/audiencias/{audiencia_id}/actas",
    tags=["actas"],
)


@router.post("/generar", response_model=ActaResponse, status_code=201)
async def generar_acta_endpoint(
    audiencia_id: uuid.UUID,
    datos: ActaCreate,
    db: AsyncSession = Depends(get_db),
    usuario: Usuario = Depends(get_current_user),
):
    """
    Genera un borrador de acta oficial a partir de la transcripción.

    - Formato A: Juzgado Penal Unipersonal
    - Formato B: Sala Penal de Apelaciones (colegiado)

    Recopila todos los segmentos, metadatos y hablantes,
    los envía a Claude Sonnet 4 y guarda el resultado como borrador.
    """
    # Verificar que la audiencia existe
    result = await db.execute(
        select(Audiencia).where(Audiencia.id == audiencia_id)
    )
    audiencia = result.scalar_one_or_none()
    if not audiencia:
        raise HTTPException(status_code=404, detail="Audiencia no encontrada")

    try:
        acta = await generar_acta(
            audiencia_id=audiencia_id,
            formato=datos.formato,
            usuario_id=usuario.id,
            db=db,
        )
        return acta
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error generando acta: {str(e)}",
        )


@router.get("", response_model=list[ActaResponse])
async def listar_actas(
    audiencia_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _usuario: Usuario = Depends(get_current_user),
):
    """Lista todas las versiones del acta de una audiencia."""
    result = await db.execute(
        select(Acta)
        .where(Acta.audiencia_id == audiencia_id)
        .order_by(Acta.version.desc())
    )
    return result.scalars().all()


@router.get("/{acta_id}", response_model=ActaResponse)
async def obtener_acta(
    audiencia_id: uuid.UUID,
    acta_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _usuario: Usuario = Depends(get_current_user),
):
    """Obtiene una versión específica del acta."""
    result = await db.execute(
        select(Acta).where(
            Acta.id == acta_id,
            Acta.audiencia_id == audiencia_id,
        )
    )
    acta = result.scalar_one_or_none()
    if not acta:
        raise HTTPException(status_code=404, detail="Acta no encontrada")
    return acta


@router.put("/{acta_id}", response_model=ActaResponse)
async def editar_acta(
    audiencia_id: uuid.UUID,
    acta_id: uuid.UUID,
    datos: ActaUpdate,
    db: AsyncSession = Depends(get_db),
    usuario: Usuario = Depends(get_current_user),
):
    """Editar el contenido del acta o cambiar su estado."""
    result = await db.execute(
        select(Acta).where(
            Acta.id == acta_id,
            Acta.audiencia_id == audiencia_id,
        )
    )
    acta = result.scalar_one_or_none()
    if not acta:
        raise HTTPException(status_code=404, detail="Acta no encontrada")

    if datos.contenido_editado is not None:
        if acta.estado == "aprobada":
            raise HTTPException(status_code=400, detail="No se puede editar un acta aprobada")
        acta.contenido_editado = datos.contenido_editado

    if datos.estado is not None:
        if datos.estado not in ["borrador", "en_revision", "exportada"]:
            raise HTTPException(status_code=400, detail="Estado no válido por esta vía")
        acta.estado = datos.estado

    await db.commit()
    await db.refresh(acta)
    return acta


@router.post("/{acta_id}/aprobar", response_model=ActaResponse)
async def aprobar_acta(
    audiencia_id: uuid.UUID,
    acta_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    usuario: Usuario = Depends(get_current_user),
):
    """
    Sprint 9 F4: Flujo aprobar acta.
    Solo disponible para usuarios con rol supervisor o admin.
    Cambia el estado a 'aprobada' y registra quién y cuándo la aprobó.
    """
    if usuario.rol not in ("admin", "supervisor"):
        raise HTTPException(status_code=403, detail="No tiene permisos para aprobar actas")

    result = await db.execute(
        select(Acta).where(
            Acta.id == acta_id,
            Acta.audiencia_id == audiencia_id,
        )
    )
    acta = result.scalar_one_or_none()
    if not acta:
        raise HTTPException(status_code=404, detail="Acta no encontrada")

    if acta.estado == "aprobada":
        raise HTTPException(status_code=400, detail="El acta ya se encuentra aprobada")

    acta.estado = "aprobada"
    acta.aprobada_por = usuario.id
    
    from sqlalchemy import func
    acta.aprobada_at = func.now()

    await db.commit()
    await db.refresh(acta)
    return acta


@router.get("/{acta_id}/exportar/{formato}")
async def exportar_acta(
    audiencia_id: uuid.UUID,
    acta_id: uuid.UUID,
    formato: str,
    db: AsyncSession = Depends(get_db),
    usuario: Usuario = Depends(get_current_user),
):
    """
    Sprint 10: Exportación de Acta Oficial.
    Genera y descarga el acta en PDF o DOCX. Requiere que el acta exista en la BD.
    Se registra cada exportación en la tabla de auditoría (audit_log).
    """
    if formato not in ["pdf", "docx"]:
        raise HTTPException(status_code=400, detail="El formato debe ser 'pdf' o 'docx'")

    result = await db.execute(
        select(Acta)
        .join(Audiencia)
        .where(
            Acta.id == acta_id,
            Acta.audiencia_id == audiencia_id,
        )
    )
    acta = result.scalar_one_or_none()
    if not acta:
        raise HTTPException(status_code=404, detail="Acta no encontrada")

    # Audit log Registration
    from app.models.audit_log import AuditLog
    audit = AuditLog(
        accion=f"export_{formato}",
        entidad_tipo="acta",
        entidad_id=acta.id,
        usuario_id=usuario.id,
        detalles={"formato": formato, "actividad": "Exportación oficial"}
    )
    db.add(audit)
    await db.commit()

    import app.services.export_service as export_svc
    from fastapi.responses import Response

    if formato == "pdf":
        file_bytes = export_svc.generate_pdf(acta.audiencia, acta)
        media_type = "application/pdf"
        headers = {"Content-Disposition": f'attachment; filename="acta_{acta.audiencia.expediente}.pdf"'}
    else:
        file_bytes = export_svc.generate_docx(acta.audiencia, acta)
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        headers = {"Content-Disposition": f'attachment; filename="acta_{acta.audiencia.expediente}.docx"'}

    return Response(content=file_bytes, media_type=media_type, headers=headers)
