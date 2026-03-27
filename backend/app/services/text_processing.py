"""
Módulo de procesamiento de texto para transcripción judicial.

Centraliza:
- Detección de preguntas (detect_question)
- Limpieza rápida de transcripciones (clean_transcript)
- Pre-procesamiento de ruido de Deepgram (preprocess_raw_transcript)
"""
import re

# Palabras interrogativas para detección de preguntas
QUESTION_WORDS = {
    "qué", "que", "cómo", "como", "cuándo", "cuando", "dónde", "donde",
    "por qué", "quién", "quien", "cuál", "cual", "cuánto", "cuanto",
    "para qué", "acaso", "puede", "podría", "sabe", "conoce", "recuerda",
    "entiende", "confirma", "niega", "reconoce", "acepta",
}

QUESTION_PATTERNS = [
    "es cierto que", "verdad que", "acaso", "¿",
    "puede indicar", "podría decir", "sabe usted",
    "recuerda usted", "conoce usted",
]


def detect_question(text: str) -> bool:
    """Detecta si el texto es una pregunta."""
    if not text or not text.strip():
        return False
    if "?" in text or "¿" in text:
        return True
    clean_text = text.strip().lower()
    first_word = clean_text.split()[0] if clean_text.split() else ""
    if first_word in QUESTION_WORDS:
        return True
    if any(clean_text.startswith(p) for p in QUESTION_PATTERNS):
        return True
    return False


def preprocess_raw_transcript(text: str) -> str:
    """
    Limpia el texto crudo de Deepgram ANTES de enviarlo a Claude.

    Elimina artefactos comunes de ASR que no deben llegar al LLM:
    1. Repeticiones triples o más de la misma palabra → [SEGMENTO INAUDIBLE]
       Ej: "Port Port Port Port Port" → "[SEGMENTO INAUDIBLE]"
    2. Repeticiones dobles inmediatas → una sola ocurrencia
       Ej: "lo lo", "no no", "la la" → "lo", "no", "la"
    3. Espacios múltiples → un solo espacio
    """
    if not text:
        return text

    # 1. Repetición triple o más de la misma palabra → [SEGMENTO INAUDIBLE]
    #    Sin \b final para que la coincidencia sea greedy en toda la secuencia.
    #    Ej: "Port Port Port Port Port..." → "[SEGMENTO INAUDIBLE]"
    text = re.sub(
        r'\b(\w+)(?:\s+\1){2,}',
        '[SEGMENTO INAUDIBLE]',
        text,
        flags=re.IGNORECASE,
    )

    # 2. Repetición doble inmediata → una sola vez
    #    Ej: "lo lo" → "lo", "no no hay" → "no hay", "a a la" → "a la"
    text = re.sub(
        r'\b(\w+)\s+\1\b',
        r'\1',
        text,
        flags=re.IGNORECASE,
    )

    # 3. Normalizar espacios
    text = re.sub(r'\s+', ' ', text).strip()

    return text


def clean_transcript(text: str) -> str:
    """
    Limpieza rápida y conservadora del texto transcrito.

    SOLO hace:
    1. Normalizar espacios
    2. Capitalizar la primera letra del segmento
    3. Capitalizar después de punto/interrogación/exclamación
    4. Asegurar espaciado correcto después de comas y puntos

    NO capitaliza cargos judiciales genéricamente (eso lo hace Claude
    en el paso de mejoramiento, con contexto completo).
    """
    if not text:
        return text

    # 1. Normalizar espacios
    text = re.sub(r'\s+', ' ', text.strip())

    # 2. Capitalizar primera letra del segmento
    if text:
        text = text[0].upper() + text[1:]

    # 3. Capitalizar después de puntuación final (. ? !)
    def _cap_after_punct(m: re.Match) -> str:
        return m.group(1) + m.group(2).upper()

    text = re.sub(r'([.?!]\s+)([a-záéíóúñü])', _cap_after_punct, text)

    # 4. Espaciado correcto después de signos de puntuación
    text = re.sub(r'([,;:])\s*', r'\1 ', text)
    text = re.sub(r'\s+([,;:.?!])', r'\1', text)

    return text.strip()
