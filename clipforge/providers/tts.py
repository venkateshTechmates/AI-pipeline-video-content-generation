"""TTS adapters: ElevenLabs (word timestamps, default) and OpenAI TTS (fallback)."""

from __future__ import annotations

import base64
import tempfile
from pathlib import Path

import httpx

from .. import media
from ..captions import estimate_word_timings, tokenize
from ..languages import get_language
from ..models import WordTiming
from ..ratelimit import bucket
from .base import ProviderError, TTSResult


def chars_to_words(chars: list[str], starts: list[float], ends: list[float],
                   language: str = "en") -> list[WordTiming]:
    """Collapse ElevenLabs character alignment into word timings (character chunks for unspaced scripts)."""
    if not get_language(language).spaced:
        return _chunk_chars(chars, starts, ends, language)
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


def _chunk_chars(chars: list[str], starts: list[float], ends: list[float], language: str) -> list[WordTiming]:
    """Map caption tokens (tokenize) back onto per-character timings."""
    text = "".join(chars)
    out: list[WordTiming] = []
    pos = 0
    for tok in tokenize(text, language):
        i = text.find(tok, pos)
        if i < 0:
            continue
        j = i + len(tok) - 1
        out.append(WordTiming(word=tok, start=round(starts[i], 3), end=round(ends[min(j, len(ends) - 1)], 3)))
        pos = j + 1
    return out


class ElevenLabsTTS:
    name = "elevenlabs:tts"

    def __init__(self, api_key: str, model_id: str = "eleven_multilingual_v2",
                 client: httpx.AsyncClient | None = None):
        self.api_key = api_key
        self.model_id = model_id
        self.client = client or httpx.AsyncClient(timeout=180)

    async def synthesize(self, text: str, voice_id: str, language: str = "en") -> TTSResult:
        await bucket("elevenlabs").acquire()
        r = await self.client.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps",
            params={"output_format": "mp3_44100_128"},
            headers={"xi-api-key": self.api_key},
            json={"text": text, "model_id": self.model_id, "language_code": language,
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
                               al.get("character_end_times_seconds", []), language)
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

    async def synthesize(self, text: str, voice_id: str, language: str = "en") -> TTSResult:
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
        words = estimate_word_timings(text, dur - 0.1, lang=language)
        return TTSResult(audio=r.content, words=words, characters=len(text), duration=dur)


class EspeakTTS:
    """Local, offline TTS (espeak-ng) for demos and development: real speech, no API key.

    espeak-ng gives no word timestamps, so timings are estimated over the measured audio length.
    `voice_id` values that are not espeak voices fall back to `en-us`.
    """

    name = "espeak:tts"

    def __init__(self, binary: str = "espeak-ng", speed_wpm: int = 165):
        self.binary = binary
        self.speed = speed_wpm

    async def synthesize(self, text: str, voice_id: str, language: str = "en") -> TTSResult:
        lang = get_language(language)
        # a brand espeak voice (e.g. "en-us+m3") only applies to its own language
        voice = voice_id if language == "en" and len(voice_id) <= 12 and "-" in voice_id else lang.espeak
        with tempfile.TemporaryDirectory() as d:
            wav, mp3 = Path(d) / "vo.wav", Path(d) / "vo.mp3"
            await media.run([self.binary, "-v", voice, "-s", str(self.speed), "-w", str(wav), text])
            await media.run([media.ffmpeg(), "-y", "-i", str(wav), "-af", "silenceremove=start_periods=1:"
                             "start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,"
                             "areverse", "-c:a", "libmp3lame", "-b:a", "128k", str(mp3)])
            dur = await media.duration(mp3)
            audio = mp3.read_bytes()
        words = estimate_word_timings(text, dur - 0.05, lang=language)
        return TTSResult(audio=audio, words=words, characters=len(text), duration=dur)


class GeminiTTS:
    """Google Gemini TTS (same GOOGLE_API_KEY as Veo). Returns 24 kHz PCM, converted to mp3 here.

    No word timestamps: timings are estimated over the measured audio length. `voice_id` values that are
    not Gemini prebuilt voice names fall back to `default_voice`.
    """

    name = "gemini:tts"
    VOICES = {"Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr", "Enceladus", "Sadachbia",
              "Algenib", "Gacrux", "Iapetus", "Rasalgethi", "Schedar", "Sulafat", "Umbriel", "Vindemiatrix"}
    URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    def __init__(self, api_key: str, model: str = "gemini-2.5-flash-preview-tts", default_voice: str = "Charon",
                 style: str = "Read this as a warm, confident short-form video narrator:",
                 client: httpx.AsyncClient | None = None):
        self.api_key = api_key
        self.model = model
        self.default_voice = default_voice
        self.style = style
        self.client = client or httpx.AsyncClient(timeout=180)

    async def synthesize(self, text: str, voice_id: str, language: str = "en") -> TTSResult:
        voice = voice_id if voice_id in self.VOICES else self.default_voice
        await bucket("vertex").acquire()
        r = await self.client.post(
            self.URL.format(model=self.model),
            headers={"x-goog-api-key": self.api_key},
            json={
                "contents": [{"parts": [{"text": f"{self.style} {text}"}]}],
                "generationConfig": {
                    "responseModalities": ["AUDIO"],
                    "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
                },
            },
        )
        if r.status_code in (400, 401, 403):
            from ..retry import PermanentError

            raise PermanentError(f"gemini tts: {r.text[:300]}")
        r.raise_for_status()
        try:
            part = r.json()["candidates"][0]["content"]["parts"][0]["inlineData"]
        except (KeyError, IndexError) as e:
            raise ProviderError(f"gemini tts returned no audio: {r.text[:300]}") from e
        rate = 24000
        mime = part.get("mimeType", "")
        if "rate=" in mime:
            rate = int(mime.split("rate=")[1].split(";")[0])
        with tempfile.TemporaryDirectory() as d:
            pcm, mp3 = Path(d) / "vo.pcm", Path(d) / "vo.mp3"
            pcm.write_bytes(base64.b64decode(part["data"]))
            await media.run([media.ffmpeg(), "-y", "-f", "s16le", "-ar", str(rate), "-ac", "1", "-i", str(pcm),
                             "-c:a", "libmp3lame", "-b:a", "128k", str(mp3)])
            dur = await media.duration(mp3)
            audio = mp3.read_bytes()
        words = estimate_word_timings(text, dur - 0.05, lang=language)
        return TTSResult(audio=audio, words=words, characters=len(text), duration=dur)
