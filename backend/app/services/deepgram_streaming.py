"""
Servicio de streaming con Deepgram Nova-3.
Mantiene una conexión WebSocket persistente con Deepgram por cada audiencia activa.

Diarización: diarize=true identifica distintas voces (SPEAKER_00, SPEAKER_01, ...).
Nova-3 soporta diarización en streaming; cada palabra trae speaker (int).
"""
import asyncio
import logging
from collections import Counter
from typing import Callable, Optional, List, Dict, Any, Awaitable
import itertools

from deepgram import AsyncDeepgramClient
from deepgram.core.events import EventType

from app.config import settings
from app.data.legal_keyterms import get_keyterms

logger = logging.getLogger(__name__)


class DeepgramStreamingService:
    """
    Manages a persistent WebSocket connection to Deepgram Nova-3 using the official SDK.

    Responsabilidades:
    - Conexión/desconexión con Deepgram
    - Envío de audio chunks
    - Recepción de resultados y paso al callback

    NO hace buffering ni mejoramiento - eso lo maneja transcription_ws.py
    """

    def __init__(
        self,
        on_transcript: Callable[[Dict[str, Any]], Awaitable[None]],
        on_utterance_end: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None,
        on_speech_started: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None,
        keyterms: Optional[List[str]] = None,
    ):
        self.on_transcript = on_transcript
        self.on_utterance_end = on_utterance_end
        self.on_speech_started = on_speech_started
        self.keyterms: List[str] = keyterms if keyterms is not None else get_keyterms(100)
        
        self._client: AsyncDeepgramClient = AsyncDeepgramClient(settings.DEEPGRAM_API_KEY)
        self._connection: Any = None
        self._running: bool = False

    @staticmethod
    def _speaker_dominante(words: list) -> str:
        if not words:
            return "SPEAKER_00"
        speakers = [w.get("speaker", 0) for w in words]
        dominante = Counter(speakers).most_common(1)[0][0]
        return f"SPEAKER_{dominante:02d}"

    async def connect(self) -> None:
        """Establish async connection to Deepgram using the Python SDK."""
        keyterms_list = list(itertools.islice(self.keyterms, 100))
        
        try:
            # Usar API V1 listen connect
            self._connection = await self._client.listen.v1.connect(
                model=settings.DEEPGRAM_MODEL,
                language="es-419",
                smart_format="true",
                diarize="true",
                encoding="linear16",
                sample_rate="16000",
                channels="1",
                interim_results="true",
                utterance_end_ms="3500",
                vad_events="true",
                punctuate="true",
                numerals="true",
                filler_words="false",
                endpointing="500",
                paragraphs="true",
                eot_threshold="0.7",                 
                eot_timeout_ms="5000",               
                eager_eot_threshold="0.3",
                keyterm=keyterms_list
            ).__anext__() # Connect is an AsyncIterator so we must call __anext__ to get the websocket client

            # Mapping SDK events to our internal methods
            self._connection.on(EventType.MESSAGE, self._on_message)
            self._connection.on(EventType.CLOSE, self._on_close)
            self._connection.on(EventType.ERROR, self._on_error)
            
            # Initiate background receive loop from SDK
            asyncio.create_task(self._connection.start_listening())
            
            self._running = True
            logger.info("Connected to Deepgram Nova-3 via SDK")
            
        except Exception as e:
            logger.error(f"Failed to connect to Deepgram via SDK: {e}")
            raise

    # Callbacks del SDK
    async def _on_message(self, message: Any) -> None:
        """Handles MESSAGE event from SDK."""
        if not message:
            return

        # Pydantic Objects in SDK V6 have model_dump/dict based approaches, but they can be passed differently 
        data_dict = message.model_dump() if hasattr(message, "model_dump") else message.to_dict() if hasattr(message, "to_dict") else message if isinstance(message, dict) else message.__dict__ if hasattr(message, '__dict__') else None
        
        if data_dict is None:
            return
            
        msg_type = data_dict.get("type", "")

        if msg_type == "Results" or data_dict.get("channel"):
            await self._handle_results(data_dict)
        elif msg_type == "UtteranceEnd":
            if self.on_utterance_end:
                await self.on_utterance_end({"type": "UtteranceEnd"})
        elif msg_type == "SpeechStarted":
            if self.on_speech_started:
                await self.on_speech_started({"type": "SpeechStarted"})
        

    async def _on_close(self, *args, **kwargs) -> None:
        logger.info("Deepgram connection closed via SDK event")
        self._running = False

    async def _on_error(self, error: Any) -> None:
        logger.error(f"Deepgram SDK Error: {error}")

    async def send_audio(self, audio_data: bytes) -> None:
        """Send raw PCM audio chunk to Deepgram SDK."""
        if self._connection and self._running:
            try:
                await self._connection.send_media(audio_data)
            except Exception as e:
                logger.error(f"Error sending audio to Deepgram SDK: {e}")

    async def _handle_results(self, data: dict) -> None:
        """
        Parse Deepgram results and pass to callback.
        """
        channel = data.get("channel", {})
        alternatives_list = channel.get("alternatives", [])
        if not alternatives_list:
            return

        best = alternatives_list[0]
        transcript = best.get("transcript", "").strip()
        if not transcript:
            return

        is_final = data.get("is_final", False)
        words = best.get("words", [])

        speaker = self._speaker_dominante(words)

        processed_words = []
        for w in words:
            word_confidence = w.get("confidence", 1.0)
            word_alternatives = []

            if word_confidence < 0.85:
                for alt_option in alternatives_list[1:4]:
                    alt_words = alt_option.get("words", [])
                    matching_word = None
                    for aw in alt_words:
                        if abs(aw.get("start", 0) - w.get("start", 0)) < 0.1:
                            matching_word = aw
                            break
                    if matching_word and matching_word.get("word", "").lower() != w.get("word", "").lower():
                        word_alternatives.append({
                            "word": matching_word.get("word", ""),
                            "confidence": matching_word.get("confidence", 0.0)
                        })

            processed_words.append({
                "word": w.get("word", ""),
                "start": w.get("start", 0.0),
                "end": w.get("end", 0.0),
                "confidence": word_confidence,
                "alternatives": word_alternatives,
            })

        await self.on_transcript({
            "type": "transcript",
            "is_final": is_final,
            "speaker": speaker,
            "text": transcript,
            "confidence": best.get("confidence", 1.0),
            "start": words[0].get("start", 0.0) if words else 0.0,
            "end": words[-1].get("end", 0.0) if words else 0.0,
            "words": processed_words,
        })

    async def close(self) -> None:
        """Close the Deepgram connection via SDK."""
        self._running = False
        if self._connection:
            try:
                await self._connection.send_close_stream()
            except Exception as e:
                pass
            self._connection = None
        
        logger.info("Deepgram connection closed by client")
    
    @property
    def is_connected(self) -> bool:
        return self._running and self._connection is not None
