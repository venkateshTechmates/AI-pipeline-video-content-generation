"""Deterministic offline providers (PROVIDER_MODE=fake): real media via ffmpeg, no API keys.

Used by tests, CI and local demos so the whole graph runs end-to-end.
"""

from __future__ import annotations

import hashlib
import tempfile
from pathlib import Path

from .. import media
from ..captions import estimate_word_timings
from ..models import ASPECT_SIZE, PostMetrics, PostRecord
from .base import (
    MusicResult,
    ProviderError,
    PublishRequest,
    PublishResult,
    TTSResult,
    VideoRequest,
    VideoResult,
)


def _seed(s: str) -> int:
    return int(hashlib.sha256(s.encode()).hexdigest()[:8], 16)


class FakeVideo:
    def __init__(self, name: str = "fake:video", fail_times: int = 0,
                 durations: tuple[float, ...] | None = (5.0, 10.0)):
        self.name = name
        self.supported_durations = durations
        self.max_clip_seconds = max(durations) if durations else 10.0
        self.fail_times = fail_times  # simulate transient failures for retry/fallback tests
        self.calls = 0

    def estimate(self, seconds: float) -> float:
        from ..ledger import price

        if self.supported_durations:
            seconds = next((d for d in sorted(self.supported_durations) if d >= seconds - 0.25),
                           max(self.supported_durations))
        return seconds * price(self.name)

    async def generate(self, req: VideoRequest) -> VideoResult:
        self.calls += 1
        if self.calls <= self.fail_times:
            raise ProviderError(f"{self.name}: simulated failure {self.calls}")
        w, h = ASPECT_SIZE[req.aspect]
        w, h = w // 4, h // 4  # small & fast; renderer upscales
        hue = _seed(req.prompt) % 360
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "clip.mp4"
            await media.run([
                media.ffmpeg(), "-y", "-f", "lavfi", "-i",
                f"testsrc2=size={w}x{h}:rate=30:duration={req.duration:.2f}",
                "-vf", f"hue=h={hue}:s=1.4,format=yuv420p", "-c:v", "libx264", "-preset", "ultrafast", str(out),
            ])
            data = out.read_bytes()
        return VideoResult(data=data, duration=req.duration, model="testsrc2", billable_seconds=req.duration,
                           request_id=f"fake-{_seed(req.prompt)}")


class FakeTTS:
    name = "fake:tts"
    words_per_second = 2.6

    async def synthesize(self, text: str, voice_id: str) -> TTSResult:
        dur = max(1.0, len(text.split()) / self.words_per_second)
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "vo.mp3"
            # a modulated tone stands in for speech (non-silent so loudness checks work)
            await media.run([
                media.ffmpeg(), "-y", "-f", "lavfi", "-i", f"sine=frequency=220:duration={dur:.2f}",
                "-af", "tremolo=f=5:d=0.7,volume=0.5", "-c:a", "libmp3lame", "-b:a", "128k", str(out),
            ])
            audio = out.read_bytes()
        return TTSResult(audio=audio, words=estimate_word_timings(text, dur - 0.05), characters=len(text),
                         duration=dur)


class FakeMusic:
    name = "fake:music"

    async def pick(self, mood: str, min_duration: float, exclude: list[str] | None = None) -> MusicResult:
        d = max(min_duration, 10)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "music.mp3"
            await media.run([
                media.ffmpeg(), "-y", "-f", "lavfi", "-i",
                f"sine=frequency={330 + _seed(mood) % 200}:duration={d:.1f}", "-af", "volume=0.3",
                "-c:a", "libmp3lame", "-b:a", "128k", str(out),
            ])
            data = out.read_bytes()
        return MusicResult(data=data, title=f"Fake {mood} track", license_id=f"fake-{mood}", duration=d)


class FakePublisher:
    name = "fake:publish"

    def __init__(self) -> None:
        self.published: list[PublishRequest] = []

    async def publish(self, req: PublishRequest) -> PublishResult:
        self.published.append(req)
        ext = f"{req.platform.value}-{_seed(req.run_id + req.platform.value)}"
        return PublishResult(platform=req.platform, external_id=ext, url=f"https://example.com/{ext}",
                             status="scheduled" if req.scheduled_at else "published")


class FakeMetrics:
    name = "fake:metrics"

    async def fetch(self, post: PostRecord, profile_key: str | None = None) -> PostMetrics:
        s = _seed(post.id)
        return PostMetrics(post_id=post.id, views=1000 + s % 9000, likes=s % 500, comments=s % 50,
                           shares=s % 30, retention={"avg_view_pct": 40 + s % 50})
