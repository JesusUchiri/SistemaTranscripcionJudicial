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
        self.conversation_context: List[Dict[str, str]] = []
        self.max_context_segments = 25  # Mantener últimos 25 segmentos (~3-5 min de contexto)

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

            # Prompt para Claude
            prompt = self._build_enhancement_prompt(text, speaker_id, context_text)

            # Llamar a Claude con streaming desactivado para respuesta rápida
            logger.info(f"🧠 [ENHANCE] Modelo: {settings.ANTHROPIC_MODEL}, prompt len: {len(prompt)} chars")
            message = await self.client.messages.create(
                model=settings.ANTHROPIC_MODEL,
                max_tokens=500,
                temperature=0.3,  # Baja temperatura para consistencia
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

            # Analizar tipo de segmento con detección centralizada
            is_question = detect_question(enhanced_text)
            is_statement = enhanced_text.endswith(".")

            # Actualizar contexto de conversación
            self._update_context(speaker_id, text, enhanced_text)

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
        return f"""Eres un digitador judicial del Distrito Judicial de Cusco, Perú.

Tu tarea es corregir ortografía, puntuación y mayúsculas del TEXTO CRUDO de Deepgram.

CONTEXTO PREVIO (solo para saber si el texto es continuación o frase nueva):
{context if context else "Inicio de la audiencia"}

HABLANTE: {speaker_id}
TEXTO CRUDO: {text}

═══ REGLA 0 — ARTEFACTOS DE AUDIO (aplicar PRIMERO) ═══
a) REPETICIÓN DOBLE de palabra (disfluencia) → elimina la copia extra:
   "lo lo" → "lo" | "no no" → "no" | "la la parte" → "la parte"

b) REPETICIÓN TRIPLE O MÁS (alucinación del ASR) → [SEGMENTO INAUDIBLE]:
   "Port Port Port Port" → [SEGMENTO INAUDIBLE]
   Umbral: 3+ repeticiones consecutivas = usar [SEGMENTO INAUDIBLE].

═══ REGLA 1 — MAYÚSCULAS ═══
Primera letra:
  • Contexto previo termina en . ? ! → mayúscula inicial (nueva oración)
  • Contexto termina en , ; : o sin puntuación → minúscula (continuación)
  • "Inicio de la audiencia" → mayúscula inicial

Dentro del texto: mayúscula tras . ? ! internos; nombres propios; en duda → minúscula.
NUNCA capitalizar sustantivos comunes, adjetivos genéricos, preposiciones ni conjunciones.

═══ REGLA 2 — PUNTUACIÓN ═══
Agrega o corrige: , . ; : ¿? ¡!
Si el texto termina con idea completa, agrega punto final.

═══ REGLA 3 — CORRECCIÓN 1:1 ═══
Corrige palabras mal transcritas. PROHIBIDO: agregar palabras, completar oraciones, parafrasear.

⚠️ OBLIGATORIO: Devuelve ÚNICAMENTE el texto corregido del TEXTO CRUDO de arriba.
NO añadas encabezados, títulos, ni texto del contexto previo.
NO escribas "Acta", "Expediente" ni nada que no esté en el TEXTO CRUDO.
La salida debe ser UNA sola línea continua (sin saltos de línea internos).

TEXTO CORREGIDO:"""

    def _update_context(self, speaker_id: str, original: str, enhanced: str):
        """Actualiza el contexto de conversación."""
        self.conversation_context.append(
            {
                "speaker_id": speaker_id,
                "texto_ia": original,
                "texto_mejorado": enhanced,
            }
        )

        # Mantener solo los últimos N segmentos
        if len(self.conversation_context) > self.max_context_segments:
            self.conversation_context = self.conversation_context[
                -self.max_context_segments :
            ]

    def reset_context(self):
        """Reinicia el contexto de conversación (inicio de nueva audiencia)."""
        self.conversation_context = []
        logger.info("Contexto de conversación reiniciado")


# Singleton instance
_enhancement_service: Optional[RealTimeEnhancementService] = None


def get_enhancement_service() -> RealTimeEnhancementService:
    """Obtiene la instancia singleton del servicio de mejoramiento."""
    global _enhancement_service
    if _enhancement_service is None:
        _enhancement_service = RealTimeEnhancementService()
    return _enhancement_service
