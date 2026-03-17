"""
Servicio de análisis contextual con IA para corrección de palabras.

Usa Claude para analizar el contexto de una frase y sugerir correcciones
inteligentes basadas en el significado y el contexto judicial.
"""
import logging
from typing import List, Dict, Optional
import anthropic
from app.config import settings

logger = logging.getLogger(__name__)


class ContextAnalysisService:
    """
    Analiza el contexto de frases para sugerir correcciones inteligentes.
    """

    def __init__(self):
        self.client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    async def analyze_word_in_context(
        self,
        word: str,
        sentence: str,
        confidence: float = 0.0,
        previous_context: Optional[str] = None,
    ) -> Dict:
        """
        Analiza una palabra en su contexto y sugiere correcciones.

        Args:
            word: La palabra a analizar
            sentence: La frase completa donde aparece la palabra
            confidence: Confianza de Deepgram en la palabra (0-1)
            previous_context: Contexto anterior (frases previas)

        Returns:
            Dict con:
                - is_correct: Si la palabra parece correcta en contexto
                - suggestions: Lista de sugerencias ordenadas por probabilidad
                - corrected_sentence: La frase completa corregida
                - segment_type: Tipo de segmento (pregunta, afirmación, etc.)
                - explanation: Explicación breve de la corrección
        """
        try:
            prompt = f"""Eres un experto en transcripción judicial peruana. Analiza la siguiente palabra en su contexto y determina si es correcta o necesita corrección.

CONTEXTO PREVIO:
{previous_context or "Inicio de la audiencia"}

FRASE ACTUAL:
"{sentence}"

PALABRA A ANALIZAR: "{word}"
CONFIANZA DE TRANSCRIPCIÓN: {int(confidence * 100)}%

ANÁLISIS REQUERIDO:
1. ¿La palabra "{word}" es correcta en este contexto judicial?
2. Si NO es correcta, ¿cuáles son las palabras más probables que debería ser?
3. ¿Cómo quedaría la frase completa corregida?
4. ¿Es esta frase una pregunta, afirmación, respuesta corta o declaración formal?

REGLAS:
- Considera el contexto judicial peruano (términos legales, cargos, procedimientos)
- Si la palabra parece correcta en contexto, marca is_correct=true
- Las sugerencias deben ser palabras REALES que tengan sentido en el contexto
- No inventes información, solo corrige basándote en lo que tiene sentido
- Si es una pregunta, asegúrate de que tenga signos ¿?
- Capitaliza correctamente (Juez, Fiscal, Señor, etc.)

Responde SOLO con JSON válido (sin markdown):
{{
  "is_correct": true/false,
  "suggestions": [
    {{"word": "palabra1", "confidence": 0.95, "reason": "razón breve"}},
    {{"word": "palabra2", "confidence": 0.80, "reason": "razón breve"}}
  ],
  "corrected_sentence": "La frase completa corregida",
  "segment_type": "pregunta|afirmación|respuesta|declaración",
  "explanation": "Explicación breve de por qué se sugiere la corrección"
}}"""

            message = self.client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=500,
                temperature=0.2,
                messages=[{"role": "user", "content": prompt}],
            )

            # Parsear respuesta JSON
            import json
            response_text = message.content[0].text.strip()

            # Eliminar markdown si existe
            if response_text.startswith("```"):
                response_text = response_text.split("\n", 1)[1].rsplit("\n```", 1)[0]

            result = json.loads(response_text)

            logger.info(f"Context analysis for '{word}': correct={result.get('is_correct')}")
            return result

        except Exception as e:
            logger.error(f"Error in context analysis: {e}")
            # Fallback básico
            return {
                "is_correct": confidence > 0.7,
                "suggestions": [],
                "corrected_sentence": sentence,
                "segment_type": "afirmación",
                "explanation": "No se pudo analizar el contexto"
            }

    async def get_phrase_corrections(
        self,
        sentence: str,
        previous_context: Optional[str] = None,
    ) -> Dict:
        """
        Analiza una frase completa y sugiere correcciones.

        Args:
            sentence: La frase a analizar
            previous_context: Contexto anterior

        Returns:
            Dict con la frase corregida y explicaciones
        """
        try:
            prompt = f"""Eres un digitador judicial experto del Poder Judicial de Perú. Corrige la siguiente transcripción de audio.

CONTEXTO PREVIO:
{previous_context or "Inicio de la audiencia"}

FRASE A CORREGIR:
"{sentence}"

REGLA PRINCIPAL (ABSOLUTA):
⚠️ SOLO corregir palabras existentes. NUNCA añadir ni completar texto.

CORRECCIONES PERMITIDAS (solo reemplazo 1:1):
1. Ortografía y tildes (que→qué en preguntas, si→sí afirmativo, presuncion→presunción)
2. Puntuación (¿?, ¡!, puntos, comas)
3. Mayúsculas en cargos (Juez, Fiscal, Doctor, Señor, Señoría)
4. Términos legales mal transcritos (reemplazo 1 palabra → 1 palabra)

PROHIBIDO:
- NO añadir palabras nuevas
- NO completar frases incompletas
- NO cambiar el número de palabras
- NO inventar información
- Mantener el significado original exacto

Responde SOLO con JSON:
{{
  "original": "frase original",
  "corrected": "frase corregida (misma cantidad de palabras)",
  "segment_type": "pregunta|afirmación|respuesta|declaración",
  "changes": [
    {{"from": "palabra_original", "to": "palabra_corregida", "reason": "razón"}}
  ],
  "confidence": 0.95
}}"""

            message = self.client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=400,
                temperature=0.1,
                messages=[{"role": "user", "content": prompt}],
            )

            import json
            response_text = message.content[0].text.strip()
            if response_text.startswith("```"):
                response_text = response_text.split("\n", 1)[1].rsplit("\n```", 1)[0]

            return json.loads(response_text)

        except Exception as e:
            logger.error(f"Error in phrase correction: {e}")
            return {
                "original": sentence,
                "corrected": sentence,
                "segment_type": "afirmación",
                "changes": [],
                "confidence": 0.5
            }


# Singleton
_context_service: Optional[ContextAnalysisService] = None


def get_context_service() -> ContextAnalysisService:
    """Obtiene la instancia singleton del servicio."""
    global _context_service
    if _context_service is None:
        _context_service = ContextAnalysisService()
    return _context_service
