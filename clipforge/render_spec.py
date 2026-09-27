"""Render job contract shared by the Python pipeline and the Remotion render worker.

The `render_jobs.spec` column holds `RenderSpec.model_dump(mode="json")`. The
Node worker (`render/`) reads it, renders each aspect, uploads the mp4s and
writes `RenderResult` into `render_jobs.output`.

Paths are storage keys relative to the asset store root (content-addressed),
or absolute local paths / http(s) URLs.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from .models import Aspect, CaptionStyle, WordTiming


class RenderClip(BaseModel):
    path: str
    start: float  # seconds on the timeline
    duration: float


class RenderAudio(BaseModel):
    voice_path: str
    music_path: str | None = None
    music_gain_db: float = -12.0  # ducking under VO
    voice_gain_db: float = 0.0


class BrandOverlay(BaseModel):
    logo_path: str | None = None
    primary_color: str = "#111111"
    accent_color: str = "#FFD400"
    font: str = "Inter"
    cta_text: str | None = None


class RenderSpec(BaseModel):
    run_id: str
    template: str = "default"  # Remotion composition id
    fps: int = 30
    duration: float
    aspects: list[Aspect] = Field(default_factory=lambda: [Aspect.vertical, Aspect.square, Aspect.landscape])
    clips: list[RenderClip]
    audio: RenderAudio
    words: list[WordTiming]  # word-level captions (word-highlight style)
    caption_style: CaptionStyle = Field(default_factory=CaptionStyle)
    brand: BrandOverlay = Field(default_factory=BrandOverlay)
    output_prefix: str  # storage key prefix, e.g. "runs/<run_id>/render"
    language: str = "en"  # caption language: font fallback, no-space scripts, RTL (see clipforge.languages)


class RenderResultItem(BaseModel):
    aspect: Aspect
    path: str
    width: int
    height: int
    duration: float


class RenderResult(BaseModel):
    outputs: list[RenderResultItem]
    renderer: str
