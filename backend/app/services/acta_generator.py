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

El acta debe seguir estrictamente esta estructura y ser generada en formato HTML semántico:

---
<h1>CORTE SUPERIOR DE JUSTICIA DE CUSCO</h1>
<h2>{juzgado}</h2>

<h3>ACTA DE REGISTRO DE AUDIENCIA DE {tipo_audiencia}</h3>

<p><strong>EXPEDIENTE:</strong> {expediente}</p>
<p><strong>ESPECIALISTA:</strong> {especialista}</p>
<p><strong>IMPUTADO:</strong> {imputado}</p>
<p><strong>AGRAVIADO:</strong> {agraviado}</p>
<p><strong>DELITO:</strong> {delito}</p>

<p>En la ciudad de Cusco, siendo las {hora_inicio} horas del día {fecha}, en la Sala de Audiencias del {juzgado}, se da inicio a la audiencia de {tipo_audiencia}.</p>

<h3>DESARROLLO DE LA AUDIENCIA:</h3>

[Aquí insertar el contenido de la transcripción formateado como acta formal, usando etiquetas <p> para párrafos y <strong> para los nombres de los hablantes al inicio de cada intervención]

<h3>DECISIÓN:</h3>

[Extraer la decisión o resolución si la hay, usando etiquetas de párrafo]

<p>Con lo que concluyó la audiencia, siendo las {hora_fin} horas del mismo día, firmando los que en ella intervinieron.</p>
---

## REGLAS CRÍTICAS:
1. Generar la respuesta ÚNICAMENTE en código HTML semántico válido (usar <h1>, <h2>, <h3>, <p>, <strong>, <ul>, <li>).
2. NO incluir etiquetas <html>, <head> ni <body>. Solo el fragmento de contenido.
3. Mantener TODA la información de la transcripción, no omitir contenido.
4. Identificar las intervenciones por el rol del hablante en negrita (ej: <p><strong>JUEZ:</strong> Texto...</p>).
5. Corregir ortografía y puntuación sin cambiar el sentido jurídico.
6. NO inventar información que no esté en la transcripción.
7. Usar mayúsculas para títulos, cargos e instituciones según el estilo judicial.

## DATOS DE LA AUDIENCIA:
{metadatos}

## HABLANTES:
{hablantes}

## TRANSCRIPCIÓN COMPLETA:
{transcripcion}

Genera el acta completa en formato HTML."""


PROMPT_FORMATO_B = """Eres un digitador judicial experto del Poder Judicial del Perú, Distrito Judicial de Cusco.

Tu tarea es generar el ACTA DE AUDIENCIA oficial a partir de la transcripción proporcionada en formato HTML semántico.

## FORMATO B — SALA PENAL DE APELACIONES (COLEGIADO)

El acta debe seguir estrictamente esta estructura:

---
<h1>CORTE SUPERIOR DE JUSTICIA DE CUSCO</h1>
<h2>SALA PENAL DE APELACIONES Y LIQUIDADORA DE CUSCO I</h2>

<h3>ACTA DE REGISTRO DE AUDIENCIA DE {tipo_audiencia}</h3>

<p><strong>EXPEDIENTE:</strong> {expediente}</p>
<p><strong>ESPECIALISTA:</strong> {especialista}</p>
<p><strong>IMPUTADO:</strong> {imputado}</p>
<p><strong>AGRAVIADO:</strong> {agraviado}</p>
<p><strong>DELITO:</strong> {delito}</p>

<p>En la ciudad de Cusco, siendo las {hora_inicio} horas del día {fecha}, en la Sala de Audiencias de la Sala Penal de Apelaciones, ante los Señores Jueces Superiores conformantes del Colegiado, se da inicio a la audiencia de {tipo_audiencia}.</p>

<h3>JUECES SUPERIORES:</h3>
<ul>
  <li>Juez Superior Director de Debates: [Nombre]</li>
  <li>Juez Superior: [Nombre]</li>
  <li>Juez Superior: [Nombre]</li>
</ul>

<h3>DESARROLLO DE LA AUDIENCIA:</h3>

[Contenido formateado con <p> y <strong> para hablantes]

<h3>DECISIÓN DEL COLEGIADO:</h3>

[Extraer la decisión]

<p>Con lo que concluyó la audiencia, siendo las {hora_fin} horas del mismo día, firmando los que en ella intervinieron.</p>
---

## REGLAS CRÍTICAS:
1. Generar la respuesta ÚNICAMENTE en código HTML semántico válido.
2. NO incluir etiquetas de estructura de documento completa (<html>, <body>), solo el fragmento.
3. Mantener TODA la información de la transcripción.
4. Respetar la estructura colegiada (3 jueces).
5. Identificar las intervenciones por rol en negrita (ej: <p><strong>JUEZ SUPERIOR - DIRECTOR DE DEBATES:</strong> Texto...</p>).
6. No inventar información.

## DATOS DE LA AUDIENCIA:
{metadatos}

## HABLANTES:
{hablantes}

## TRANSCRIPCIÓN COMPLETA:
{transcripcion}

Genera el acta completa en formato HTML."""


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
            model=settings.ANTHROPIC_MODEL,
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
        modelo_llm=settings.ANTHROPIC_MODEL,
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
