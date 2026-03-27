"""
Utilidades de edición de audio para pre-procesamiento antes de transcripción.

Permite:
- Recortar regiones específicas del audio (atrim + aconcat con FFmpeg)
- Aplicar filtros de mejora de calidad (ruido, normalización, volumen)
- Obtener la duración exacta del audio (ffprobe)

Usa async subprocess igual que audio_compress.py.
"""
import asyncio
import logging
import os
import shutil

logger = logging.getLogger(__name__)


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


async def get_audio_duration(audio_path: str) -> float | None:
    """Obtiene la duración exacta del audio en segundos usando ffprobe."""
    if not shutil.which("ffprobe"):
        return None
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            audio_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
        if proc.returncode == 0:
            val = stdout.decode().strip()
            return float(val) if val else None
    except Exception as e:
        logger.warning(f"ffprobe error al obtener duración: {e}")
    return None


async def trim_regions(input_path: str, regions: list[dict]) -> tuple[str, bool]:
    """
    Recorta el audio a las regiones seleccionadas y las concatena en orden.

    Args:
        input_path: ruta al archivo de audio
        regions: lista de {"start": float, "end": float} en segundos

    Returns:
        (output_path, was_trimmed) — si regions está vacío, devuelve el original.
    """
    if not regions:
        return input_path, False

    if not ffmpeg_available():
        logger.warning("FFmpeg no disponible — no se puede recortar audio")
        return input_path, False

    base, ext = os.path.splitext(input_path)
    output_path = f"{base}_trimmed{ext}"

    regions_sorted = sorted(regions, key=lambda r: float(r["start"]))
    n = len(regions_sorted)

    # Filtergraph: un atrim por región + aconcat al final
    filter_parts = []
    for i, region in enumerate(regions_sorted):
        start = max(0.0, float(region["start"]))
        end = float(region["end"])
        filter_parts.append(
            f"[0:a]atrim=start={start}:end={end},asetpts=PTS-STARTPTS[a{i}]"
        )
    concat_inputs = "".join(f"[a{i}]" for i in range(n))
    filter_parts.append(f"{concat_inputs}aconcat=n={n}:v=0:a=1[out]")
    filtergraph = ";".join(filter_parts)

    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-filter_complex", filtergraph,
        "-map", "[out]",
        output_path,
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)  # 5 min

        if proc.returncode != 0:
            logger.error(
                f"FFmpeg trim falló (código {proc.returncode}): {stderr.decode()[-500:]}"
            )
            if os.path.exists(output_path):
                os.unlink(output_path)
            return input_path, False

        logger.info(f"Audio recortado a {n} región(es): {output_path}")
        return output_path, True

    except asyncio.TimeoutError:
        logger.error("FFmpeg timeout en trim_regions")
        if os.path.exists(output_path):
            os.unlink(output_path)
        return input_path, False
    except Exception as e:
        logger.error(f"Error en trim_regions: {e}")
        if os.path.exists(output_path):
            os.unlink(output_path)
        return input_path, False


async def apply_filters(input_path: str, filters: dict) -> tuple[str, bool]:
    """
    Aplica filtros de mejora de calidad al audio.

    Args:
        input_path: ruta al archivo de audio
        filters: {
            noise_reduction (bool): reducción de ruido con afftdn
            normalize (bool): normalización EBU R128 con loudnorm
            volume (float): factor de volumen — 1.0 sin cambio
            highpass (bool): filtro pasa-altos 80Hz para eliminar zumbidos
        }

    Returns:
        (output_path, was_filtered)
    """
    if not ffmpeg_available():
        logger.warning("FFmpeg no disponible — no se pueden aplicar filtros")
        return input_path, False

    noise_reduction = bool(filters.get("noise_reduction", False))
    normalize = bool(filters.get("normalize", False))
    volume = float(filters.get("volume", 1.0))
    highpass = bool(filters.get("highpass", False))

    if not noise_reduction and not normalize and volume == 1.0 and not highpass:
        return input_path, False

    base, ext = os.path.splitext(input_path)
    output_path = f"{base}_filtered{ext}"

    # Cadena de filtros (el orden importa para mejor calidad)
    chain: list[str] = []
    if highpass:
        chain.append("highpass=f=80")
    if noise_reduction:
        chain.append("afftdn=nr=10:nf=-25")
    if volume != 1.0:
        chain.append(f"volume={volume:.3f}")
    if normalize:
        chain.append("loudnorm=I=-16:TP=-1.5:LRA=11")

    af_filter = ",".join(chain)

    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-af", af_filter,
        output_path,
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)

        if proc.returncode != 0:
            logger.error(
                f"FFmpeg filters falló (código {proc.returncode}): {stderr.decode()[-500:]}"
            )
            if os.path.exists(output_path):
                os.unlink(output_path)
            return input_path, False

        logger.info(f"Filtros aplicados [{af_filter}]: {output_path}")
        return output_path, True

    except asyncio.TimeoutError:
        logger.error("FFmpeg timeout en apply_filters")
        if os.path.exists(output_path):
            os.unlink(output_path)
        return input_path, False
    except Exception as e:
        logger.error(f"Error en apply_filters: {e}")
        if os.path.exists(output_path):
            os.unlink(output_path)
        return input_path, False
