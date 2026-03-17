"""
API de Frases Estándar — frases rápidas con atajo Ctrl+[0-9].

Frases predefinidas del sistema y personalizadas por usuario
para inserción rápida durante la transcripción. 
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.frase_estandar import FraseEstandar
from app.models.usuario import Usuario
from app.schemas.frase_estandar import (
    FraseEstandarCreate,
    FraseEstandarUpdate,
    FraseEstandarResponse,
)

router = APIRouter(prefix="/api/frases", tags=["frases-estándar"])


# ── Frases del sistema por defecto ──
FRASES_SISTEMA = [
    {"numero_atajo": 1, "codigo": "F01", "texto": "SE DEJA CONSTANCIA QUE LA PRESENTE AUDIENCIA SE DESARROLLA DE MANERA VIRTUAL, A TRAVÉS DE LA PLATAFORMA GOOGLE MEET.", "categoria": "identificación"},
    {"numero_atajo": 2, "codigo": "F02", "texto": "HACE USO DE LA PALABRA EL/LA REPRESENTANTE DEL MINISTERIO PÚBLICO.", "categoria": "desarrollo"},
    {"numero_atajo": 3, "codigo": "F03", "texto": "HACE USO DE LA PALABRA LA DEFENSA TÉCNICA DEL ACUSADO/A.", "categoria": "desarrollo"},
    {"numero_atajo": 4, "codigo": "F04", "texto": "SEGUIDAMENTE SE LE CONCEDE EL USO DE LA PALABRA AL ACUSADO/A PARA QUE EJERZA SU DERECHO DE AUTODEFENSA.", "categoria": "desarrollo"},
    {"numero_atajo": 5, "codigo": "F05", "texto": "SE DEJA CONSTANCIA QUE SE HA PROCEDIDO A ORALIZAR LA PRUEBA DOCUMENTAL.", "categoria": "desarrollo"},
    {"numero_atajo": 6, "codigo": "F06", "texto": "SE SUSPENDE LA AUDIENCIA PARA CONTINUARLA EL DÍA {FECHA} A LAS {HORA} HORAS.", "categoria": "cierre"},
    {"numero_atajo": 7, "codigo": "F07", "texto": "SE DA POR CONCLUIDA LA PRESENTE AUDIENCIA, FIRMANDO LOS QUE EN ELLA INTERVINIERON.", "categoria": "cierre"},
    {"numero_atajo": 8, "codigo": "F08", "texto": "QUEDA CONSENTIDA LA RESOLUCIÓN AL NO SER IMPUGNADA POR LAS PARTES.", "categoria": "cierre"},
    {"numero_atajo": 9, "codigo": "F09", "texto": "SE PROCEDE AL EXAMEN DEL TESTIGO/PERITO, PREVIA JURAMENTACIÓN DE LEY.", "categoria": "desarrollo"},
    {"numero_atajo": 0, "codigo": "F10", "texto": "SIENDO LAS {HORA} HORAS DEL DÍA {FECHA}, SE DA INICIO A LA PRESENTE AUDIENCIA.", "categoria": "identificación"},
]


@router.get("", response_model=list[FraseEstandarResponse])
async def listar_frases(
    db: AsyncSession = Depends(get_db),
    usuario: Usuario = Depends(get_current_user),
):
    """
    Lista las frases estándar disponibles para el usuario.
    Incluye las del sistema (usuario_id = null) y las personalizadas del usuario.
    """
    resultado = await db.execute(
        select(FraseEstandar)
        .where(
            or_(
                FraseEstandar.usuario_id == None,  # noqa: E711
                FraseEstandar.usuario_id == usuario.id,
            )
        )
        .order_by(FraseEstandar.numero_atajo)
    )
    return resultado.scalars().all()


@router.post("/seed", status_code=201)
async def sembrar_frases_sistema(
    db: AsyncSession = Depends(get_db),
    _usuario: Usuario = Depends(get_current_user),
):
    """
    Siembra las frases del sistema por defecto.
    Solo se ejecuta si no existen frases del sistema.
    """
    existentes = await db.execute(
        select(FraseEstandar).where(FraseEstandar.usuario_id == None)  # noqa: E711
    )
    if existentes.scalars().first():
        return {"message": "Las frases del sistema ya existen"}

    for frase_data in FRASES_SISTEMA:
        frase = FraseEstandar(**frase_data)
        db.add(frase)

    await db.commit()
    return {"message": f"Se crearon {len(FRASES_SISTEMA)} frases del sistema"}


@router.post("", response_model=FraseEstandarResponse, status_code=201)
async def crear_frase(
    datos: FraseEstandarCreate,
    db: AsyncSession = Depends(get_db),
    usuario: Usuario = Depends(get_current_user),
):
    """Crea una frase personalizada del usuario."""
    frase = FraseEstandar(
        numero_atajo=datos.numero_atajo,
        codigo=datos.codigo,
        texto=datos.texto,
        categoria=datos.categoria,
        usuario_id=usuario.id,
    )
    db.add(frase)
    await db.commit()
    await db.refresh(frase)
    return frase


@router.put("/{frase_id}", response_model=FraseEstandarResponse)
async def actualizar_frase(
    frase_id: uuid.UUID,
    datos: FraseEstandarUpdate,
    db: AsyncSession = Depends(get_db),
    usuario: Usuario = Depends(get_current_user),
):
    """Actualiza una frase personalizada del usuario."""
    resultado = await db.execute(
        select(FraseEstandar).where(
            FraseEstandar.id == frase_id,
            FraseEstandar.usuario_id == usuario.id,
        )
    )
    frase = resultado.scalar_one_or_none()
    if not frase:
        raise HTTPException(status_code=404, detail="Frase no encontrada o no le pertenece")

    if datos.texto is not None:
        frase.texto = datos.texto
    if datos.categoria is not None:
        frase.categoria = datos.categoria

    await db.commit()
    await db.refresh(frase)
    return frase


@router.delete("/{frase_id}", status_code=204)
async def eliminar_frase(
    frase_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    usuario: Usuario = Depends(get_current_user),
):
    """Elimina una frase personalizada del usuario (no se pueden eliminar frases del sistema)."""
    resultado = await db.execute(
        select(FraseEstandar).where(
            FraseEstandar.id == frase_id,
            FraseEstandar.usuario_id == usuario.id,
        )
    )
    frase = resultado.scalar_one_or_none()
    if not frase:
        raise HTTPException(
            status_code=404,
            detail="Frase no encontrada o no le pertenece (las frases del sistema no se pueden eliminar)",
        )

    await db.delete(frase)
    await db.commit()

