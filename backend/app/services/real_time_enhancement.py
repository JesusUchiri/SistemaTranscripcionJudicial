"""
Servicio de mejoramiento en tiempo real de transcripciones usando Claude Sonnet 4.

Procesa segmentos de transcripción para:
- Detectar si una frase está completa o necesita continuar
- Consolidar múltiples segmentos en oraciones coherentes
- Mejorar puntuación y capitalización
- Identificar preguntas y exclamaciones
- Formatear como documento legal formal
"""
import logging
from typing import Optional, List, Dict
import anthropic
from app.config import settings
from app.services.text_processing import detect_question

logger = logging.getLogger(__name__)


class RealTimeEnhancementService:
    """
    Mejora transcripciones en tiempo real usando Claude Sonnet 4.
    Mantiene contexto de la conversación para decisiones inteligentes.
    Consolida múltiples segmentos en frases completas.
    """

    def __init__(self):
        self.client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
        self.max_context_segments = 5
        # El cliente AsyncAnthropic es stateless y seguro para compartir entre corrutinas.
        # NO almacenar conversation_context aquí — sería estado global compartido entre
        # TODAS las audiencias concurrentes. El contexto se pasa por parámetro (previous_segments)
        # desde cada sesión WebSocket, que lo mantiene localmente.

    async def is_sentence_complete(
        self,
        text: str,
        speaker_id: str,
        previous_segments: Optional[List[Dict[str, str]]] = None,
        audiencia_id: Optional[str] = None,
    ) -> Dict[str, any]:
        """
        Determina si un segmento de texto es una frase completa o necesita continuar.

        Args:
            text: Texto transcrito
            speaker_id: ID del hablante
            previous_segments: Segmentos anteriores para contexto

        Returns:
            Dict con:
                - is_complete: Si la frase está completa
                - should_continue: Si se espera más texto del mismo speaker
                - confidence: Confianza en la decisión (0-1)
                - reason: Explicación de la decisión
        """
        try:
            context_text = self._build_context(previous_segments or [])

            prompt = f"""Eres un experto en transcripción judicial. Tu tarea es determinar si la siguiente transcripción de audio es una FRASE COMPLETA o si el hablante está en medio de una oración y continuará hablando.

CONTEXTO DE LA CONVERSACIÓN:
{context_text if context_text else "Inicio de la audiencia"}

HABLANTE ACTUAL: {speaker_id}
TEXTO TRANSCRITO: "{text}"

REGLAS IMPORTANTES:
1. Una frase está COMPLETA si tiene sentido gramatical completo y no parece cortada
2. Una frase está INCOMPLETA si:
   - Termina en preposición o conjunción ("que", "para", "y", "o", "si")
   - Claramente le falta el complemento ("vamos a", "acordado para")
   - El contexto indica que continuará
3. NO consideres pausas naturales como fin de frase
4. Si la persona está pensando o completando una idea, marca como INCOMPLETA

Responde SOLO con un JSON válido (sin markdown):
{{
  "is_complete": true/false,
  "should_continue": true/false,
  "confidence": 0.0-1.0,
  "reason": "breve explicación"
}}"""

            message = await self.client.messages.create(
                model=settings.ANTHROPIC_MODEL,
                max_tokens=200,
                temperature=0.1,
                messages=[{"role": "user", "content": prompt}],
            )

            # Parsear respuesta JSON
            import json
            response_text = message.content[0].text.strip()
            # Eliminar markdown si existe
            if response_text.startswith("```"):
                response_text = response_text.split("\n", 1)[1].rsplit("\n```", 1)[0]
            
            result = json.loads(response_text)
            
            # Registrar costo
            try:
                import uuid as _uuid
                from app.services.cost_tracker import registrar_uso_claude
                await registrar_uso_claude(
                    db=None,
                    servicio="claude_sentence_completion",
                    modelo=settings.ANTHROPIC_MODEL,
                    input_tokens=message.usage.input_tokens,
                    output_tokens=message.usage.output_tokens,
                    audiencia_id=_uuid.UUID(audiencia_id) if audiencia_id else None,
                )
            except Exception as metric_err:
                logger.error(f"Error registrando costo: {metric_err}")

            logger.info(f"Sentence completion check: {result['is_complete']} - {result['reason']}")
            return result

        except Exception as e:
            logger.error(f"Error checking sentence completion: {e}")
            # Fallback conservador: si termina en preposición/conjunción, no está completo
            incomplete_endings = ["que", "para", "y", "o", "si", "pero", "cuando", "porque", "a", "de", "con"]
            last_word = text.strip().split()[-1].lower() if text.strip() else ""
            is_incomplete = any(last_word.endswith(ending) for ending in incomplete_endings)
            
            return {
                "is_complete": not is_incomplete,
                "should_continue": is_incomplete,
                "confidence": 0.6,
                "reason": f"Análisis básico: {'termina en palabra conectora' if is_incomplete else 'parece completo'}"
            }

    async def enhance_segment(
        self,
        text: str,
        speaker_id: str,
        previous_segments: Optional[List[Dict[str, str]]] = None,
        audiencia_id: Optional[str] = None,
    ) -> Dict[str, str]:
        """
        Mejora un segmento de transcripción con contexto.

        Args:
            text: Texto transcrito por Deepgram
            speaker_id: ID del hablante
            previous_segments: Segmentos anteriores para contexto

        Returns:
            Dict con:
                - original: Texto original
                - enhanced: Texto mejorado
                - is_question: Si es una pregunta
                - is_statement: Si es una declaración formal
                - confidence: Confianza en el mejoramiento (0-1)
        """
        try:
            # Construir contexto de conversación
            context_text = self._build_context(previous_segments or [])

            # Determinar caso de la primera letra ANTES de llamar a Claude
            # (para poder corregir la salida si Claude lo ignora)
            ctx_last = context_text.strip()[-1] if context_text.strip() else ""
            es_continuacion = bool(ctx_last) and ctx_last not in ".?!"

            # Cambio de hablante → siempre nueva oración (mayúscula), sin importar
            # si el contexto anterior terminó en puntuación o no.
            if es_continuacion and previous_segments:
                last_speaker = previous_segments[-1].get("speaker_id", "")
                if last_speaker and last_speaker != speaker_id:
                    es_continuacion = False
                    logger.info(f"[CTX] Speaker change {last_speaker}→{speaker_id}: forzando mayúscula")

            logger.info(f"[CTX] ctx_last='{ctx_last}' es_continuacion={es_continuacion} ctx_tail='{context_text.strip()[-40:] if context_text.strip() else ''}'")

            # Prompt para Claude (ya incluye pre-procesamiento de primera letra)
            prompt = self._build_enhancement_prompt(text, speaker_id, context_text)

            # Llamar a Claude con streaming desactivado para respuesta rápida
            logger.info(f"🧠 [ENHANCE] Modelo: {settings.ANTHROPIC_MODEL}, prompt len: {len(prompt)} chars")
            message = await self.client.messages.create(
                model=settings.ANTHROPIC_MODEL,
                max_tokens=500,
                temperature=0.1,  # Temperatura más baja → menos creatividad, más consistencia
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
            )

            # Extraer respuesta
            enhanced_text = message.content[0].text.strip()
            logger.info(f"🧠 [ENHANCE] Respuesta OK: in={message.usage.input_tokens} out={message.usage.output_tokens} tokens")

            # ── POST-PROCESAMIENTO: aplicar caso de primera letra en Python ──────
            # Claude a veces ignora la instrucción de minúscula aunque la reciba.
            # Esta corrección es determinista y no depende del LLM.
            if enhanced_text:
                first_alpha_idx = next((i for i, c in enumerate(enhanced_text) if c.isalpha()), -1)
                if first_alpha_idx >= 0:
                    ch = enhanced_text[first_alpha_idx]
                    forced = ch.lower() if es_continuacion else ch.upper()
                    if ch != forced:
                        enhanced_text = (
                            enhanced_text[:first_alpha_idx]
                            + forced
                            + enhanced_text[first_alpha_idx + 1:]
                        )
                        logger.debug(f"[POST] Primera letra corregida: '{ch}'→'{forced}' (continuacion={es_continuacion})")

            # Analizar tipo de segmento con detección centralizada
            is_question = detect_question(enhanced_text)
            is_statement = enhanced_text.endswith(".")

            # Actualizar contexto de conversación
            # Contexto manejado por el caller (sesión WS) via previous_segments

            # Calcular costo independientemente de la base de datos (para no fallar UI)
            from app.services.cost_tracker import calcular_costo_claude, registrar_uso_claude
            usd_cost = calcular_costo_claude(message.usage.input_tokens, message.usage.output_tokens, settings.ANTHROPIC_MODEL)
            logger.info(f"💰 [ENHANCE] Costo calculado: ${usd_cost:.6f} (model={settings.ANTHROPIC_MODEL})")
            
            # Convertir audiencia_id a UUID antes de pasar al registrador
            parsed_audiencia_id = None
            if audiencia_id:
                try:
                    import uuid as _uuid
                    parsed_audiencia_id = _uuid.UUID(str(audiencia_id))
                    logger.info(f"💰 [ENHANCE] audiencia_id parseado: {parsed_audiencia_id}")
                except Exception as parse_err:
                    logger.error(f"💰 [ENHANCE] ❌ No se pudo parsear audiencia_id '{audiencia_id}': {parse_err}")
            else:
                logger.warning(f"💰 [ENHANCE] ⚠️ audiencia_id es None/vacío al registrar costo")
            
            try:
                await registrar_uso_claude(
                    db=None,
                    servicio="claude_enhancement",
                    modelo=settings.ANTHROPIC_MODEL,
                    input_tokens=message.usage.input_tokens,
                    output_tokens=message.usage.output_tokens,
                    audiencia_id=parsed_audiencia_id,
                )
            except Exception as metric_err:
                logger.error(f"Error registrando costo en BD: {metric_err}", exc_info=True)

            return {
                "original": text,
                "enhanced": enhanced_text,
                "is_question": is_question,
                "is_statement": is_statement,
                "confidence": 0.95,  # Claude tiene alta confianza
                "usd_cost": usd_cost,
            }

        except Exception as e:
            logger.error(f"Error enhancing segment: {e}")
            from app.services.text_processing import clean_transcript
            fallback = clean_transcript(text)

            return {
                "original": text,
                "enhanced": fallback,
                "is_question": detect_question(fallback),
                "is_statement": True,
                "confidence": 0.5,
                "usd_cost": 0.0,
            }

    def _build_context(self, previous_segments: List[Dict[str, str]]) -> str:
        """Construye texto de contexto de segmentos anteriores.

        USA texto_ia (no texto_mejorado) para evitar contaminar el contexto con
        salidas incorrectas de Claude (ej. encabezados de acta mal generados).
        Normaliza espacios y elimina saltos de línea para mantener el contexto
        como línea única por segmento — esto evita confusión en el prompt.
        """
        if not previous_segments:
            return ""

        context_parts = []
        for seg in previous_segments[-self.max_context_segments:]:
            speaker = seg.get("speaker_id", "DESCONOCIDO")
            # Usar texto_ia (transcripción original de Deepgram) — más seguro que
            # texto_mejorado que podría contener encabezados o texto incorrecto.
            text = (seg.get("texto_ia") or "").strip()
            if not text:
                continue
            # Eliminar saltos de línea para que el contexto sea una sola línea
            text = " ".join(text.split())
            # Limitar a 120 chars para no sobrecargar el prompt
            if len(text) > 120:
                text = text[:120] + "…"
            context_parts.append(f"{speaker}: {text}")

        return "\n".join(context_parts)

    def _build_enhancement_prompt(
        self, text: str, speaker_id: str, context: str
    ) -> str:
        """Construye el prompt para Claude."""
        ctx_strip = context.strip()
        context_last_char = ctx_strip[-1] if ctx_strip else ""
        es_nueva_oracion = context_last_char in ".?!" or not ctx_strip

        # ── PRE-PROCESAMIENTO EN PYTHON (antes de que Claude lo vea) ──────────
        # Si es continuación, forzar minúscula en primera letra directamente.
        # Así Claude nunca necesita "decidir" sobre la primera letra.
        if text:
            # Saltar si empieza con ¿ o ¡ (no tienen forma en minúscula)
            first_alpha_idx = next((i for i, c in enumerate(text) if c.isalpha()), -1)
            if first_alpha_idx >= 0:
                if es_nueva_oracion:
                    # Asegurar que empieza con mayúscula
                    text = text[:first_alpha_idx] + text[first_alpha_idx].upper() + text[first_alpha_idx + 1:]
                else:
                    # Forzar minúscula en continuación — definitivo, no se discute con Claude
                    text = text[:first_alpha_idx] + text[first_alpha_idx].lower() + text[first_alpha_idx + 1:]

        if es_nueva_oracion:
            regla_primera_letra = "MAYÚSCULA — la primera letra ya viene correcta, respétala."
        else:
            regla_primera_letra = "MINÚSCULA — es continuación de oración, la primera letra ya fue forzada a minúscula, respétala."

        return f"""Eres un digitador judicial del Distrito Judicial de Cusco, Perú.
Corrige el TEXTO CRUDO de Deepgram: ortografía, puntuación y mayúsculas. Nunca añadas ni inventes palabras.

CONTEXTO PREVIO:
{ctx_strip if ctx_strip else "Inicio de la audiencia"}

HABLANTE: {speaker_id}
TEXTO CRUDO: {text}

── PASO 1: ARTEFACTOS DE ASR ──────────────────────────────────────────
• Repetición doble (disfluencia) → elimina la copia: "un un" → "un" | "a a" → "a"
• Repetición triple o más de palabra larga (≥4 chars, alucinación ASR) → [SEGMENTO INAUDIBLE]
• Muletillas puras sin contenido (eeeeh, mmmm, aaaa) → elimínalas.

── PASO 2: PRIMERA LETRA ──────────────────────────────────────────────
{regla_primera_letra}

── PASO 3: MAYÚSCULAS INTERNAS ────────────────────────────────────────
• Solo en mayúscula: primera letra tras punto/pregunta/exclamación internos, y nombres propios
  (personas, lugares, instituciones: "Cusco", "Ministerio Público", "Poder Judicial").
• TODO lo demás en minúscula: "el juez", "la fiscal", "el código penal", "el imputado".

── PASO 4: PUNTUACIÓN ─────────────────────────────────────────────────
• Corrige o agrega comas, puntos, punto y coma, dos puntos.
• ¿? solo en oraciones directamente interrogativas completas. NO agregar ¿ a verbos
  en infinitivo ni afirmaciones aunque suenen cuestionadoras ("Argumentar que...", "Decir que...").
• ¡! solo en exclamaciones claras.
• Si el texto termina con idea completa → agregar punto final.
• Si termina en coma, conjunción o frase incompleta → NO agregar punto.
• Si termina en "..." (puntos suspensivos) → NO agregar punto adicional.

── PASO 5: CORRECCIÓN DE PALABRAS ─────────────────────────────────────
• Corrige palabras mal reconocidas por el ASR (errores fonéticos, homófonos, términos legales).
• PROHIBIDO: agregar palabras, completar ideas, parafrasear, resumir.

REGLA ABSOLUTA: Devuelve ÚNICAMENTE el texto corregido. Una sola línea continua, sin saltos de línea.

TEXTO CORREGIDO:"""

    def reset_context(self):
        """No-op para compatibilidad. El contexto por-sesión vive en el WS handler."""
        pass


# Singleton instance
_enhancement_service: Optional[RealTimeEnhancementService] = None


def get_enhancement_service() -> RealTimeEnhancementService:
    """Obtiene la instancia singleton del servicio de mejoramiento."""
    global _enhancement_service
    if _enhancement_service is None:
        _enhancement_service = RealTimeEnhancementService()
    return _enhancement_service
