"""
Servicio de transcripción batch con Deepgram Nova-3.
Procesa archivos de audio completos (pre-grabados) usando la API pre-recorded.

Diarización: diarize=true identifica distintas voces (SPEAKER_00, SPEAKER_01, ...).
"""
import logging
import os
from collections import Counter
from typing import List, Dict, Any, Set

from app.config import settings

logger = logging.getLogger(__name__)


from deepgram import AsyncDeepgramClient

class DeepgramBatchService:
    """
    Transcripción batch de archivos de audio con Deepgram Nova-3 pre-recorded API y deepgram-sdk.

    Responsabilidades:
    - Subir audio a Deepgram usando SDK oficial
    - Obtener transcripción completa con diarización
    - Formatear resultados en segmentos
    """

    def __init__(self):
        self.api_key: str = settings.DEEPGRAM_API_KEY
        self.client = AsyncDeepgramClient(api_key=self.api_key)

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

    async def transcribe_file(self, audio_source, mime_type: str = "audio/wav") -> dict:
        """
        Transcribe an audio file using Deepgram pre-recorded API via SDK.
        audio_source: file path (str) or bytes.

        Returns:
            dict with keys:
            - segments: list of transcript segments
            - duration: total audio duration in seconds
            - speakers_count: number of unique speakers detected
        """
        if isinstance(audio_source, str):
            # File path — read from disk
            file_size = os.path.getsize(audio_source)
            logger.info(f"Sending audio to Deepgram batch API (file={audio_source}, {file_size/1024/1024:.1f}MB, {mime_type})")
            with open(audio_source, "rb") as f:
                audio_bytes = f.read()
        else:
            audio_bytes = audio_source
            logger.info(f"Sending audio to Deepgram batch API ({len(audio_bytes)/1024/1024:.1f}MB, {mime_type})")

        response = await self.client.listen.v1.media.transcribe_file(
            request=audio_bytes,
            model="nova-2",
            language="es-419",
            smart_format=True,
            diarize=True,
            punctuate=True,
            numerals=True,
            filler_words=False,
            paragraphs=True,
            utterances=True,
            detect_language=False,
        )

        
        # El SDK de Deepgram devuelve un objeto tipo Pydantic (ListenV1Response) o dict 
        # Convertimos a dict si tiene to_dict para reutilizar _parse_results
        result = response.to_dict() if hasattr(response, "to_dict") else response.model_dump() if hasattr(response, "model_dump") else response

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

        segments: List[Dict[str, Any]] = []
        all_speakers: Set[str] = set()
        orden: int = 0

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
