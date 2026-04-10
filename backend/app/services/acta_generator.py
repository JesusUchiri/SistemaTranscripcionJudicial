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
    acta_existente_id: uuid.UUID | None = None,
) -> Acta:
    """
    Genera el acta oficial de audiencia:
    ...
    Returns:
        Acta creada con contenido_llm
    """
    # Desactivar autoflush para tener control total durante este proceso largo y sensible
    db.autoflush = False

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

    # 3b. Deduplicar segmentos intermedios huérfanos.
    # Si el DELETE de intermedios falló en una sesión anterior, pueden quedar en BD
    # segmentos sin texto_mejorado que se solapan en tiempo con el segmento definitivo
    # (que sí tiene texto_mejorado). Se eliminan antes de construir la transcripción.
    final_segs_list = [s for s in segmentos if s.texto_mejorado is not None]

    def _overlaps(a, b) -> bool:
        return a.timestamp_inicio <= b.timestamp_fin and a.timestamp_fin >= b.timestamp_inicio

    segmentos = [
        s for s in segmentos
        if s.texto_mejorado is not None or not any(
            f.speaker_id == s.speaker_id and _overlaps(s, f)
            for f in final_segs_list
        )
    ]

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

    # 7. Construir sustituciones comunes (sin transcripcion, que varía por chunk)
    base_substitutions = {
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
    }

    def _apply_substitutions(template: str, transcript_chunk: str) -> str:
        result = template.replace("{transcripcion}", transcript_chunk)
        for placeholder, value in base_substitutions.items():
            result = result.replace(placeholder, value)
        return result

    def _clean_llm_output(text: str) -> str:
        text = text.strip()
        text = re.sub(r'^```(?:html)?\s*\n?', '', text)
        text = re.sub(r'\n?```\s*$', '', text)
        return text.strip()

    # 8. Llamar a Claude — con chunking para transcripciones largas
    # Umbral: si la transcripción supera CHUNK_SIZE chars, generamos en partes.
    # Con Sonnet (8192 tokens de salida) y ~20k chars por chunk:
    #   ~20k chars ≈ 5k tokens entrada → output ≈ 4-6k tokens → cabe holgado.
    # Una audiencia de 2800 segs (~150k chars) produce ~8 bloques.
    # 12k chars → ~3,000-4,000 tokens de salida HTML por bloque (holgado bajo 8192)
    # Para esta audiencia (315k chars) produce ~27 bloques
    CHUNK_SIZE = 12_000   # chars por chunk de transcripción
    ACTA_MODEL = settings.ANTHROPIC_MODEL_ACTA
    ACTA_MAX_TOKENS = 8192

    try:
        client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        prompt_template = PROMPT_FORMATO_A if formato == "A" else PROMPT_FORMATO_B
        total_in_tok = 0
        total_out_tok = 0

        if len(transcripcion) <= CHUNK_SIZE:
            # ── Audiencia corta: una sola llamada ─────────────────────────────
            # Heartbeat preventivo
            try:
                await db.execute(select(1))
            except Exception:
                pass

            prompt = _apply_substitutions(prompt_template, transcripcion)
            message = await client.messages.create(
                model=ACTA_MODEL,
                max_tokens=ACTA_MAX_TOKENS,
                temperature=0.1,
                messages=[{"role": "user", "content": prompt}],
            )
            if message.stop_reason == "max_tokens":
                logger.warning(
                    f"Acta truncada por límite de tokens (stop_reason=max_tokens). "
                    f"Transcripción={len(transcripcion)} chars. Considera reducir CHUNK_SIZE."
                )
            contenido_llm = _clean_llm_output(message.content[0].text)
            total_in_tok = message.usage.input_tokens
            total_out_tok = message.usage.output_tokens

        else:
            # ── Audiencia larga: generación por bloques ────────────────────────
            # Dividir la transcripción en bloques de CHUNK_SIZE chars,
            # respetando los saltos de línea (no cortar a mitad de intervención).
            chunks: list[str] = []
            start = 0
            while start < len(transcripcion):
                end = min(start + CHUNK_SIZE, len(transcripcion))
                if end < len(transcripcion):
                    # Retroceder hasta el último salto de línea para no cortar intervenciones
                    cut = transcripcion.rfind('\n', start, end)
                    if cut > start:
                        end = cut
                chunks.append(transcripcion[start:end])
                start = end

            logger.info(f"Generando acta en {len(chunks)} bloques (transcripción={len(transcripcion)} chars)")

            html_parts: list[str] = []
            expediente_label = audiencia.expediente or "la audiencia"

            for i, chunk in enumerate(chunks):
                is_first = (i == 0)
                is_last = (i == len(chunks) - 1)

                if is_first:
                    # Bloque inicial: estructura completa del acta hasta el DESARROLLO
                    # Instrucción extra: no generar DECISIÓN ni cierre si hay más bloques
                    extra = (
                        "\n\nIMPORTANTE — TRANSCRIPCIÓN PARCIAL: Esta es la primera parte de la transcripción. "
                        "Hay más intervenciones que se procesarán a continuación. "
                        "Genera la estructura completa del acta (encabezado, sujetos procesales, "
                        "inicio del DESARROLLO DE LA AUDIENCIA) con las intervenciones de este bloque. "
                        "NO generes la sección DECISIÓN ni el párrafo de cierre — esos vendrán al final."
                        if not is_last else ""
                    )
                    prompt = _apply_substitutions(prompt_template, chunk) + extra

                elif is_last:
                    # Bloque final: solo intervenciones restantes + DECISIÓN + cierre
                    prompt = (
                        f"Estás redactando el ACTA DE AUDIENCIA del expediente {expediente_label}.\n"
                        f"Continúa y FINALIZA la sección DESARROLLO DE LA AUDIENCIA con las siguientes intervenciones, "
                        f"luego genera la sección DECISIÓN y el párrafo de cierre.\n\n"
                        f"HABLANTES IDENTIFICADOS:\n{hablantes_text}\n\n"
                        f"INTERVENCIONES FINALES:\n{chunk}\n\n"
                        f"Responde ÚNICAMENTE con:\n"
                        f"1. Los párrafos <p><strong>ROL:</strong> texto...</p> de las intervenciones adicionales.\n"
                        f"2. La sección <h3>DECISIÓN:</h3> con su contenido.\n"
                        f"3. El párrafo de cierre: <p>Con lo que concluyó la presente audiencia...</p>\n"
                        f"Solo HTML válido: <h3>, <p>, <strong>, <em>, <ul>, <li>. Sin markdown."
                    )

                else:
                    # Bloque intermedio: solo las intervenciones adicionales
                    prompt = (
                        f"Estás redactando el ACTA DE AUDIENCIA del expediente {expediente_label}.\n"
                        f"Continúa la sección DESARROLLO DE LA AUDIENCIA con las siguientes intervenciones.\n\n"
                        f"HABLANTES IDENTIFICADOS:\n{hablantes_text}\n\n"
                        f"INTERVENCIONES ADICIONALES:\n{chunk}\n\n"
                        f"Responde ÚNICAMENTE con los párrafos de intervenciones:\n"
                        f"<p><strong>ROL:</strong> texto en lenguaje formal judicial de tercera persona...</p>\n"
                        f"Sin encabezados, sin sección DECISIÓN, sin párrafo de cierre. Solo HTML: <p>, <strong>, <em>."
                    )

                # Heartbeat to keep DB connection alive during long AI calls
                try:
                    await db.execute(select(1))
                except Exception as db_ping_err:
                    logger.warning(f"DB heartbeat failed: {db_ping_err}")

                msg = await client.messages.create(
                    model=ACTA_MODEL,
                    max_tokens=ACTA_MAX_TOKENS,
                    temperature=0.1,
                    messages=[{"role": "user", "content": prompt}],
                )
                if msg.stop_reason == "max_tokens":
                    logger.warning(
                        f"Bloque {i+1}/{len(chunks)} truncado por límite de tokens. "
                        f"Chunk={len(chunk)} chars. Considera reducir CHUNK_SIZE."
                    )
                part = _clean_llm_output(msg.content[0].text)
                html_parts.append(part)
                total_in_tok += msg.usage.input_tokens
                total_out_tok += msg.usage.output_tokens
                logger.info(
                    f"Bloque {i+1}/{len(chunks)}: in={msg.usage.input_tokens} out={msg.usage.output_tokens} tokens, stop={msg.stop_reason}"
                )

            # Ensamblar: el primer bloque tiene la estructura completa;
            # los bloques intermedios/final se insertan ANTES de cualquier
            # sección DECISIÓN que el primer bloque haya podido generar.
            if len(html_parts) == 1:
                contenido_llm = html_parts[0]
            else:
                first_part = html_parts[0]
                # Truncar el primer bloque antes de cualquier sección DECISIÓN
                # para evitar duplicarla con la del último bloque.
                decision_markers = ['<h3>DECISIÓN', '<h3>Decisión', '<h3>DECISION']
                cut_pos = len(first_part)
                for marker in decision_markers:
                    idx = first_part.find(marker)
                    if idx != -1 and idx < cut_pos:
                        cut_pos = idx
                first_truncated = first_part[:cut_pos].rstrip()

                # Combinar: primer bloque truncado + bloques intermedios + bloque final
                contenido_llm = first_truncated + "\n" + "\n".join(html_parts[1:])

        tokens_used = total_in_tok + total_out_tok
        modelo_real = ACTA_MODEL
        logger.info(
            f"Acta generada en {'1 llamada' if len(transcripcion) <= CHUNK_SIZE else f'{len(chunks)} bloques'}: "
            f"in={total_in_tok} out={total_out_tok} tokens"
        )

        # Registrar uso real en tabla uso_api (siempre en sesión transiente para no contaminar la principal)
        try:
            await registrar_uso_claude(
                db=None, 
                servicio="claude_acta",
                modelo=modelo_real,
                input_tokens=total_in_tok,
                output_tokens=total_out_tok,
                audiencia_id=audiencia_id,
                usuario_id=usuario_id,
            )
        except Exception as cost_err:
            logger.warning(f"No se pudo registrar costo uso_api (no crítico): {cost_err}")

    except Exception as e:
        logger.error(f"Error generando acta con Claude: {e}", exc_info=True)
        raise RuntimeError(f"Error al generar acta con la IA: {str(e)}")

    # 9. Determinar versión
    # Heartbeat final antes de las operaciones de guardado para asegurar conexión viva
    try:
        await db.execute(select(1))
    except Exception as db_err:
        logger.warning(f"DB ping final falló: {db_err}")
        # Si la conexión se perdió durante la larga espera de Claude, 
        # intentamos un rollback suave (si es posible) antes de fallar.
        try:
            await db.rollback()
        except:
            pass
        raise RuntimeError("La conexión con la base de datos se perdió durante la generación. Por favor, reintente.")

    result = await db.execute(
        select(Acta)
        .where(Acta.audiencia_id == audiencia_id)
        .order_by(Acta.version.desc())
    )
    ultima_acta = result.scalars().first()
    # Si hay acta_existente_id usamos su versión; si no, calculamos la siguiente
    if acta_existente_id and ultima_acta and ultima_acta.id == acta_existente_id:
        nueva_version = ultima_acta.version
    else:
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

    # 11. Guardar en BD (actualizar placeholder si existe, o crear nuevo)
    if acta_existente_id:
        result_e = await db.execute(select(Acta).where(Acta.id == acta_existente_id))
        acta = result_e.scalar_one_or_none()

    if acta_existente_id and acta:
        acta.version = nueva_version
        acta.formato = formato
        acta.estado = "borrador"
        acta.contenido_llm = contenido_llm
        acta.prompt_utilizado = prompt[:2000]
        acta.modelo_llm = ACTA_MODEL
        acta.tokens_used = tokens_used
        acta.confianza = 0.9
        acta.generado_por = usuario_id
    else:
        acta = Acta(
            audiencia_id=audiencia_id,
            version=nueva_version,
            formato=formato,
            estado="borrador",
            contenido_llm=contenido_llm,
            prompt_utilizado=prompt[:2000],
            modelo_llm=ACTA_MODEL,
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
