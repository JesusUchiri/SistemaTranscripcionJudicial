"""
cost_tracker — Módulo centralizado para registrar el uso real de APIs.

Se llama DESPUÉS de cada respuesta exitosa de Deepgram o Claude.
Extrae los datos de facturación directamente de la respuesta de la API
y guarda un registro en la tabla `uso_api`.

Tarifas oficiales (actualizadas marzo 2026):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEEPGRAM (Pay-As-You-Go):
  Nova-2 Batch:     $0.0043/min
  Nova-2 Streaming: $0.0059/min
  Diarización:      +$0.0020/min  (add-on en streaming; incluido en batch)

CLAUDE/ANTHROPIC (por millón de tokens):
  Claude 3 Haiku:    input $0.25    output $1.25
  Claude 3.5 Haiku:  input $1.00    output $5.00
  Claude 3.5 Sonnet: input $3.00    output $15.00
  Claude Sonnet 4:   input $3.00    output $15.00
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
import logging
import uuid
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from app.database import async_session

from app.models.uso_api import UsoApi

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════
# TARIFAS OFICIALES — Única fuente de verdad para toda la app
# ═══════════════════════════════════════════════════════════════════

# Deepgram (USD por minuto)
DEEPGRAM_RATES = {
    "batch":     0.0043,   # Pre-recorded
    "streaming": 0.0059,   # Real-time
    "diarize":   0.0020,   # Add-on diarización (streaming)
}

# Claude (USD por token — input y output separados)
CLAUDE_RATES: dict[str, dict[str, float]] = {
    "claude-3-haiku": {
        "input":  0.25 / 1_000_000,   # $0.25 per MTok
        "output": 1.25 / 1_000_000,   # $1.25 per MTok
    },
    "claude-3-5-haiku": {
        "input":  1.00 / 1_000_000,
        "output": 5.00 / 1_000_000,
    },
    "claude-haiku-4-5": {
        "input":  1.00 / 1_000_000,
        "output": 5.00 / 1_000_000,
    },
    "claude-3-5-sonnet": {
        "input":  3.00 / 1_000_000,   # $3.00 per MTok
        "output": 15.00 / 1_000_000,  # $15.00 per MTok
    },
    "claude-sonnet-4": {
        "input":  3.00 / 1_000_000,
        "output": 15.00 / 1_000_000,
    },
}

# Fallback: si no reconocemos el modelo, usar la tarifa más cara (conservador)
CLAUDE_DEFAULT_RATES = {
    "input":  3.00 / 1_000_000,
    "output": 15.00 / 1_000_000,
}


def _get_claude_rates(model: str) -> dict[str, float]:
    """Busca las tarifas del modelo Claude por coincidencia parcial."""
    for key, rates in CLAUDE_RATES.items():
        if key in model:
            return rates
    return CLAUDE_DEFAULT_RATES


# ═══════════════════════════════════════════════════════════════════
# FUNCIONES PÚBLICAS — Llamar después de cada respuesta API
# ═══════════════════════════════════════════════════════════════════

def calcular_costo_deepgram(
    duracion_segundos: float,
    modo: str = "streaming",
    diarize: bool = True,
) -> float:
    """
    Calcula el costo real de Deepgram a partir de la duración.

    Args:
        duracion_segundos: Duración del audio en segundos (de la respuesta API)
        modo: "streaming" o "batch"
        diarize: Si se usó diarización (True por defecto)

    Returns:
        Costo en USD
    """
    minutos = duracion_segundos / 60
    rate = DEEPGRAM_RATES.get(modo, DEEPGRAM_RATES["streaming"])

    costo = minutos * rate
    if diarize and modo == "streaming":
        costo += minutos * DEEPGRAM_RATES["diarize"]

    return costo


def calcular_costo_claude(
    input_tokens: int,
    output_tokens: int,
    modelo: str,
) -> float:
    """
    Calcula el costo real de Claude a partir de los tokens de la respuesta.

    Args:
        input_tokens: message.usage.input_tokens
        output_tokens: message.usage.output_tokens
        modelo: Nombre del modelo (ej: "claude-3-5-sonnet-20241022")

    Returns:
        Costo en USD
    """
    rates = _get_claude_rates(modelo)
    return (input_tokens * rates["input"]) + (output_tokens * rates["output"])


async def registrar_uso_deepgram(
    db: Optional[AsyncSession] = None,
    *,
    servicio: str,
    modelo: str,
    duracion_segundos: float,
    modo: str = "streaming",
    diarize: bool = True,
    audiencia_id: Optional[uuid.UUID] = None,
    usuario_id: Optional[uuid.UUID] = None,
) -> UsoApi:
    """
    Registra una llamada a Deepgram con su costo real.

    Args:
        db: Sesión de BD (o None para crear transiente)
        servicio: "deepgram_streaming" o "deepgram_batch"
        modelo: Ej: "nova-2"
        duracion_segundos: Del metadata de la respuesta API
        modo: "streaming" o "batch"
        diarize: Si se usó diarización
        audiencia_id: UUID de la audiencia
        usuario_id: UUID del usuario
    """
    costo = calcular_costo_deepgram(duracion_segundos, modo, diarize)

    registro = UsoApi(
        audiencia_id=audiencia_id,
        usuario_id=usuario_id,
        servicio=servicio,
        modelo=modelo,
        duracion_segundos=duracion_segundos,
        costo_usd=costo,
    )

    if db:
        db.add(registro)
        # Se asume que el que provee la db hará el commit
    else:
        # Modo fallback para llamadas background
        async with async_session() as session:
            session.add(registro)
            await session.commit()

    logger.info(
        f"[COSTO] {servicio}: {duracion_segundos:.1f}s ({duracion_segundos/60:.2f}min) "
        f"→ ${costo:.6f} USD [{modelo}]"
    )
    return registro


async def registrar_uso_claude(
    db: Optional[AsyncSession] = None,
    *,
    servicio: str,
    modelo: str,
    input_tokens: int,
    output_tokens: int,
    audiencia_id: Optional[uuid.UUID] = None,
    usuario_id: Optional[uuid.UUID] = None,
) -> UsoApi:
    """
    Registra una llamada a Claude con su costo real.

    Args:
        db: Sesión de BD (o None para crear transiente)
        servicio: Ej: "claude_acta", "claude_enhancement", etc.
        modelo: Ej: "claude-3-5-sonnet-20241022"
        input_tokens: De message.usage.input_tokens
        output_tokens: De message.usage.output_tokens
        audiencia_id: UUID de la audiencia
        usuario_id: UUID del usuario
    """
    costo = calcular_costo_claude(input_tokens, output_tokens, modelo)

    logger.info(
        f"[COSTO] Creando registro: servicio={servicio}, modelo={modelo}, "
        f"in={input_tokens}, out={output_tokens}, costo=${costo:.6f}, "
        f"audiencia_id={audiencia_id}, usuario_id={usuario_id}"
    )

    registro = UsoApi(
        audiencia_id=audiencia_id,
        usuario_id=usuario_id,
        servicio=servicio,
        modelo=modelo,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        costo_usd=costo,
    )

    if db:
        db.add(registro)
    else:
        try:
            async with async_session() as session:
                session.add(registro)
                await session.commit()
                logger.info(f"[COSTO] ✅ Registro persistido (audiencia_id={audiencia_id})")
        except Exception as e:
            logger.error(f"[COSTO] ❌ Error persistiendo registro uso_api: {e}", exc_info=True)

    logger.info(
        f"[COSTO] {servicio}: {input_tokens} in + {output_tokens} out = "
        f"{input_tokens + output_tokens} tokens → ${costo:.6f} USD [{modelo}]"
    )
    return registro
