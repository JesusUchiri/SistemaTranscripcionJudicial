"""
API de Hablantes — gestionar los participantes de una audiencia.

Cada hablante corresponde a un speaker_id de Deepgram.
El digitador asigna roles judiciales (juez, fiscal, defensa, etc.).
"""
import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import settings
from app.database import get_db
from app.models.hablante import Hablante
from app.models.segmento import Segmento
from app.models.usuario import Usuario
from app.schemas.hablante import HablanteCreate, HablanteUpdate, HablanteResponse

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/audiencias/{audiencia_id}/hablantes", tags=["hablantes"])

# ── Roles disponibles con sus etiquetas y colores por defecto ──
ROLES_CONFIG = {
    "juez":              {"etiqueta": "JUEZ:",                                             "color": "#1B3A5C"},
    "juez_director":     {"etiqueta": "JUEZ SUPERIOR – DIRECTOR DE DEBATES:",              "color": "#1B3A5C"},
    "jueces_colegiado":  {"etiqueta": "JUECES SUPERIORES:",                                "color": "#2C5282"},
    "fiscal":            {"etiqueta": "REPRESENTANTE DEL MINISTERIO PÚBLICO:",             "color": "#2D6A4F"},
    "defensa_imputado":  {"etiqueta": "DEFENSA DEL SENTENCIADO (A):",                      "color": "#9B2226"},
    "defensa_agraviado": {"etiqueta": "DEFENSA DE LA PARTE AGRAVIADA:",                    "color": "#B44D12"},
    "imputado":          {"etiqueta": "IMPUTADO:",                                         "color": "#BC6C25"},
    "agraviado":         {"etiqueta": "AGRAVIADO:",                                        "color": "#6B21A8"},
    "victima":           {"etiqueta": "VÍCTIMA:",                                          "color": "#7C3AED"},
    "asesor_victimas":   {"etiqueta": "ASESOR JURÍDICO DE VÍCTIMAS:",                     "color": "#DB2777"},
    "perito":            {"etiqueta": "PERITO:",                                           "color": "#0E7490"},
    "testigo":           {"etiqueta": "TESTIGO:",                                          "color": "#65A30D"},
    "asistente":         {"etiqueta": "ASISTENTE DE AUDIENCIA:",                           "color": "#64748B"},
    "partes_general":    {"etiqueta": "PARTES PROCESALES:",                                "color": "#78716C"},
    "otro":              {"etiqueta": "OTRO:",                                             "color": "#94A3B8"},
}

# Colores distintos para voces auto-detectadas (diarización), por orden
COLORES_POR_ORDEN = [
    "#2563EB", "#059669", "#DC2626", "#D97706", "#7C3AED",
    "#0E7490", "#64748B", "#94A3B8", "#EA580C", "#65A30D",
]


@router.get("/roles")
async def listar_roles(
    audiencia_id: uuid.UUID,
):
    """Retorna la lista de roles judiciales disponibles con etiquetas y colores."""
    return [
        {"rol": rol, "etiqueta": config["etiqueta"], "color": config["color"]}
        for rol, config in ROLES_CONFIG.items()
    ]


@router.get("", response_model=list[HablanteResponse])
async def listar_hablantes(
    audiencia_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _usuario: Usuario = Depends(get_current_user),
):
    """Lista todos los hablantes de una audiencia, ordenados."""
    resultado = await db.execute(
        select(Hablante)
        .where(Hablante.audiencia_id == audiencia_id)
        .order_by(Hablante.orden)
    )
    return resultado.scalars().all()


@router.post("", response_model=HablanteResponse, status_code=201)
async def crear_hablante(
    audiencia_id: uuid.UUID,
    datos: HablanteCreate,
    db: AsyncSession = Depends(get_db),
    _usuario: Usuario = Depends(get_current_user),
):
    """Crea un nuevo hablante (o lo detecta automáticamente vía WebSocket).
    Si el speaker_id ya existe, retorna el existente sin error (upsert).
    """
    import logging as _logging, traceback as _tb
    _log = _logging.getLogger(__name__)
    try:
        # Verificar si ya existe este speaker_id para esta audiencia
        existente_result = await db.execute(
            select(Hablante).where(
                Hablante.audiencia_id == audiencia_id,
                Hablante.speaker_id == datos.speaker_id,
            )
        )
        existente = existente_result.scalars().first()
        if existente:
            return existente

        # Aplicar colores y etiquetas por defecto según el rol
        config_rol = ROLES_CONFIG.get(datos.rol, ROLES_CONFIG["otro"])
        # Para rol "otro" (voces detectadas por diarización), color distinto por orden
        if datos.rol == "otro" and not datos.color:
            color = COLORES_POR_ORDEN[datos.orden % len(COLORES_POR_ORDEN)]
        else:
            color = datos.color or config_rol["color"]
        etiqueta = datos.etiqueta or config_rol["etiqueta"]
        # Si es auto-detectado (solo speaker_id), etiqueta inicial con el ID para distinguir voces
        if not datos.etiqueta and datos.speaker_id:
            etiqueta = f"{datos.speaker_id.upper()}:"

        hablante = Hablante(
            audiencia_id=audiencia_id,
            speaker_id=datos.speaker_id,
            rol=datos.rol,
            etiqueta=etiqueta,
            nombre=datos.nombre,
            color=color,
            orden=datos.orden,
            auto_detectado=True,  # Creado al detectar nueva voz en transcripción
        )
        db.add(hablante)
        await db.commit()
        await db.refresh(hablante)
        return hablante
    except HTTPException:
        raise
    except Exception as e:
        _log.error(f"[POST /hablantes] {type(e).__name__}: {e}\n{_tb.format_exc()}")
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {str(e)}")


@router.put("/{hablante_id}", response_model=HablanteResponse)
async def actualizar_hablante(
    audiencia_id: uuid.UUID,
    hablante_id: uuid.UUID,
    datos: HablanteUpdate,
    db: AsyncSession = Depends(get_db),
    _usuario: Usuario = Depends(get_current_user),
):
    """Actualiza un hablante — usado para asignar rol judicial al speaker_id."""
    import logging
    logger = logging.getLogger(__name__)

    try:
        resultado = await db.execute(
            select(Hablante).where(
                Hablante.id == hablante_id,
                Hablante.audiencia_id == audiencia_id,
            )
        )
        hablante = resultado.scalar_one_or_none()
        if not hablante:
            raise HTTPException(status_code=404, detail="Hablante no encontrado")

        logger.warning(f"[HABLANTE PUT] antes: rol={hablante.rol}, datos.rol={datos.rol}, datos.nombre={datos.nombre}")

        # Actualizar campos proporcionados
        if datos.rol is not None:
            hablante.rol = datos.rol
            # Si cambia el rol, actualizar etiqueta y color con defaults
            config_rol = ROLES_CONFIG.get(datos.rol, ROLES_CONFIG["otro"])
            if datos.etiqueta is None:
                hablante.etiqueta = config_rol["etiqueta"]
            if datos.color is None:
                hablante.color = config_rol["color"]
        if datos.etiqueta is not None:
            hablante.etiqueta = datos.etiqueta
        if datos.nombre is not None:
            hablante.nombre = datos.nombre
        if datos.color is not None:
            hablante.color = datos.color
        if datos.orden is not None:
            hablante.orden = datos.orden

        await db.commit()
        await db.refresh(hablante)

        logger.warning(f"[HABLANTE PUT] después: rol={hablante.rol}, etiqueta={hablante.etiqueta}")
        return hablante

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"[HABLANTE PUT] ERROR: {type(e).__name__}: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Error interno: {type(e).__name__}: {str(e)}")


@router.delete("/{hablante_id}", status_code=204)
async def eliminar_hablante(
    audiencia_id: uuid.UUID,
    hablante_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _usuario: Usuario = Depends(get_current_user),
):
    """Elimina un hablante."""
    resultado = await db.execute(
        select(Hablante).where(
            Hablante.id == hablante_id,
            Hablante.audiencia_id == audiencia_id,
        )
    )
    hablante = resultado.scalar_one_or_none()
    if not hablante:
        raise HTTPException(status_code=404, detail="Hablante no encontrado")

    await db.delete(hablante)
    await db.commit()


@router.post("/inferir-roles")
async def inferir_roles(
    audiencia_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _usuario: Usuario = Depends(get_current_user),
):
    """
    Analiza la transcripción con Claude para inferir el rol judicial de cada hablante.
    Retorna sugerencias con confianza y razón para que el digitador las acepte o rechace.
    """
    import anthropic

    # Obtener segmentos (máx 200 para no saturar el prompt)
    res_segs = await db.execute(
        select(Segmento)
        .where(Segmento.audiencia_id == audiencia_id)
        .order_by(Segmento.orden)
        .limit(200)
    )
    segmentos = res_segs.scalars().all()
    if not segmentos:
        raise HTTPException(status_code=404, detail="No hay segmentos para analizar")

    # Obtener hablantes existentes
    res_hablantes = await db.execute(
        select(Hablante).where(Hablante.audiencia_id == audiencia_id).order_by(Hablante.orden)
    )
    hablantes = res_hablantes.scalars().all()

    # Agrupar texto por speaker (max ~300 chars por speaker para el prompt)
    samples: dict[str, list[str]] = {}
    for seg in segmentos:
        sid = seg.speaker_id
        texto = (seg.texto_mejorado or seg.texto_ia or "").strip()
        if not texto:
            continue
        if sid not in samples:
            samples[sid] = []
        if sum(len(t) for t in samples[sid]) < 400:
            samples[sid].append(texto)

    if not samples:
        raise HTTPException(status_code=422, detail="No hay texto suficiente para inferir roles")

    speakers_text = "\n".join(
        f'{sid}: "{" ".join(txts[:3])}"'
        for sid, txts in samples.items()
    )

    roles_disponibles = list(ROLES_CONFIG.keys())

    prompt = f"""Eres un experto en transcripciones judiciales del Perú (Distrito Judicial de Cusco).

Analiza estos fragmentos de audio de una audiencia judicial y determina el ROL de cada hablante.

FRAGMENTOS POR HABLANTE:
{speakers_text}

ROLES DISPONIBLES: {", ".join(roles_disponibles)}

INDICADORES CLAVE:
- juez / juez_director: Dirige la audiencia, dice "se tiene por...", "resuelvo", "dispone", "se suspende", interpela a las partes, habla con autoridad formal
- fiscal: "el Ministerio Público", "requerimiento", "solicito se declare", "acusación formal", "como representante del Ministerio"
- defensa_imputado: "mi patrocinado", "mi defendido", "técnica defensa", "la defensa solicita"
- defensa_agraviado: "la parte agraviada", "defensa de la parte civil", "víctima"
- imputado / acusado: Se identifica con nombre, responde preguntas sobre hechos, habla en primera persona sobre los hechos
- agraviado / victima: Relata lo que le ocurrió, declara como afectado
- perito: Lenguaje técnico-científico, cita resultados de exámenes, informes periciales
- testigo: Relata lo que observó, declaración de hechos presenciados
- asistente: Lecturas formales, "se da lectura al...", "consta en actas"

Responde SOLO con un JSON válido (sin markdown):
[
  {{"speaker_id": "SPEAKER_00", "rol": "juez", "confianza": 0.95, "razon": "Dirige la audiencia y toma resoluciones"}},
  ...
]"""

    try:
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        message = await client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=600,
            temperature=0.1,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = message.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1].rsplit("```", 1)[0]
        sugerencias = json.loads(raw)
        
        # Registrar costo
        from app.services.cost_tracker import registrar_uso_claude
        await registrar_uso_claude(
            db=db,
            servicio="claude_inferir_roles",
            modelo=settings.ANTHROPIC_MODEL,
            input_tokens=message.usage.input_tokens,
            output_tokens=message.usage.output_tokens,
            audiencia_id=audiencia_id,
        )

    except Exception as e:
        _log.error(f"[inferir-roles] Claude error: {e}")
        raise HTTPException(status_code=500, detail=f"Error al inferir roles: {e}")

    # Enriquecer con etiqueta/color de cada rol sugerido
    resultado = []
    for sug in sugerencias:
        rol = sug.get("rol", "otro")
        config = ROLES_CONFIG.get(rol, ROLES_CONFIG["otro"])
        resultado.append({
            "speaker_id": sug.get("speaker_id"),
            "rol_sugerido": rol,
            "etiqueta_sugerida": config["etiqueta"],
            "color_sugerido": config["color"],
            "confianza": sug.get("confianza", 0.7),
            "razon": sug.get("razon", ""),
        })

    return resultado
