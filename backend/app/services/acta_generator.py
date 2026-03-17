"""
Servicio de generación de acta judicial con Claude Sonnet 4.

Genera borradores de actas oficiales a partir del contenido del Canvas
(segmentos de transcripción) y metadatos de la audiencia.

Formatos soportados:
- Formato A: Juzgado Penal Unipersonal
- Formato B: Sala Penal de Apelaciones (colegiado)
"""
import logging
import uuid
from typing import Optional, List, Dict

import anthropic
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.acta import Acta
from app.models.audiencia import Audiencia
from app.models.segmento import Segmento
from app.models.hablante import Hablante

logger = logging.getLogger(__name__)


# ── Prompts por formato ─────────────────────────────────────

PROMPT_FORMATO_A = """Eres un digitador judicial experto del Poder Judicial del Perú, Distrito Judicial de Cusco.

Tu tarea es generar el ACTA DE AUDIENCIA oficial a partir de la transcripción proporcionada.

## FORMATO A — JUZGADO PENAL UNIPERSONAL

El acta debe seguir estrictamente esta estructura:

---

CORTE SUPERIOR DE JUSTICIA DE CUSCO
{juzgado}

ACTA DE REGISTRO DE AUDIENCIA DE {tipo_audiencia}

EXPEDIENTE     : {expediente}
ESPECIALISTA   : {especialista}
IMPUTADO       : {imputado}
AGRAVIADO      : {agraviado}
DELITO         : {delito}

En la ciudad de Cusco, siendo las {hora_inicio} horas del día {fecha}, en la Sala de Audiencias del {juzgado}, se da inicio a la audiencia de {tipo_audiencia}.

DESARROLLO DE LA AUDIENCIA:

[Aquí insertar el contenido de la transcripción formateado como acta formal]

DECISIÓN:

[Extraer la decisión o resolución si la hay]

Con lo que concluyó la audiencia, siendo las {hora_fin} horas del mismo día, firmando los que en ella intervinieron.

---

## REGLAS:
1. Mantener TODA la información de la transcripción, no omitir contenido
2. Usar formato formal de acta judicial peruana
3. Identificar las intervenciones por el rol del hablante (JUEZ:, FISCAL:, DEFENSA:, etc.)
4. Corregir ortografía y puntuación sin cambiar el sentido
5. No inventar información que no esté en la transcripción
6. Usar mayúsculas para títulos, cargos e instituciones
7. Numerar los puntos de la audiencia si corresponde
8. Mantener las citas textuales de las declaraciones

## DATOS DE LA AUDIENCIA:
{metadatos}

## HABLANTES:
{hablantes}

## TRANSCRIPCIÓN COMPLETA:
{transcripcion}

Genera el acta completa en formato texto plano. NO uses markdown."""


PROMPT_FORMATO_B = """Eres un digitador judicial experto del Poder Judicial del Perú, Distrito Judicial de Cusco.

Tu tarea es generar el ACTA DE AUDIENCIA oficial a partir de la transcripción proporcionada.

## FORMATO B — SALA PENAL DE APELACIONES (COLEGIADO)

El acta debe seguir estrictamente esta estructura:

---

CORTE SUPERIOR DE JUSTICIA DE CUSCO
SALA PENAL DE APELACIONES Y LIQUIDADORA DE CUSCO I

ACTA DE REGISTRO DE AUDIENCIA DE {tipo_audiencia}

EXPEDIENTE     : {expediente}
ESPECIALISTA   : {especialista}
IMPUTADO       : {imputado}
AGRAVIADO      : {agraviado}
DELITO         : {delito}

En la ciudad de Cusco, siendo las {hora_inicio} horas del día {fecha}, en la Sala de Audiencias de la Sala Penal de Apelaciones, ante los Señores Jueces Superiores conformantes del Colegiado, se da inicio a la audiencia de {tipo_audiencia}.

JUECES SUPERIORES:
- Juez Superior Director de Debates: [Nombre]
- Juez Superior: [Nombre]
- Juez Superior: [Nombre]

DESARROLLO DE LA AUDIENCIA:

[Contenido formateado]

DECISIÓN DEL COLEGIADO:

[Extraer la decisión]

Con lo que concluyó la audiencia, siendo las {hora_fin} horas del mismo día, firmando los que en ella intervinieron.

---

## REGLAS:
1. Mantener TODA la información de la transcripción
2. Formato formal de acta de Sala de Apelaciones
3. Identificar las intervenciones por rol
4. Respetar la estructura colegiada (3 jueces)
5. No inventar información
6. Usar mayúsculas para títulos, cargos e instituciones

## DATOS DE LA AUDIENCIA:
{metadatos}

## HABLANTES:
{hablantes}

## TRANSCRIPCIÓN COMPLETA:
{transcripcion}

Genera el acta completa en formato texto plano. NO uses markdown."""


async def generar_acta(
    audiencia_id: uuid.UUID,
    formato: str,
    usuario_id: uuid.UUID,
    db: AsyncSession,
) -> Acta:
    """
    Genera el acta oficial de audiencia:
    1. Recopila todos los segmentos (texto_editado > texto_mejorado > texto_ia)
    2. Recopila metadatos de audiencia y hablantes
    3. Envía a Claude Sonnet 4 con prompt de formato oficial
    4. Guarda versión en BD

    Args:
        audiencia_id: UUID de la audiencia
        formato: "A" (Unipersonal) o "B" (Apelaciones)
        usuario_id: UUID del usuario que solicita
        db: Sesión de base de datos

    Returns:
        Acta creada con contenido_llm
    """
    # 1. Obtener audiencia
    result = await db.execute(
        select(Audiencia).where(Audiencia.id == audiencia_id)
    )
    audiencia = result.scalar_one_or_none()
    if not audiencia:
        raise ValueError(f"Audiencia {audiencia_id} no encontrada")

    # 2. Obtener segmentos ordenados
    result = await db.execute(
        select(Segmento)
        .where(Segmento.audiencia_id == audiencia_id)
        .order_by(Segmento.orden)
    )
    segmentos = result.scalars().all()
    if not segmentos:
        raise ValueError("No hay segmentos de transcripción para generar el acta")

    # 3. Obtener hablantes
    result = await db.execute(
        select(Hablante)
        .where(Hablante.audiencia_id == audiencia_id)
        .order_by(Hablante.orden)
    )
    hablantes = result.scalars().all()

    # 4. Construir transcripción con etiquetas de hablante
    hablante_map = {h.speaker_id: h for h in hablantes}
    transcripcion_lines = []
    current_speaker = None

    for seg in segmentos:
        # Prioridad: texto_editado > texto_mejorado > texto_ia
        texto = seg.texto_editado or seg.texto_mejorado or seg.texto_ia

        if seg.speaker_id != current_speaker:
            current_speaker = seg.speaker_id
            h = hablante_map.get(seg.speaker_id)
            etiqueta = h.etiqueta if h else f"{seg.speaker_id.upper()}:"
            transcripcion_lines.append(f"\n{etiqueta}")

        transcripcion_lines.append(texto)

    transcripcion = "\n".join(transcripcion_lines)

    # 5. Construir metadatos
    metadatos = f"""Expediente: {audiencia.expediente}
Juzgado: {audiencia.juzgado}
Tipo de Audiencia: {audiencia.tipo_audiencia}
Instancia: {audiencia.instancia}
Fecha: {audiencia.fecha.strftime('%d de %B de %Y') if audiencia.fecha else 'No especificada'}
Hora de Inicio: {audiencia.hora_inicio.strftime('%H:%M') if audiencia.hora_inicio else 'No especificada'}
Hora de Fin: {audiencia.hora_fin.strftime('%H:%M') if audiencia.hora_fin else 'No especificada'}
Sala: {audiencia.sala or 'No especificada'}
Delito: {audiencia.delito or 'No especificado'}
Imputado: {audiencia.imputado_nombre or 'No especificado'}
Agraviado: {audiencia.agraviado_nombre or 'No especificado'}
Especialista de Causa: {audiencia.especialista_causa or 'No especificado'}
Especialista de Audiencia: {audiencia.especialista_audiencia or 'No especificado'}"""

    # 6. Construir lista de hablantes
    hablantes_text = "\n".join([
        f"- {h.etiqueta} {h.nombre or '(sin nombre asignado)'} [Rol: {h.rol}]"
        for h in hablantes
    ]) or "No hay hablantes registrados"

    # 7. Seleccionar prompt por formato
    prompt_template = PROMPT_FORMATO_A if formato == "A" else PROMPT_FORMATO_B
    prompt = prompt_template.format(
        juzgado=audiencia.juzgado,
        tipo_audiencia=audiencia.tipo_audiencia.upper(),
        expediente=audiencia.expediente,
        especialista=audiencia.especialista_audiencia or audiencia.especialista_causa or "No especificado",
        imputado=audiencia.imputado_nombre or "No especificado",
        agraviado=audiencia.agraviado_nombre or "No especificado",
        delito=audiencia.delito or "No especificado",
        hora_inicio=audiencia.hora_inicio.strftime('%H:%M') if audiencia.hora_inicio else "--:--",
        hora_fin=audiencia.hora_fin.strftime('%H:%M') if audiencia.hora_fin else "--:--",
        fecha=audiencia.fecha.strftime('%d de %B de %Y') if audiencia.fecha else "No especificada",
        metadatos=metadatos,
        hablantes=hablantes_text,
        transcripcion=transcripcion,
    )

    # 8. Llamar a Claude Sonnet 4
    try:
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=8000,
            temperature=0.2,
            messages=[{"role": "user", "content": prompt}],
        )

        contenido_llm = message.content[0].text.strip()
        tokens_used = message.usage.input_tokens + message.usage.output_tokens

    except Exception as e:
        logger.error(f"Error generando acta con Claude: {e}")
        raise ValueError(f"Error al generar acta: {str(e)}")

    # 9. Determinar versión
    result = await db.execute(
        select(Acta)
        .where(Acta.audiencia_id == audiencia_id)
        .order_by(Acta.version.desc())
    )
    ultima_acta = result.scalars().first()
    nueva_version = (ultima_acta.version + 1) if ultima_acta else 1

    # 10. Guardar en BD
    acta = Acta(
        audiencia_id=audiencia_id,
        version=nueva_version,
        formato=formato,
        estado="borrador",
        contenido_llm=contenido_llm,
        prompt_utilizado=prompt[:2000],  # Guardar inicio del prompt para referencia
        modelo_llm="claude-sonnet-4-20250514",
        tokens_used=tokens_used,
        confianza=0.9,
        generado_por=usuario_id,
    )
    db.add(acta)
    await db.flush()
    await db.refresh(acta)

    logger.info(
        f"Acta generada: audiencia={audiencia_id}, "
        f"v{nueva_version}, formato={formato}, "
        f"tokens={tokens_used}, {len(segmentos)} segmentos"
    )

    return acta
