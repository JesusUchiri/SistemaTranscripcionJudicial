"""
Servicio de generación de acta judicial con Claude Sonnet 4.

Genera borradores de actas oficiales a partir del contenido del Canvas
(segmentos de transcripción) y metadatos de la audiencia.

Formatos soportados:
- Formato A: Juzgado Penal Unipersonal
- Formato B: Sala Penal de Apelaciones (colegiado)
"""
import logging
import re
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
from app.services.cost_tracker import registrar_uso_claude

logger = logging.getLogger(__name__)


# ── Prompts por formato ─────────────────────────────────────

PROMPT_FORMATO_A = """Eres un digitador judicial experto del Poder Judicial del Perú, Distrito Judicial de Cusco.
Tu tarea es redactar el CUERPO del ACTA DE AUDIENCIA OFICIAL en formato HTML a partir de la transcripción proporcionada.

IMPORTANTE: El encabezado institucional (membrete) lo agrega el sistema automáticamente. NO incluyas <h1> ni <h2> con el nombre de la institución o juzgado. Empieza directamente desde el título del acta.

## FORMATO A — JUZGADO PENAL UNIPERSONAL

Estructura HTML a generar (copia exactamente estas etiquetas, rellena los valores reales):

<h3>ACTA DE REGISTRO DE AUDIENCIA DE {tipo_audiencia}</h3>

<p><strong>EXPEDIENTE N°:</strong> {expediente}</p>
<p><strong>ESPECIALISTA DE AUDIENCIA:</strong> {especialista}</p>
<p><strong>IMPUTADO/A:</strong> {imputado}</p>
<p><strong>AGRAVIADO/A:</strong> {agraviado}</p>
<p><strong>DELITO:</strong> {delito}</p>

<p>En la ciudad del Cusco, siendo las {hora_inicio} horas del día {fecha}, en la Sala de Audiencias del {juzgado}, el señor Juez Penal Unipersonal da inicio a la audiencia de {tipo_audiencia}, con la concurrencia de las partes procesales que se detallan a continuación.</p>

<h3>SUJETOS PROCESALES PRESENTES:</h3>
<ul>
[Lista completa de los hablantes identificados y sus roles según los datos de HABLANTES]
</ul>

<h3>DESARROLLO DE LA AUDIENCIA:</h3>

[Transcribir el contenido completo formateado como párrafos formales judiciales. Cada intervención usa el formato:
<p><strong>ROL EN MAYÚSCULAS (Nombre si disponible):</strong> Texto de la intervención en lenguaje formal de tercera persona, corrigiendo muletillas y errores de dicción pero sin alterar el sentido jurídico. Los segmentos marcados como [SEGMENTO INAUDIBLE] se mantienen tal cual.</p>]

<h3>DECISIÓN:</h3>

[Si en la transcripción existe una resolución, auto o decisión del juez, extraerla íntegramente en párrafo separado. Si no hay decisión expresa, indicar: <p>No se emitió resolución en la presente audiencia.</p>]

<p>Con lo que concluyó la presente audiencia, siendo las {hora_fin} horas del mismo día, suscribiendo los intervinientes en señal de conformidad.</p>

## REGLAS CRÍTICAS:
1. Respuesta ÚNICAMENTE en HTML semántico válido. Solo usar: <h3>, <p>, <strong>, <em>, <ul>, <li>, <br>.
2. NO incluir <html>, <head>, <body>, <h1>, <h2>. Solo el fragmento de contenido del cuerpo.
3. Mantener TODA la información de la transcripción. No omitir intervenciones ni contenido relevante.
4. Lenguaje formal judicial en tercera persona. Corregir ortografía y puntuación. Eliminar muletillas (eeeh, mmm, este...) sin cambiar el sentido.
5. Roles de hablante en MAYÚSCULAS seguidos de dos puntos: <strong>JUEZ:</strong>, <strong>FISCAL:</strong>, <strong>DEFENSA:</strong>, <strong>IMPUTADO:</strong>, etc.
6. Usar los nombres reales de los hablantes si están disponibles en los datos de HABLANTES.
7. Si un interviniente aparece como "INTERVINIENTE 1" o "SPEAKER_XX", intenta inferir su rol desde el contenido de sus intervenciones (quien dice "señor juez" dirige al JUEZ, quien presenta cargos es el FISCAL, quien defiende es la DEFENSA, etc.) y usar esa etiqueta de rol inferido.
8. NO inventar, suponer ni completar información ausente.
8. Fechas en formato: "veintiocho de febrero de dos mil veinticinco" (en letras) cuando aparezcan en el cuerpo textual, pero en los metadatos del encabezado usar el formato provisto.
9. Segmentos inaudibles conservar como: [SEGMENTO INAUDIBLE]

## DATOS DE LA AUDIENCIA:
{metadatos}

## HABLANTES IDENTIFICADOS:
{hablantes}

## TRANSCRIPCIÓN COMPLETA (ordenada por tiempo):
{transcripcion}

Genera el acta completa en formato HTML siguiendo estrictamente la estructura indicada."""


PROMPT_FORMATO_B = """Eres un digitador judicial experto del Poder Judicial del Perú, Distrito Judicial de Cusco.
Tu tarea es redactar el CUERPO del ACTA DE AUDIENCIA OFICIAL en formato HTML a partir de la transcripción proporcionada.

IMPORTANTE: El encabezado institucional (membrete) lo agrega el sistema automáticamente. NO incluyas <h1> ni <h2> con el nombre de la institución. Empieza directamente desde el título del acta.

## FORMATO B — SALA PENAL DE APELACIONES (COLEGIADO)

Estructura HTML a generar:

<h3>ACTA DE REGISTRO DE AUDIENCIA DE {tipo_audiencia}</h3>

<p><strong>EXPEDIENTE N°:</strong> {expediente}</p>
<p><strong>ESPECIALISTA DE AUDIENCIA:</strong> {especialista}</p>
<p><strong>IMPUTADO/A:</strong> {imputado}</p>
<p><strong>AGRAVIADO/A:</strong> {agraviado}</p>
<p><strong>DELITO:</strong> {delito}</p>

<p>En la ciudad del Cusco, siendo las {hora_inicio} horas del día {fecha}, en la Sala de Audiencias de la Sala Penal de Apelaciones y Liquidadora de Cusco I, ante los Señores Jueces Superiores conformantes del Colegiado, se da inicio a la audiencia de {tipo_audiencia}.</p>

<h3>COLEGIADO:</h3>
<ul>
[Listar los tres jueces superiores. Si están identificados en HABLANTES, usar sus nombres reales. Si no, indicar: <li>Juez Superior Director de Debates: [No identificado]</li> etc.]
</ul>

<h3>SUJETOS PROCESALES PRESENTES:</h3>
<ul>
[Lista de los demás hablantes y sus roles]
</ul>

<h3>DESARROLLO DE LA AUDIENCIA:</h3>

[Intervenciones formateadas como en Formato A, distinguiendo al Juez Director de Debates de los demás jueces]

<h3>DECISIÓN DEL COLEGIADO:</h3>

[Decisión o resolución colegiada, si la hay. Si no: <p>El Colegiado no emitió resolución en la presente audiencia.</p>]

<p>Con lo que concluyó la presente audiencia, siendo las {hora_fin} horas del mismo día, suscribiendo los intervinientes en señal de conformidad.</p>

## REGLAS CRÍTICAS:
1. Respuesta ÚNICAMENTE en HTML semántico válido. Solo usar: <h3>, <p>, <strong>, <em>, <ul>, <li>, <br>.
2. NO incluir <html>, <head>, <body>, <h1>, <h2>. Solo el fragmento del cuerpo.
3. Mantener TODA la información de la transcripción.
4. Distinguir entre JUEZ SUPERIOR - DIRECTOR DE DEBATES y los demás JUECES SUPERIORES.
5. Lenguaje formal judicial. Corregir ortografía sin alterar el sentido jurídico.
6. Roles en MAYÚSCULAS con dos puntos: <strong>JUEZ SUPERIOR - DIRECTOR DE DEBATES:</strong>
7. Si un interviniente aparece como "INTERVINIENTE X" o "SPEAKER_XX", infiere su rol desde el contenido de sus intervenciones (expresiones como "señora presidenta", "con la venia de la sala", "en representación de la defensa", etc.) y usa la etiqueta de rol correspondiente.
8. NO inventar información ausente.
9. Conservar [SEGMENTO INAUDIBLE] tal cual.

## DATOS DE LA AUDIENCIA:
{metadatos}

## HABLANTES IDENTIFICADOS:
{hablantes}

## TRANSCRIPCIÓN COMPLETA (ordenada por tiempo):
{transcripcion}

Genera el acta completa en formato HTML siguiendo estrictamente la estructura indicada."""


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
    # Mapeo de rol DB → etiqueta legible en español para el acta
    _ROL_ETIQUETA = {
        "juez":              "JUEZ",
        "juez_director":     "JUEZ SUPERIOR DIRECTOR DE DEBATES",
        "jueces_colegiado":  "JUEZ SUPERIOR",
        "fiscal":            "FISCAL",
        "defensa_imputado":  "DEFENSA",
        "defensa_agraviado": "DEFENSA CIVIL",
        "imputado":          "IMPUTADO",
        "agraviado":         "AGRAVIADO",
        "testigo":           "TESTIGO",
        "perito":            "PERITO",
    }

    hablante_map = {h.speaker_id: h for h in hablantes}
    # Numerar hablantes para fallback legible cuando no tienen rol asignado
    speaker_numero = {spk: f"INTERVINIENTE {i+1}" for i, spk in enumerate(dict.fromkeys(h.speaker_id for h in hablantes))}

    transcripcion_lines = []
    current_speaker = None

    for seg in segmentos:
        # Prioridad: texto_editado > texto_mejorado > texto_ia
        texto = seg.texto_editado or seg.texto_mejorado or seg.texto_ia

        if seg.speaker_id != current_speaker:
            current_speaker = seg.speaker_id
            h = hablante_map.get(seg.speaker_id)
            if h:
                etq = (h.etiqueta or "").strip()
                # Usar etiqueta personalizada si no es el placeholder genérico "SPEAKER_XX:"
                if etq and not etq.upper().startswith("SPEAKER_"):
                    etiqueta = etq if etq.endswith(":") else f"{etq}:"
                elif h.rol and h.rol != "otro":
                    # Derivar desde el rol DB
                    rol_label = _ROL_ETIQUETA.get(h.rol, h.rol.upper())
                    nombre_part = f" ({h.nombre})" if h.nombre else ""
                    etiqueta = f"{rol_label}{nombre_part}:"
                else:
                    # Fallback: numerar intervinientes en vez de mostrar "SPEAKER_00:"
                    fallback = speaker_numero.get(seg.speaker_id, seg.speaker_id.upper())
                    nombre_part = f" ({h.nombre})" if h.nombre else ""
                    etiqueta = f"{fallback}{nombre_part}:"
            else:
                etiqueta = f"{seg.speaker_id.upper()}:"
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
    # IMPORTANTE: NO usar str.format() porque la transcripción puede contener
    # llaves { } (números de expediente, citas legales, etc.) → KeyError.
    # Se reemplazan las variables conocidas con str.replace() en orden,
    # insertando los valores más largos primero para evitar solapamientos.
    prompt_template = PROMPT_FORMATO_A if formato == "A" else PROMPT_FORMATO_B
    substitutions = {
        "{juzgado}":       audiencia.juzgado or "",
        "{tipo_audiencia}": audiencia.tipo_audiencia.upper() if audiencia.tipo_audiencia else "",
        "{expediente}":    audiencia.expediente or "",
        "{especialista}":  audiencia.especialista_audiencia or audiencia.especialista_causa or "No especificado",
        "{imputado}":      audiencia.imputado_nombre or "No especificado",
        "{agraviado}":     audiencia.agraviado_nombre or "No especificado",
        "{delito}":        audiencia.delito or "No especificado",
        "{hora_inicio}":   audiencia.hora_inicio.strftime('%H:%M') if audiencia.hora_inicio else "--:--",
        "{hora_fin}":      audiencia.hora_fin.strftime('%H:%M') if audiencia.hora_fin else "--:--",
        "{fecha}":         audiencia.fecha.strftime('%d de %B de %Y') if audiencia.fecha else "No especificada",
        "{metadatos}":     metadatos,
        "{hablantes}":     hablantes_text,
        "{transcripcion}": transcripcion,
    }
    prompt = prompt_template
    for placeholder, value in substitutions.items():
        prompt = prompt.replace(placeholder, value)

    # 8. Llamar a Claude Sonnet 4 (async para no bloquear el event loop)
    try:
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

        message = await client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=8192,
            temperature=0.1,
            messages=[{"role": "user", "content": prompt}],
        )

        contenido_llm = message.content[0].text.strip()

        # Limpiar backticks de markdown que Claude a veces agrega (```html ... ```)
        contenido_llm = re.sub(r'^```(?:html)?\s*\n?', '', contenido_llm)
        contenido_llm = re.sub(r'\n?```\s*$', '', contenido_llm)
        contenido_llm = contenido_llm.strip()

        # Extraer datos reales de facturación de la respuesta API
        in_tok = message.usage.input_tokens
        out_tok = message.usage.output_tokens
        tokens_used = in_tok + out_tok
        modelo_real = settings.ANTHROPIC_MODEL

        # Registrar uso real en tabla uso_api
        await registrar_uso_claude(
            db,
            servicio="claude_acta",
            modelo=modelo_real,
            input_tokens=in_tok,
            output_tokens=out_tok,
            audiencia_id=audiencia_id,
            usuario_id=usuario_id,
        )

    except Exception as e:
        logger.error(f"Error generando acta con Claude: {e}", exc_info=True)
        # Re-raise como RuntimeError para que el endpoint lo devuelva como 500
        raise RuntimeError(f"Error al generar acta con la IA: {str(e)}")

    # 9. Determinar versión
    result = await db.execute(
        select(Acta)
        .where(Acta.audiencia_id == audiencia_id)
        .order_by(Acta.version.desc())
    )
    ultima_acta = result.scalars().first()
    nueva_version = (ultima_acta.version + 1) if ultima_acta else 1

    # 10. Reemplazar tokens {{VARIABLE}} en el contenido generado
    reemplazos = {
        "EXPEDIENTE":    audiencia.expediente or "",
        "JUZGADO":       audiencia.juzgado or "",
        "TIPO_AUDIENCIA": audiencia.tipo_audiencia or "",
        "INSTANCIA":     audiencia.instancia or "",
        "SALA":          audiencia.sala or "",
        "DELITO":        audiencia.delito or "",
        "IMPUTADO":      audiencia.imputado_nombre or "",
        "AGRAVIADO":     audiencia.agraviado_nombre or "",
        "ESPECIALISTA":  audiencia.especialista_audiencia or audiencia.especialista_causa or "",
        "FECHA":         audiencia.fecha.strftime("%d de %B de %Y") if audiencia.fecha else "",
        "HORA_INICIO":   audiencia.hora_inicio.strftime("%H:%M") if audiencia.hora_inicio else "",
        "HORA_FIN":      audiencia.hora_fin.strftime("%H:%M") if audiencia.hora_fin else "",
    }
    # Derivar JUEZ/FISCAL/DEFENSOR de hablantes
    for h in hablantes:
        if h.rol in ("juez", "juez_director", "jueces_colegiado") and h.nombre:
            reemplazos.setdefault("JUEZ", h.nombre)
        elif h.rol == "fiscal" and h.nombre:
            reemplazos.setdefault("FISCAL", h.nombre)
        elif h.rol in ("defensa_imputado", "defensa_agraviado") and h.nombre:
            reemplazos.setdefault("DEFENSOR", h.nombre)

    for token, valor in reemplazos.items():
        if valor:
            contenido_llm = contenido_llm.replace(f"{{{{{token}}}}}", valor)

    # 11. Guardar en BD
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
