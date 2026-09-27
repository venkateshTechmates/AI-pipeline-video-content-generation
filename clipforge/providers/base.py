"""Provider adapter protocols (PRD §7 cross-cutting).

The graph only ever talks to these interfaces; nothing provider-specific is
stored in graph state, so providers can be swapped per brand/tier without
touching nodes.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel, Field

from ..models import Aspect, Platform, PlatformMetadata, PostMetrics, PostRecord, WordTiming
from ..render_spec import RenderResult, RenderSpec


class ProviderError(Exception):
    pass


# --------------------------------------------------------------------------- video


class VideoRequest(BaseModel):
    prompt: str
    negative_prompt: str = ""
    duration: float
    aspect: Aspect = Aspect.vertical
    image_url: str | None = None  # reference frame for image-to-video (public or signed URL)
    image_path: Path | None = None  # local reference frame (for providers accepting uploads / fakes)
    seed: int | None = None
    generate_audio: bool = False
    webhook_url: str | None = None


class VideoResult(BaseModel):
    url: str | None = None
    data: bytes | None = None
    duration: float
    model: str
    billable_seconds: float
    request_id: str | None = None


@runtime_checkable
class VideoGen(Protocol):
    name: str  # ledger key, e.g. "fal:kling-3.0"
    max_clip_seconds: float
    supported_durations: tuple[float, ...] | None  # None = any duration up to max

    async def generate(self, req: VideoRequest) -> VideoResult: ...
    def estimate(self, seconds: float) -> float: ...


# --------------------------------------------------------------------------- tts


class TTSResult(BaseModel):
    audio: bytes
    format: str = "mp3"
    words: list[WordTiming]
    characters: int
    duration: float


@runtime_checkable
class TTS(Protocol):
    name: str

    async def synthesize(self, text: str, voice_id: str) -> TTSResult: ...


# --------------------------------------------------------------------------- music


class MusicResult(BaseModel):
    url: str | None = None
    data: bytes | None = None
    local_path: Path | None = None
    title: str
    license_id: str
    duration: float | None = None
    format: str = "mp3"


@runtime_checkable
class MusicSource(Protocol):
    name: str

    async def pick(self, mood: str, min_duration: float, exclude: list[str] | None = None) -> MusicResult: ...


# --------------------------------------------------------------------------- render


@runtime_checkable
class Renderer(Protocol):
    name: str

    async def render(self, spec: RenderSpec) -> RenderResult: ...


# --------------------------------------------------------------------------- publish / metrics


class PublishRequest(BaseModel):
    brand_id: str
    run_id: str
    platform: Platform
    video_url: str  # public/signed URL
    video_path: Path | None = None
    metadata: PlatformMetadata
    thumbnail_url: str | None = None
    scheduled_at: datetime | None = None
    profile_key: str | None = None  # per-brand token / profile (Ayrshare profile key, Upload-Post user)


class PublishResult(BaseModel):
    platform: Platform
    external_id: str | None
    url: str | None = None
    status: str = "scheduled"  # scheduled | published | failed
    raw: dict[str, Any] = Field(default_factory=dict)


@runtime_checkable
class Publisher(Protocol):
    name: str

    async def publish(self, req: PublishRequest) -> PublishResult: ...


@runtime_checkable
class MetricsSource(Protocol):
    name: str

    async def fetch(self, post: PostRecord, profile_key: str | None = None) -> PostMetrics: ...
