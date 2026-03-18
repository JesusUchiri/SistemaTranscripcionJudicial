"""
Utilidad de compresión de audio para transcripción.

Convierte cualquier audio a MP3 16kHz mono 64kbps antes de enviarlo a Deepgram.
Esto reduce drásticamente el tamaño sin perder nada de calidad para speech-to-text:
  - WAV 44kHz estéreo 1h  (~600MB) → MP3 16kHz mono 64kbps → ~29MB  (20x)
  - WAV 44kHz estéreo 5h  (~3GB)   → ~145MB
  - MP3 320kbps 1h        (~140MB) → ~29MB  (5x)

Solo se comprime si FFmpeg está disponible. Si no, se usa el archivo original.
"""
import asyncio
import logging
import os
import shutil
import subprocess
import tempfile

logger = logging.getLogger(__name__)

# Comprimir solo si el archivo supera este umbral (10MB).
# Archivos más pequeños ya son ligeros y no vale la pena el overhead de conversión.
COMPRESS_THRESHOLD_BYTES = 10 * 1024 * 1024  # 10MB

# Parámetros de compresión optimizados para speech-to-text:
# - ar 16000: 16kHz — suficiente para voz, mismo que usa Deepgram internamente
# - ac 1: mono — voz es mono, reducción adicional 2x
# - b:a 64k: 64kbps — calidad MP3 más que suficiente para habla
FFMPEG_ARGS = [
    "-ar", "16000",   # sample rate 16kHz
    "-ac", "1",       # mono
    "-b:a", "64k",    # bitrate 64kbps
    "-f", "mp3",      # formato MP3
]


def ffmpeg_available() -> bool:
    """Comprueba si FFmpeg está instalado en el sistema."""
    return shutil.which("ffmpeg") is not None


async def compress_for_transcription(input_path: str) -> tuple[str, bool]:
    """
    Comprime el archivo de audio para transcripción.

    Returns:
        (output_path, was_compressed):
        - output_path: ruta al archivo a usar (comprimido o el original si no aplica)
        - was_compressed: True si se creó un archivo comprimido nuevo
    """
    file_size = os.path.getsize(input_path)

    # No comprimir archivos pequeños
    if file_size < COMPRESS_THRESHOLD_BYTES:
        logger.info(f"Audio pequeño ({file_size/1024/1024:.1f}MB) — sin compresión")
        return input_path, False

    if not ffmpeg_available():
        logger.warning(
            f"FFmpeg no disponible — usando archivo original ({file_size/1024/1024:.1f}MB). "
            "Instala FFmpeg para compresión automática."
        )
        return input_path, False

    # Generar ruta del archivo comprimido
    base, _ = os.path.splitext(input_path)
    compressed_path = f"{base}_compressed.mp3"

    logger.info(
        f"Comprimiendo audio: {file_size/1024/1024:.1f}MB → MP3 16kHz mono 64kbps "
        f"(estimado: ~{file_size/1024/1024/20:.1f}MB)"
    )

    cmd = [
        "ffmpeg", "-y",          # sobreescribir si existe
        "-i", input_path,        # archivo de entrada
        *FFMPEG_ARGS,
        compressed_path,
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=600)  # 10 min máx

        if proc.returncode != 0:
            logger.error(f"FFmpeg falló (código {proc.returncode}): {stderr.decode()[-500:]}")
            return input_path, False

        compressed_size = os.path.getsize(compressed_path)
        ratio = file_size / compressed_size
        logger.info(
            f"Compresión completada: {file_size/1024/1024:.1f}MB → "
            f"{compressed_size/1024/1024:.1f}MB ({ratio:.1f}x reducción)"
        )
        return compressed_path, True

    except asyncio.TimeoutError:
        logger.error("FFmpeg timeout (>10min) — usando archivo original")
        if os.path.exists(compressed_path):
            os.unlink(compressed_path)
        return input_path, False
    except Exception as e:
        logger.error(f"Error en compresión FFmpeg: {e}")
        if os.path.exists(compressed_path):
            os.unlink(compressed_path)
        return input_path, False
