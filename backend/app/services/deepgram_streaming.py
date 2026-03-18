"""
Servicio de streaming con Deepgram Nova-2.
Usa el SDK v6 (deepgram-sdk==6.0.1) con nuestro propio loop de escucha.
"""
import asyncio
import json
import logging
from collections import Counter
from typing import Callable, Optional, List, Dict, Any, Awaitable

from deepgram import AsyncDeepgramClient

from app.config import settings

logger = logging.getLogger(__name__)


class DeepgramStreamingService:
    """
    Manages a persistent WebSocket connection to Deepgram Nova-2 using the official SDK.
    Uses recv() directly instead of start_listening() for reliable message handling.
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

        self._client: AsyncDeepgramClient = AsyncDeepgramClient(api_key=settings.DEEPGRAM_API_KEY)
        self._connection_ctx: Any = None
        self._connection: Any = None
        self._running: bool = False
        self._listen_task: Any = None

    @staticmethod
    def _speaker_dominante(words: list) -> str:
        if not words:
            return "SPEAKER_00"
        speakers = [w.get("speaker", 0) for w in words]
        dominante = Counter(speakers).most_common(1)[0][0]
        return f"SPEAKER_{dominante:02d}"

    async def connect(self) -> None:
        """Establish async connection to Deepgram using the Python SDK."""
        try:
            self._connection_ctx = self._client.listen.v1.connect(
                model=settings.DEEPGRAM_MODEL,
                language="es",
                encoding="linear16",
                sample_rate="16000",
                channels="1",
                interim_results="true",
                punctuate="true",
                diarize="true",
                smart_format="true",
                endpointing="300",
                numerals="true",
            )
            self._connection = await self._connection_ctx.__aenter__()
            self._running = True

            # Nuestro propio loop de escucha con manejo de errores completo
            self._listen_task = asyncio.create_task(self._listen_loop())
            self._listen_task.add_done_callback(self._on_listen_task_done)

            logger.info(f"Connected to Deepgram with model: {settings.DEEPGRAM_MODEL}")

        except Exception as e:
            logger.error(f"Failed to connect to Deepgram: {e}", exc_info=True)
            raise

    def _on_listen_task_done(self, task: asyncio.Task) -> None:
        """Called when the listen loop task finishes."""
        if task.cancelled():
            logger.info("Deepgram listen task cancelled")
        elif task.exception():
            logger.error(f"Deepgram listen task failed: {task.exception()}", exc_info=task.exception())
        else:
            logger.info("Deepgram listen task completed normally")
        self._running = False

    async def _listen_loop(self) -> None:
        """
        Our own listening loop — reads raw messages directly from the WebSocket.
        This avoids depending on SDK's start_listening() / construct_type() which can fail silently.
        """
        logger.info("[DG] Listen loop started")
        try:
            # Access the underlying websockets protocol directly
            ws = self._connection._websocket
            async for raw_message in ws:
                if not self._running:
                    break
                try:
                    if isinstance(raw_message, bytes):
                        # Binary message — skip
                        continue
                    data = json.loads(raw_message)
                    await self._dispatch(data)
                except json.JSONDecodeError as e:
                    logger.warning(f"[DG] JSON decode error: {e}, raw: {raw_message[:100]}")
                except Exception as e:
                    logger.error(f"[DG] Error processing message: {e}", exc_info=True)
                    # Continue — don't let one bad message kill the loop
        except Exception as e:
            logger.error(f"[DG] Listen loop error: {e}", exc_info=True)
        finally:
            self._running = False
            logger.info("[DG] Listen loop ended")

    async def _dispatch(self, data: dict) -> None:
        """Route incoming Deepgram messages to the right handler."""
        msg_type = data.get("type", "")
        logger.debug(f"[DG] Received message type='{msg_type}'")

        if msg_type == "Results":
            await self._handle_results(data)
        elif msg_type == "UtteranceEnd":
            if self.on_utterance_end:
                await self.on_utterance_end({"type": "UtteranceEnd"})
        elif msg_type == "SpeechStarted":
            if self.on_speech_started:
                await self.on_speech_started({"type": "SpeechStarted"})
        elif msg_type == "Metadata":
            logger.info(f"[DG] Metadata received: {data}")
        else:
            data_str = str(data)[:200]
            logger.debug(f"[DG] Unknown message type: '{msg_type}', data: {data_str}")

    async def send_audio(self, audio_data: bytes) -> None:
        """Send raw PCM audio chunk to Deepgram SDK."""
        if self._connection and self._running:
            try:
                await self._connection.send_media(audio_data)
            except Exception as e:
                logger.error(f"Error sending audio to Deepgram: {e}")

    async def _handle_results(self, data: dict) -> None:
        """Parse Deepgram Results and call the transcript callback."""
        channel = data.get("channel", {})
        alternatives_list = channel.get("alternatives", [])
        if not alternatives_list:
            return

        best = alternatives_list[0]
        transcript = best.get("transcript", "").strip()
        is_final = data.get("is_final", False)
        logger.info(f"[DIAG] Deepgram result: is_final={is_final}, transcript='{transcript[:80]}'")
        if not transcript:
            return

        words = best.get("words", [])
        speaker = self._speaker_dominante(words)

        processed_words = [
            {
                "word": w.get("word", ""),
                "start": w.get("start", 0.0),
                "end": w.get("end", 0.0),
                "confidence": w.get("confidence", 1.0),
                "alternatives": [],
            }
            for w in words
        ]

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

        if self._listen_task and not self._listen_task.done():
            self._listen_task.cancel()
            try:
                await self._listen_task
            except asyncio.CancelledError:
                pass

        if self._connection:
            try:
                await self._connection.send_close_stream()
            except Exception:
                pass
            self._connection = None

        if self._connection_ctx:
            try:
                await self._connection_ctx.__aexit__(None, None, None)
            except Exception:
                pass
            self._connection_ctx = None

        logger.info("Deepgram connection closed by client")

    @property
    def is_connected(self) -> bool:
        return self._running and self._connection is not None
