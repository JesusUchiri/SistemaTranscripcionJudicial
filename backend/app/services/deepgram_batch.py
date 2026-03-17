"""
Servicio de transcripción batch con Deepgram Nova-3.
Procesa archivos de audio completos (pre-grabados) usando la API pre-recorded.

Diarización: diarize=true identifica distintas voces (SPEAKER_00, SPEAKER_01, ...).
"""
import logging
from collections import Counter
from typing import Optional

import httpx

from app.config import settings
from app.data.legal_keyterms import get_keyterms

logger = logging.getLogger(__name__)


class DeepgramBatchService:
    """
    Transcripción batch de archivos de audio con Deepgram Nova-3 pre-recorded API.

    Responsabilidades:
    - Subir audio a Deepgram
    - Obtener transcripción completa con diarización
    - Formatear resultados en segmentos
    """

    def __init__(self, keyterms: Optional[list[str]] = None):
        self.keyterms = keyterms or get_keyterms(100)
        self.api_key = settings.DEEPGRAM_API_KEY

    def _build_url(self) -> str:
        """Build the Deepgram pre-recorded API URL with optimized params."""
        base = "https://api.deepgram.com/v1/listen"
        params = [
            f"model={settings.DEEPGRAM_MODEL}",
            "language=es-419",
            "smart_format=true",
            "diarize=true",
            "punctuate=true",
            "numerals=true",
            "filler_words=false",
            "paragraphs=true",
            "utterances=true",
            "detect_language=false",
        ]
        # Add keyterms (up to 100)
        for term in self.keyterms[:100]:
            params.append(f"keywords={term}")

        return f"{base}?{'&'.join(params)}"

    @staticmethod
    def _speaker_dominante(words: list) -> str:
        """
        Obtiene el speaker más frecuente en la lista de palabras.
        """
        if not words:
            return "SPEAKER_00"
        speakers = [w.get("speaker", 0) for w in words]
        dominante = Counter(speakers).most_common(1)[0][0]
        return f"SPEAKER_{dominante:02d}"

    async def transcribe_file(self, audio_bytes: bytes, mime_type: str = "audio/wav") -> dict:
        """
        Transcribe an audio file using Deepgram pre-recorded API.

        Returns:
            dict with keys:
            - segments: list of transcript segments
            - duration: total audio duration in seconds
            - speakers_count: number of unique speakers detected
        """
        url = self._build_url()
        headers = {
            "Authorization": f"Token {self.api_key}",
            "Content-Type": mime_type,
        }

        logger.info(f"Sending audio to Deepgram batch API ({len(audio_bytes)} bytes, {mime_type})")

        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.post(url, headers=headers, content=audio_bytes)
            response.raise_for_status()
            result = response.json()

        return self._parse_results(result)

    def _parse_results(self, data: dict) -> dict:
        """Parse Deepgram pre-recorded response into structured segments."""
        results = data.get("results", {})
        channels = results.get("channels", [])

        if not channels:
            return {"segments": [], "duration": 0.0, "speakers_count": 0}

        channel = channels[0]
        alternatives = channel.get("alternatives", [])

        if not alternatives:
            return {"segments": [], "duration": 0.0, "speakers_count": 0}

        best = alternatives[0]
        paragraphs_data = best.get("paragraphs", {})
        paragraphs = paragraphs_data.get("paragraphs", [])

        # Use utterances if paragraphs not available
        utterances = results.get("utterances", [])

        segments = []
        all_speakers = set()
        orden = 0

        if paragraphs:
            # Use paragraphs for better structuring
            for paragraph in paragraphs:
                sentences = paragraph.get("sentences", [])
                speaker_id = paragraph.get("speaker", 0)
                speaker = f"SPEAKER_{speaker_id:02d}"
                all_speakers.add(speaker)

                for sentence in sentences:
                    text = sentence.get("text", "").strip()
                    if not text:
                        continue

                    segments.append({
                        "speaker_id": speaker,
                        "texto_ia": text,
                        "timestamp_inicio": sentence.get("start", 0.0),
                        "timestamp_fin": sentence.get("end", 0.0),
                        "confianza": 0.95,  # Pre-recorded usually has high confidence
                        "orden": orden,
                        "fuente": "batch",
                    })
                    orden += 1

        elif utterances:
            # Fallback to utterances
            for utt in utterances:
                text = utt.get("transcript", "").strip()
                if not text:
                    continue

                speaker_id = utt.get("speaker", 0)
                speaker = f"SPEAKER_{speaker_id:02d}"
                all_speakers.add(speaker)

                segments.append({
                    "speaker_id": speaker,
                    "texto_ia": text,
                    "timestamp_inicio": utt.get("start", 0.0),
                    "timestamp_fin": utt.get("end", 0.0),
                    "confianza": utt.get("confidence", 0.95),
                    "orden": orden,
                    "fuente": "batch",
                })
                orden += 1
        else:
            # Last resort: use the full transcript as a single segment
            words = best.get("words", [])
            transcript = best.get("transcript", "").strip()

            if transcript and words:
                speaker = self._speaker_dominante(words)
                all_speakers.add(speaker)

                segments.append({
                    "speaker_id": speaker,
                    "texto_ia": transcript,
                    "timestamp_inicio": words[0].get("start", 0.0),
                    "timestamp_fin": words[-1].get("end", 0.0),
                    "confianza": best.get("confidence", 0.95),
                    "orden": 0,
                    "fuente": "batch",
                })

        # Get audio duration from metadata
        metadata = data.get("metadata", {})
        duration = metadata.get("duration", 0.0)

        # Sprint 7: Recuperar todas las palabras con timestamps para alinear con segmentos de streaming
        all_words = best.get("words", [])

        return {
            "segments": segments,
            "duration": duration,
            "speakers_count": len(all_speakers),
            "words": all_words,
        }
