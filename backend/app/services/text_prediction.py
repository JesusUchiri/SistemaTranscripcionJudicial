"""
Servicio de predicción de texto para autocompletado judicial.

Funcionalidades:
- Predicción de continuación de frases
- Detección y capitalización de nombres propios
- Detección de códigos de expediente judicial
- Detección de estructura de párrafos
- Completar frases legales comunes
"""
import re
import logging
from typing import Optional, Dict, List, Tuple
import anthropic
from app.config import settings

logger = logging.getLogger(__name__)


# ============================================================================
# PATRONES DE EXPEDIENTE JUDICIAL PERUANO
# Formato típico: NNNNN-YYYY-0-DDDD-JR-PE-01
# ============================================================================
EXPEDIENTE_PATTERNS = [
    # Formato completo: 00123-2024-0-1001-JR-PE-01
    r'\b(\d{5})-(\d{4})-(\d)-(\d{4})-([A-Z]{2})-([A-Z]{2})-(\d{2})\b',
    # Formato parcial: 00123-2024
    r'\b(\d{5})-(\d{4})\b',
    # Formato con guiones: 123-2024-JR-PE
    r'\b(\d{1,5})-(\d{4})-([A-Z]{2})-([A-Z]{2})\b',
    # Formato alternativo Cusco: Exp. N° 123-2024
    r'[Ee]xp(?:ediente)?\.?\s*[Nn]°?\s*(\d{1,6})-(\d{4})',
]

# Especialidades judiciales
ESPECIALIDADES = {
    'PE': 'Penal',
    'CI': 'Civil',
    'LA': 'Laboral',
    'FA': 'Familia',
    'CO': 'Constitucional',
    'CA': 'Contencioso Administrativo',
}


# ============================================================================
# NOMBRES PROPIOS COMUNES EN PERÚ
# ============================================================================
NOMBRES_COMUNES = {
    # Nombres masculinos
    'juan', 'jose', 'carlos', 'luis', 'miguel', 'pedro', 'jorge', 'antonio',
    'manuel', 'francisco', 'david', 'alberto', 'ricardo', 'fernando', 'victor',
    'cesar', 'hugo', 'raul', 'oscar', 'andres', 'pablo', 'sergio', 'marco',
    'javier', 'roberto', 'mario', 'walter', 'edgar', 'henry', 'william',
    # Nombres femeninos
    'maria', 'rosa', 'carmen', 'ana', 'luz', 'patricia', 'elizabeth', 'gloria',
    'julia', 'teresa', 'martha', 'nancy', 'silvia', 'elena', 'milagros',
    'jessica', 'claudia', 'mercedes', 'beatriz', 'monica', 'angela', 'veronica',
    'sandra', 'carolina', 'victoria', 'lucia', 'daniela', 'katherine',
}

APELLIDOS_COMUNES = {
    'garcia', 'rodriguez', 'martinez', 'lopez', 'gonzalez', 'hernandez',
    'perez', 'sanchez', 'ramirez', 'torres', 'flores', 'rivera', 'gomez',
    'diaz', 'reyes', 'morales', 'jimenez', 'ruiz', 'alvarez', 'romero',
    'mendoza', 'vargas', 'castro', 'ortiz', 'gutierrez', 'ramos', 'rojas',
    'medina', 'chavez', 'herrera', 'cruz', 'aguilar', 'fernandez', 'silva',
    'vasquez', 'espinoza', 'quispe', 'mamani', 'condori', 'huaman', 'apaza',
    'choque', 'cusi', 'ccama', 'suma', 'paucar', 'hancco', 'nina',
    # Apellidos quechuas/aymaras comunes en Cusco
    'quispe', 'mamani', 'condori', 'huaman', 'apaza', 'choque', 'cusi',
    'ccama', 'suma', 'paucar', 'hancco', 'nina', 'huanca', 'yupanqui',
    'ataucuri', 'pillco', 'ticona', 'cutipa', 'chambi', 'ccoa',
}


# ============================================================================
# FRASES LEGALES COMUNES PARA AUTOCOMPLETADO
# ============================================================================
FRASES_LEGALES = {
    # Inicio de audiencia
    'siendo las': ' horas del día ',
    'en la ciudad de': ' Cusco, ',
    'se da inicio a la': ' audiencia de ',
    'con la presencia de': ' las partes procesales, ',
    'el señor juez': ' procede a ',
    'la señora fiscal': ' procede a ',
    'se deja constancia': ' que ',
    'habiéndose verificado': ' la presencia de las partes, ',

    # Durante la audiencia
    'el imputado declara': ' que ',
    'el agraviado manifiesta': ' que ',
    'el testigo indica': ' que ',
    'el perito señala': ' que ',
    'la defensa técnica': ' solicita ',
    'el ministerio público': ' requiere ',
    'se tiene por': ' notificado a ',
    'se dispone': ' la ',
    'se resuelve': ' declarar ',

    # Cierre de audiencia
    'no habiendo otro punto': ' que tratar, ',
    'siendo las': ' horas se da por concluida la presente audiencia, ',
    'firmando las partes': ' en señal de conformidad.',
    'se suspende la audiencia': ' para el día ',
    'se programa continuación': ' de audiencia para el día ',
}


def detect_expediente(text: str) -> List[Dict]:
    """
    Detecta códigos de expediente judicial en el texto.

    Returns:
        Lista de dicts con: {match, start, end, formatted, especialidad}
    """
    results = []

    for pattern in EXPEDIENTE_PATTERNS:
        for match in re.finditer(pattern, text):
            result = {
                'match': match.group(0),
                'start': match.start(),
                'end': match.end(),
                'formatted': format_expediente(match.group(0)),
            }

            # Intentar extraer especialidad
            groups = match.groups()
            if len(groups) >= 6:
                esp_code = groups[5] if len(groups) > 5 else groups[4]
                result['especialidad'] = ESPECIALIDADES.get(esp_code, esp_code)

            results.append(result)

    return results


def format_expediente(exp: str) -> str:
    """Formatea un código de expediente con el formato estándar."""
    # Normalizar a mayúsculas las letras
    formatted = re.sub(r'([a-z]{2})', lambda m: m.group(1).upper(), exp)
    # Asegurar padding de ceros en el número
    formatted = re.sub(r'^(\d{1,4})-', lambda m: m.group(1).zfill(5) + '-', formatted)
    return formatted


def detect_names(text: str) -> List[Dict]:
    """
    Detecta nombres propios que deben capitalizarse.

    Usa heurísticas:
    1. Palabras después de "señor/señora/don/doña"
    2. Palabras que coinciden con nombres/apellidos comunes
    3. Patrones de "APELLIDO, Nombre"

    Returns:
        Lista de dicts con: {word, start, end, type, suggestion}
    """
    results = []
    words = list(re.finditer(r'\b([a-záéíóúñA-ZÁÉÍÓÚÑ]+)\b', text))

    for i, match in enumerate(words):
        word = match.group(1)
        word_lower = word.lower()
        start = match.start()
        end = match.end()

        # Verificar si es nombre o apellido conocido
        is_name = word_lower in NOMBRES_COMUNES
        is_surname = word_lower in APELLIDOS_COMUNES

        if is_name or is_surname:
            # Verificar si debería estar capitalizado
            if not word[0].isupper():
                results.append({
                    'word': word,
                    'start': start,
                    'end': end,
                    'type': 'nombre' if is_name else 'apellido',
                    'suggestion': word.capitalize(),
                })

        # Detectar palabra después de "señor/señora/don/doña"
        if i > 0:
            prev_word = words[i - 1].group(1).lower()
            if prev_word in ['señor', 'señora', 'don', 'doña', 'sr', 'sra']:
                if not word[0].isupper():
                    results.append({
                        'word': word,
                        'start': start,
                        'end': end,
                        'type': 'nombre_titulo',
                        'suggestion': word.capitalize(),
                    })

    return results


def detect_paragraph_structure(text: str) -> Dict:
    """
    Detecta la estructura del texto y sugiere formato de párrafo.

    Detecta:
    - Inicio de declaración (nuevo párrafo)
    - Cambio de hablante
    - Numeración de puntos
    - Citas textuales
    """
    structure = {
        'needs_new_paragraph': False,
        'reason': None,
        'indent_level': 0,
    }

    text_lower = text.strip().lower()

    # Detectar inicio de nueva intervención
    new_paragraph_triggers = [
        'el imputado declara',
        'el agraviado manifiesta',
        'el testigo indica',
        'la defensa técnica',
        'el ministerio público',
        'el señor juez',
        'la señora fiscal',
        'preguntado por',
        'a la pregunta',
        'responde:',
        'declara:',
        'manifiesta:',
    ]

    for trigger in new_paragraph_triggers:
        if text_lower.startswith(trigger):
            structure['needs_new_paragraph'] = True
            structure['reason'] = f'Inicio de intervención: {trigger}'
            break

    # Detectar numeración
    if re.match(r'^\d+[.)]\s', text):
        structure['indent_level'] = 1
        structure['reason'] = 'Punto numerado'

    # Detectar viñetas
    if re.match(r'^[-•]\s', text):
        structure['indent_level'] = 1
        structure['reason'] = 'Viñeta'

    return structure


def capitalize_proper_nouns(text: str) -> str:
    """
    Capitaliza nombres propios detectados en el texto.
    """
    names_detected = detect_names(text)

    # Ordenar de atrás hacia adelante para no afectar índices
    names_detected.sort(key=lambda x: x['start'], reverse=True)

    result = text
    for name in names_detected:
        result = result[:name['start']] + name['suggestion'] + result[name['end']:]

    return result


async def predict_completion(
    context: str,
    speaker_id: Optional[str] = None,
    max_tokens: int = 50,
) -> Optional[str]:
    """
    Predice la continuación del texto usando IA.

    Args:
        context: Texto actual (últimos ~500 caracteres)
        speaker_id: ID del hablante actual
        max_tokens: Máximo de tokens a predecir

    Returns:
        Sugerencia de texto o None
    """
    # Primero intentar completar con frases legales conocidas
    suggestion = _complete_from_phrases(context)
    if suggestion:
        return suggestion

    # Si no hay frase conocida, usar Claude para predicción
    try:
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

        prompt = f"""Eres un digitador judicial experto. Predice SOLO las siguientes 5-15 palabras que probablemente seguirán en esta transcripción judicial.

CONTEXTO (últimas palabras del audio):
{context[-300:]}

REGLAS:
- Predice SOLO la continuación natural de la frase
- No repitas lo que ya está escrito
- Usa terminología judicial peruana
- Si la frase parece completa, responde con cadena vacía
- NO incluyas explicaciones, solo el texto predicho

CONTINUACIÓN:"""

        message = client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=max_tokens,
            temperature=0.3,
            messages=[{"role": "user", "content": prompt}],
        )

        prediction = message.content[0].text.strip()

        # Limpiar predicción
        if prediction.startswith('"') and prediction.endswith('"'):
            prediction = prediction[1:-1]

        # No devolver si es muy corta o parece inválida
        if len(prediction) < 3 or prediction.lower() in ['none', 'null', '']:
            return None

        return prediction

    except Exception as e:
        logger.warning(f"Error en predicción: {e}")
        return None


def _complete_from_phrases(context: str) -> Optional[str]:
    """
    Intenta completar usando frases legales predefinidas.
    """
    context_lower = context.lower().strip()

    for phrase_start, completion in FRASES_LEGALES.items():
        if context_lower.endswith(phrase_start):
            return completion

    return None


class TextPredictionService:
    """
    Servicio principal de predicción de texto.
    """

    def __init__(self):
        self.cache: Dict[str, str] = {}
        self.cache_max_size = 100

    async def get_suggestion(
        self,
        text: str,
        speaker_id: Optional[str] = None,
    ) -> Dict:
        """
        Obtiene sugerencia de autocompletado.

        Returns:
            Dict con:
            - suggestion: Texto sugerido
            - names: Nombres detectados para capitalizar
            - expedientes: Códigos de expediente detectados
            - structure: Información de estructura de párrafo
        """
        # Capitalizar nombres en el texto actual
        text_with_names = capitalize_proper_nouns(text)

        # Detectar expedientes
        expedientes = detect_expediente(text)

        # Detectar estructura
        structure = detect_paragraph_structure(text)

        # Obtener predicción
        suggestion = await predict_completion(text, speaker_id)

        return {
            'suggestion': suggestion,
            'corrected_text': text_with_names if text_with_names != text else None,
            'names': detect_names(text),
            'expedientes': expedientes,
            'structure': structure,
        }


# Singleton
_prediction_service: Optional[TextPredictionService] = None


def get_prediction_service() -> TextPredictionService:
    """Obtiene la instancia singleton del servicio."""
    global _prediction_service
    if _prediction_service is None:
        _prediction_service = TextPredictionService()
    return _prediction_service
