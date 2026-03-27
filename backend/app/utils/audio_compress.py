"""
Utilidades de compresión y optimización de audio para JudiScribe.

Dos funciones principales:

1. optimize_for_storage(input_path) → (output_path, was_converted)
   Convierte el archivo original a FLAC optimizado para almacenamiento:
   - WAV/AIFF → FLAC (lossless, 40–60% más pequeño)
   - Vídeo (MP4, MOV, WebM) → extrae audio como FLAC
   - MP3/AAC/OGG/FLAC ya comprimidos → se mantienen sin reencoding
   El original pesado se puede eliminar después de llamar esta función.

2. compress_for_transcription(input_path) → (output_path, was_compressed)
   Convierte a MP3 16kHz mono 64kbps para enviar a Deepgram.
   Crea un archivo temporal que debe eliminarse después de transcribir.

Referencia de tamaños:
  WAV 44kHz estéreo 1h  (~600MB) → FLAC 22kHz  → ~80MB  (storage)
                                  → MP3 16kHz   → ~29MB  (Deepgram)
  WAV 44kHz estéreo 5h  (~3GB)   → FLAC 22kHz  → ~400MB
                                  → MP3 16kHz   → ~145MB
"""
import asyncio
import logging
import os
import shutil

logger = logging.getLogger(__name__)

# Umbral: solo comprimir para Deepgram si el archivo supera 10MB
_COMPRESS_THRESHOLD_BYTES = 10 * 1024 * 1024

# Extensiones que ya están comprimidas — no reencoder para storage
_ALREADY_COMPRESSED_EXTS = {".mp3", ".aac", ".m4a", ".ogg", ".opus", ".flac"}

# Extensiones de vídeo — extraer solo el audio
_VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".wmv"}


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


# ─────────────────────────────────────────────────────────────────────────────
# 1. optimize_for_storage
# ─────────────────────────────────────────────────────────────────────────────

async def optimize_for_storage(input_path: str) -> tuple[str, bool]:
    """
    Convierte el archivo a FLAC optimizado para almacenamiento permanente.

    Estrategia por formato de entrada:
    - WAV / AIFF  → FLAC a 22050 Hz (lossless, 40–60% más pequeño)
    - MP4 / MOV   → extrae audio como FLAC (elimina datos de vídeo)
    - WebM vídeo  → ídem
    - MP3 / AAC / OGG / FLAC  → se devuelve el original sin tocar
      (reencoder audio ya comprimido degrada calidad sin ganar tamaño)

    Returns:
        (output_path, was_converted)
        Si was_converted=True, el llamador debe eliminar input_path.
    """
    if not ffmpeg_available():
        logger.warning("FFmpeg no disponible — no se puede optimizar para storage")
        return input_path, False

    ext = os.path.splitext(input_path)[1].lower()

    # Formatos ya comprimidos: no reencoder
    if ext in _ALREADY_COMPRESSED_EXTS:
        logger.info(f"Formato {ext} ya comprimido — manteniendo original para storage")
        return input_path, False

    base = os.path.splitext(input_path)[0]
    output_path = f"{base}_opt.flac"

    # FLAC a 22050 Hz: lossless para voz, ~75% más pequeño que WAV 44kHz
    # Para vídeo: -vn descarta el stream de vídeo y extrae solo el audio
    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-vn",                    # descartar vídeo si es contenedor mixto
        "-ar", "22050",           # 22kHz — calidad suficiente para voz judicial
        "-compression_level", "8",  # máxima compresión FLAC (lossless siempre)
        output_path,
    ]

    logger.info(
        f"Optimizando para storage: {os.path.getsize(input_path)/1024/1024:.1f}MB → FLAC 22kHz"
    )

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=600)

        if proc.returncode != 0:
            logger.error(
                f"FFmpeg optimize_for_storage falló (código {proc.returncode}): "
                f"{stderr.decode()[-500:]}"
            )
            if os.path.exists(output_path):
                os.unlink(output_path)
            return input_path, False

        orig_mb = os.path.getsize(input_path) / 1024 / 1024
        opt_mb = os.path.getsize(output_path) / 1024 / 1024
        ratio = orig_mb / opt_mb if opt_mb > 0 else 0
        logger.info(
            f"Storage optimizado: {orig_mb:.1f}MB → {opt_mb:.1f}MB "
            f"({ratio:.1f}x reducción)"
        )
        return output_path, True

    except asyncio.TimeoutError:
        logger.error("FFmpeg timeout en optimize_for_storage")
        if os.path.exists(output_path):
            os.unlink(output_path)
        return input_path, False
    except Exception as e:
        logger.error(f"Error en optimize_for_storage: {e}")
        if os.path.exists(output_path):
            os.unlink(output_path)
        return input_path, False


# ─────────────────────────────────────────────────────────────────────────────
# 2. compress_for_transcription
# ─────────────────────────────────────────────────────────────────────────────

async def compress_for_transcription(input_path: str) -> tuple[str, bool]:
    """
    Comprime el archivo a MP3 16kHz mono 64kbps para enviar a Deepgram.

    Crea un archivo temporal (sufijo _compressed.mp3).
    El llamador DEBE eliminarlo después de transcribir.

    Solo comprime si el archivo supera 10MB.
    """
    file_size = os.path.getsize(input_path)

    if file_size < _COMPRESS_THRESHOLD_BYTES:
        logger.info(f"Audio pequeño ({file_size/1024/1024:.1f}MB) — sin compresión para Deepgram")
        return input_path, False

    if not ffmpeg_available():
        logger.warning(
            f"FFmpeg no disponible — usando archivo original ({file_size/1024/1024:.1f}MB). "
            "Instala FFmpeg para compresión automática."
        )
        return input_path, False

    base, _ = os.path.splitext(input_path)
    compressed_path = f"{base}_compressed.mp3"

    logger.info(
        f"Comprimiendo para Deepgram: {file_size/1024/1024:.1f}MB → MP3 16kHz mono 64kbps"
    )

    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-vn",
        "-ar", "16000",
        "-ac", "1",
        "-b:a", "64k",
        "-f", "mp3",
        compressed_path,
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=600)

        if proc.returncode != 0:
            logger.error(
                f"FFmpeg compress_for_transcription falló (código {proc.returncode}): "
                f"{stderr.decode()[-500:]}"
            )
            return input_path, False

        compressed_size = os.path.getsize(compressed_path)
        ratio = file_size / compressed_size if compressed_size > 0 else 0
        logger.info(
            f"Compresión Deepgram: {file_size/1024/1024:.1f}MB → "
            f"{compressed_size/1024/1024:.1f}MB ({ratio:.1f}x reducción)"
        )
        return compressed_path, True

    except asyncio.TimeoutError:
        logger.error("FFmpeg timeout en compress_for_transcription")
        if os.path.exists(compressed_path):
            os.unlink(compressed_path)
        return input_path, False
    except Exception as e:
        logger.error(f"Error en compress_for_transcription: {e}")
        if os.path.exists(compressed_path):
            os.unlink(compressed_path)
        return input_path, False
