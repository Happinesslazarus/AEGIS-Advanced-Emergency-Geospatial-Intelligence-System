"""
Provides real-time voice-to-text transcription for AEGIS incident reports
using a locally-running faster-whisper (CTranslate2 backend) model.

Why local (not API-based)?
  - Emergency responders may have limited or no internet connectivity
  - Audio data from incidents may contain sensitive personal information
  - Response latency must be < 2 seconds for good UX
  - Faster-whisper is 4-6× faster than original Whisper at same accuracy

Pipeline:
  1. Accept audio bytes (WebM/Ogg/WAV) from the WebSocket endpoint
  2. Convert to 16kHz mono WAV in memory using ffmpeg subprocess
  3. Run faster-whisper inference (base.en model by default)
  4. Return {text, confidence, detected_language, duration_s, keywords}
  5. Extract AEGIS-relevant keywords (hazard types, location indicators)

Models available:
  tiny.en   -- 39M params, ~200ms latency;  good for real-time partial results
  base.en   -- 74M params, ~600ms latency;  recommended default
  small.en  -- 244M params, ~1.5s latency;  best accuracy for longer reports
  medium.en -- 769M params, ~5s;            only if GPU available with VRAM > 4GB

Glossary:
  faster-whisper  = re-implementation of OpenAI Whisper using CTranslate2;
                    runs on CPU or GPU; no OpenAI API key required
  CTranslate2     = efficient inference engine for Transformer models;
                    uses INT8/FP16 quantisation for fast CPU inference
  WebM/Ogg        = browser-native audio formats recorded by MediaRecorder API
  VAD             = Voice Activity Detection; filters out silence to avoid
                    wasting compute on empty audio segments
  ffmpeg          = open-source audio/video conversion tool; must be installed
                    separately (apt install ffmpeg / choco install ffmpeg)

 Called by <- app/routers/voice.py (WebSocket ws://.../api/voice/stream)
 <- client/src/hooks/useVoiceInput.ts (browser side)
 Uses <- ~/.cache/huggingface/hub/ (model downloaded on first run)
 Returns to -> multimodal_fusion.py (text field)

Usage (programmatic):
  from app.services.voice_transcription import VoiceTranscriptionService
  svc  = VoiceTranscriptionService(model_size="base.en")
  result = await svc.transcribe(audio_bytes)
  # {"text": "Flooding on the A30", "confidence": 0.93, ...}
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# AEGIS keyword extractor vocabulary
HAZARD_KEYWORDS = {
    "flood":                    ["flood", "flooding", "inundated", "waterlogged", "submerged"],
    "wildfire":                 ["fire", "wildfire", "blaze", "burning", "smoke", "flames"],
    "severe_storm":             ["storm", "gale", "wind", "hurricane", "tornado", "gusts"],
    "heatwave":                 ["heat", "heatwave", "temperature", "sweltering", "hot"],
    "drought":                  ["drought", "dry", "water shortage"],
    "landslide":                ["landslide", "mudslide", "rockfall", "debris"],
    "power_outage":             ["power cut", "blackout", "no electricity", "outage"],
    "infrastructure_damage":    ["road closed", "bridge", "rail", "collapsed", "damage"],
    "water_supply_disruption":  ["water supply", "burst pipe", "no water", "tap"],
    "public_safety_incident":   ["rescue", "evacuation", "missing", "emergency", "casualty"],
    "environmental_hazard":     ["chemical", "spill", "pollution", "toxic"],
}

SEVERITY_KEYWORDS = {
    "critical":   ["critical", "severe", "extreme", "catastrophic", "major", "destroyed"],
    "high":       ["serious", "significant", "considerable", "widespread"],
    "medium":     ["moderate", "some", "limited", "local"],
    "low":        ["minor", "slight", "small"],
}


def extract_keywords(text: str) -> dict[str, Any]:
    """
    Scan transcription text for AEGIS-relevant hazard and severity keywords.

    Returns a dict with:
      detected_hazards     -- ordered list of (hazard, keyword_count)
      primary_hazard       -- most likely incident type
      severity_hint        -- "critical" | "high" | "medium" | "low" | "unknown"
    """
    text_lower = text.lower()
    hazard_hits: dict[str, int] = {}
    for hazard, kws in HAZARD_KEYWORDS.items():
        count = sum(1 for kw in kws if kw in text_lower)
        if count > 0:
            hazard_hits[hazard] = count

    sorted_hazards = sorted(hazard_hits.items(), key=lambda x: x[1], reverse=True)
    primary_hazard = sorted_hazards[0][0] if sorted_hazards else "unknown"

    severity_hint = "unknown"
    for level in ["critical", "high", "medium", "low"]:
        if any(kw in text_lower for kw in SEVERITY_KEYWORDS[level]):
            severity_hint = level
            break

    return {
        "detected_hazards": sorted_hazards,
        "primary_hazard":   primary_hazard,
        "severity_hint":    severity_hint,
    }


def _convert_to_wav16k(audio_bytes: bytes, input_format: str = "webm") -> bytes:
    """
    Convert browser audio (WebM/Ogg/WAV) to 16kHz mono PCM WAV using ffmpeg.

    Raises RuntimeError if ffmpeg is not installed.
    """
    with tempfile.NamedTemporaryFile(suffix=f".{input_format}", delete=False) as f_in:
        f_in.write(audio_bytes)
        in_path = f_in.name

    out_path = in_path.replace(f".{input_format}", "_16k.wav")

    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", in_path,
                "-ar", "16000",    # 16kHz -- Whisper's expected sample rate
                "-ac", "1",        # mono
                "-f", "wav",
                out_path,
            ],
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"ffmpeg failed: {result.stderr.decode()[:300]}\n"
                "Install ffmpeg: apt install ffmpeg / choco install ffmpeg"
            )
        with open(out_path, "rb") as fh:
            wav_bytes = fh.read()
    finally:
        Path(in_path).unlink(missing_ok=True)
        Path(out_path).unlink(missing_ok=True)

    return wav_bytes


class VoiceTranscriptionService:
    """
    Wraps faster-whisper for async voice transcription.

    Thread-safe: the model is loaded once and shared across concurrent
    requests.  Heavy inference is offloaded to a thread pool executor so
    it never blocks the FastAPI event loop.

    Parameters
    model_size : faster-whisper model; "tiny.en", "base.en", "small.en", "medium.en"
    device     : "cpu" or "cuda"; auto-detected if not specified
    compute_type : quantisation type; "int8" (CPU fast), "float16" (GPU)
    """

    def __init__(
        self,
        model_size:   str = "base.en",
        device:       str | None = None,
        compute_type: str | None = None,
    ) -> None:
        self._model_size   = model_size
        self._device       = device or ("cuda" if self._cuda_available() else "cpu")
        self._compute_type = compute_type or ("float16" if self._device == "cuda" else "int8")
        self._model        = None   # lazy-loaded on first transcription request
        self._model_lock   = asyncio.Lock()

    @staticmethod
    def _cuda_available() -> bool:
        try:
            import torch
            return torch.cuda.is_available()
        except ImportError:
            return False

    async def _ensure_model_loaded(self) -> None:
        """Lazy-load the Whisper model (thread-safe)."""
        if self._model is not None:
            return
        async with self._model_lock:
            if self._model is not None:
                return
            logger.info(f"Loading faster-whisper {self._model_size} "
                        f"on {self._device} ({self._compute_type}) ...")
            try:
                from faster_whisper import WhisperModel
                self._model = WhisperModel(
                    self._model_size,
                    device=self._device,
                    compute_type=self._compute_type,
                )
                logger.info("faster-whisper model loaded")
            except ImportError:
                raise ImportError(
                    "faster-whisper not installed.\n"
                    "Run: pip install faster-whisper"
                )

    def _run_inference(self, wav_bytes: bytes) -> dict[str, Any]:
        """
        Synchronous inference -- run in a thread pool executor.
        Writes wav_bytes to a temp file and transcribes.
        """
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(wav_bytes)
            wav_path = f.name

        try:
            segments, info = self._model.transcribe(
                wav_path,
                beam_size=5,
                vad_filter=True,         # suppress silence
                word_timestamps=False,
            )
            # Materialise generator
            all_segs    = list(segments)
            full_text   = " ".join(s.text.strip() for s in all_segs).strip()

 # Average log-probability -> approximate confidence
            if all_segs:
                avg_logprob = sum(s.avg_logprob for s in all_segs) / len(all_segs)
                confidence  = round(min(1.0, max(0.0, (avg_logprob + 0.7) / 0.7)), 3)
            else:
                confidence  = 0.0

            return {
                "text":               full_text,
                "confidence":         confidence,
                "detected_language":  info.language,
                "duration_s":         round(info.duration, 2),
            }
        finally:
            Path(wav_path).unlink(missing_ok=True)

    async def transcribe(
        self,
        audio_bytes:  bytes,
        input_format: str = "webm",
        enrich:       bool = True,
    ) -> dict[str, Any]:
        """
        Transcribe audio bytes and optionally extract AEGIS keywords.

        Parameters
        audio_bytes  : raw bytes from MediaRecorder or uploaded file
        input_format : "webm", "ogg", "wav", "mp4"; auto-converted to 16kHz WAV
        enrich       : if True, appends keyword extraction results to the response

        Returns

        dict with keys: text, confidence, detected_language, duration_s,
                        detected_hazards, primary_hazard, severity_hint
        """
        await self._ensure_model_loaded()

        # Convert to 16kHz mono WAV in a thread pool (cpu-bound + subprocess)
        loop = asyncio.get_event_loop()
        try:
            wav_bytes = await loop.run_in_executor(
                None, _convert_to_wav16k, audio_bytes, input_format
            )
        except RuntimeError as exc:
            logger.error(f"Audio conversion failed: {exc}")
            return {
                "text":        "",
                "confidence":  0.0,
                "error":       str(exc),
                "duration_s":  0.0,
            }

        # Run inference in thread pool (blocking)
        result = await loop.run_in_executor(None, self._run_inference, wav_bytes)

        if enrich and result.get("text"):
            result.update(extract_keywords(result["text"]))

        return result

    async def transcribe_stream(
        self,
        audio_chunk: bytes,
        session_id:  str,
        input_format: str = "webm",
    ) -> dict[str, Any]:
        """
        Streaming transcription of a single audio chunk.
        Called repeatedly by the WebSocket handler with chunks from the browser.

        For real-time display, returns the transcription immediately without
        waiting for the full recording to finish.
        """
        # Re-use the same pipeline -- faster-whisper handles short clips well
        return await self.transcribe(audio_chunk, input_format=input_format, enrich=False)
