"""TTS adapters: ElevenLabs (word timestamps, default) and OpenAI TTS (fallback)."""

from __future__ import annotations

import base64
import tempfile
from pathlib import Path

import httpx

from .. import media
from ..captions import estimate_word_timings
from ..models import WordTiming
from ..ratelimit import bucket
from .base import ProviderError, TTSResult


def chars_to_words(chars: list[str], starts: list[float], ends: list[float]) -> list[WordTiming]:
    """Collapse ElevenLabs character alignment into word timings."""
    words: list[WordTiming] = []
    buf, w_start, w_end = "", None, 0.0
    for ch, s, e in zip(chars, starts, ends, strict=False):
        if ch.isspace():
            if buf:
                words.append(WordTiming(word=buf, start=round(w_start or 0.0, 3), end=round(w_end, 3)))
            buf, w_start = "", None
            continue
        if w_start is None:
            w_start = s
        buf += ch
        w_end = e
    if buf:
        words.append(WordTiming(word=buf, start=round(w_start or 0.0, 3), end=round(w_end, 3)))
    return words


class ElevenLabsTTS:
    name = "elevenlabs:tts"

    def __init__(self, api_key: str, model_id: str = "eleven_multilingual_v2",
                 client: httpx.AsyncClient | None = None):
        self.api_key = api_key
        self.model_id = model_id
        self.client = client or httpx.AsyncClient(timeout=180)

    async def synthesize(self, text: str, voice_id: str) -> TTSResult:
        await bucket("elevenlabs").acquire()
        r = await self.client.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps",
            params={"output_format": "mp3_44100_128"},
            headers={"xi-api-key": self.api_key},
            json={"text": text, "model_id": self.model_id,
                  "voice_settings": {"stability": 0.45, "similarity_boost": 0.8, "style": 0.3}},
        )
        if r.status_code in (400, 401, 422):
            from ..retry import PermanentError

            raise PermanentError(f"elevenlabs: {r.text[:300]}")
        r.raise_for_status()
        j = r.json()
        audio = base64.b64decode(j["audio_base64"])
        al = j.get("normalized_alignment") or j.get("alignment") or {}
        words = chars_to_words(al.get("characters", []), al.get("character_start_times_seconds", []),
                               al.get("character_end_times_seconds", []))
        if not words:
            raise ProviderError("elevenlabs returned no alignment")
        return TTSResult(audio=audio, words=words, characters=len(text), duration=words[-1].end)


class OpenAITTS:
    """No timestamps from the API: word timings are estimated over the measured audio length."""

    name = "openai:tts"

    VOICES = {"alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"}

    def __init__(self, api_key: str, model: str = "gpt-4o-mini-tts", client: httpx.AsyncClient | None = None):
        self.api_key = api_key
        self.model = model
        self.client = client or httpx.AsyncClient(timeout=180)

    async def synthesize(self, text: str, voice_id: str) -> TTSResult:
        voice = voice_id if voice_id in self.VOICES else "nova"
        await bucket("openai").acquire()
        r = await self.client.post(
            "https://api.openai.com/v1/audio/speech",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={"model": self.model, "voice": voice, "input": text, "response_format": "mp3"},
        )
        r.raise_for_status()
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "vo.mp3"
            p.write_bytes(r.content)
            dur = await media.duration(p)
        return TTSResult(audio=r.content, words=estimate_word_timings(text, dur - 0.1), characters=len(text),
                         duration=dur)


class EspeakTTS:
    """Local, offline TTS (espeak-ng) for demos and development: real speech, no API key.

    espeak-ng gives no word timestamps, so timings are estimated over the measured audio length.
    `voice_id` values that are not espeak voices fall back to `en-us`.
    """

    name = "espeak:tts"

    def __init__(self, binary: str = "espeak-ng", speed_wpm: int = 165):
        self.binary = binary
        self.speed = speed_wpm

    async def synthesize(self, text: str, voice_id: str) -> TTSResult:
        voice = voice_id if len(voice_id) <= 12 and "-" in voice_id else "en-us+m3"
        with tempfile.TemporaryDirectory() as d:
            wav, mp3 = Path(d) / "vo.wav", Path(d) / "vo.mp3"
            await media.run([self.binary, "-v", voice, "-s", str(self.speed), "-w", str(wav), text])
            await media.run([media.ffmpeg(), "-y", "-i", str(wav), "-af", "silenceremove=start_periods=1:"
                             "start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,"
                             "areverse", "-c:a", "libmp3lame", "-b:a", "128k", str(mp3)])
            dur = await media.duration(mp3)
            audio = mp3.read_bytes()
        return TTSResult(audio=audio, words=estimate_word_timings(text, dur - 0.05), characters=len(text),
                         duration=dur)
