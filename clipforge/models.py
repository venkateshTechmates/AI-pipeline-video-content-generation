"""Domain models shared by the graph, API, adapters and workers.

These are the pipeline's contracts (PRD §7, §9). Anything persisted or passed
between nodes is one of these Pydantic models, serialised to JSON.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator, model_validator


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_id() -> str:
    return str(uuid4())


# --------------------------------------------------------------------------- enums


class Tier(StrEnum):
    economy = "economy"  # Kling 3.0 (fal) + Veo Lite
    premium = "premium"  # Veo 3.1 standard


class Platform(StrEnum):
    youtube = "youtube"
    instagram = "instagram"
    tiktok = "tiktok"
    linkedin = "linkedin"
    x = "x"
    facebook = "facebook"  # Facebook Reels (page)
    threads = "threads"
    pinterest = "pinterest"  # video pin (needs a board)
    bluesky = "bluesky"
    reddit = "reddit"  # needs a subreddit


ALL_PLATFORMS: tuple[Platform, ...] = tuple(Platform)
# PRD's five plus Facebook; brands opt into the rest in their kit.
DEFAULT_PLATFORMS: tuple[Platform, ...] = (
    Platform.youtube, Platform.instagram, Platform.tiktok, Platform.linkedin, Platform.x, Platform.facebook,
)


class Aspect(StrEnum):
    vertical = "9:16"
    square = "1:1"
    landscape = "16:9"


ASPECT_SIZE: dict[Aspect, tuple[int, int]] = {
    Aspect.vertical: (1080, 1920),
    Aspect.square: (1080, 1080),
    Aspect.landscape: (1920, 1080),
}


class RunStatus(StrEnum):
    queued = "queued"
    running = "running"
    resume_requested = "resume_requested"
    awaiting_approval = "awaiting_approval"
    awaiting_provider = "awaiting_provider"
    scheduled = "scheduled"
    published = "published"
    failed = "failed"
    aborted = "aborted"  # budget exceeded / cancelled
    dead_letter = "dead_letter"


class StageStatus(StrEnum):
    pending = "pending"
    running = "running"
    succeeded = "succeeded"
    skipped = "skipped"
    failed = "failed"


STAGES: tuple[str, ...] = (
    "ideate",
    "script",
    "tts",
    "gen_shots",
    "music",
    "render",
    "qa",
    "approve",
    "metadata",
    "publish",
    "metrics",
)


# --------------------------------------------------------------------------- languages


def _check_language(code: str) -> str:
    from .languages import get_language

    return get_language(code).code


def _check_languages(codes: list[str]) -> list[str]:
    out: list[str] = []
    for c in codes:
        c = _check_language(c)
        if c not in out:
            out.append(c)
    return out


# --------------------------------------------------------------------------- brand kit


class CaptionStyle(BaseModel):
    font: str = "Inter"
    font_size: int = 72
    color: str = "#FFFFFF"
    highlight_color: str = "#FFD400"
    stroke_color: str = "#000000"
    stroke_width: int = 6
    position: Literal["top", "center", "bottom"] = "center"
    words_per_line: int = 3
    uppercase: bool = True


class CalendarSlot(BaseModel):
    """Weekly posting slot in brand-local time."""

    weekday: int = Field(ge=0, le=6)  # Monday = 0
    time: str = "18:00"  # HH:MM
    platforms: list[Platform] = Field(default_factory=lambda: list(DEFAULT_PLATFORMS))


class PostingCalendar(BaseModel):
    timezone: str = "UTC"
    slots: list[CalendarSlot] = Field(default_factory=list)


class DisclosurePolicy(BaseModel):
    """Whether to flag posts as AI-generated per platform (PRD §11 compliance)."""

    default: bool = True
    per_platform: dict[Platform, bool] = Field(default_factory=dict)

    def required(self, platform: Platform) -> bool:
        return self.per_platform.get(platform, self.default)


class BrandKit(BaseModel):
    fonts: list[str] = Field(default_factory=lambda: ["Inter"])
    colors: dict[str, str] = Field(
        default_factory=lambda: {"primary": "#111111", "accent": "#FFD400", "background": "#000000"}
    )
    logo_path: str | None = None
    caption_style: CaptionStyle = Field(default_factory=CaptionStyle)
    voice_id: str = "21m00Tcm4TlvDq8ikWAM"
    reference_images: list[str] = Field(default_factory=list)
    negative_prompts: list[str] = Field(
        default_factory=lambda: ["text", "watermark", "logo", "distorted hands", "low quality"]
    )
    banned_topics: list[str] = Field(default_factory=list)
    tone: str = "energetic, concise, helpful"
    audience: str = "general social media audience"
    niche: str = "general"
    template: str = "default"  # Remotion composition id
    music_moods: list[str] = Field(default_factory=lambda: ["upbeat"])
    disclosure: DisclosurePolicy = Field(default_factory=DisclosurePolicy)
    platforms: list[Platform] = Field(default_factory=lambda: list(DEFAULT_PLATFORMS))
    # Per-platform account targets, e.g. {"facebook": {"page_id": "..."}, "pinterest": {"board_id": "..."},
    # "reddit": {"subreddit": "..."}}
    platform_options: dict[Platform, dict[str, str]] = Field(default_factory=dict)
    hashtags: list[str] = Field(default_factory=list)
    # Cross-shot consistency: "reference" = image-to-video from reference_images[0];
    # "first_shot" = generate shot 0, then use its frame as the reference for the rest; "none" = text-to-video.
    consistency: Literal["reference", "first_shot", "none"] = "first_shot"
    # Voice-over + burned-in caption language (ISO 639-1, see clipforge.languages) and extra subtitle files.
    language: str = "en"
    subtitle_languages: list[str] = Field(default_factory=list)
    voices: dict[str, str] = Field(default_factory=dict)  # per-language voice ids; falls back to voice_id
    # Audience location (ISO 3166 "IN" / "IN-TG"): default language + subtitles, and local references in scripts.
    region: str | None = None

    @field_validator("region")
    @classmethod
    def _region_ok(cls, v: str | None) -> str | None:
        if not v:
            return None
        from .regions import get_region

        r = get_region(v)
        if r is None:
            raise ValueError(f"unknown region {v!r} (use ISO 3166 like 'IN' or 'IN-TG')")
        return r.code

    def apply_region_defaults(self) -> None:
        """Set language + subtitle languages from the region (used when they weren't chosen explicitly)."""
        from .regions import get_region

        r = get_region(self.region)
        if r:
            self.language = r.language
            self.subtitle_languages = list(r.subtitles)

    @field_validator("language")
    @classmethod
    def _lang_ok(cls, v: str) -> str:
        return _check_language(v)

    @field_validator("subtitle_languages")
    @classmethod
    def _subs_ok(cls, v: list[str]) -> list[str]:
        return _check_languages(v)

    def voice_for(self, language: str) -> str:
        return self.voices.get(language, self.voice_id)


class Brand(BaseModel):
    id: str = Field(default_factory=new_id)
    org_id: str = "default"
    name: str
    kit: BrandKit = Field(default_factory=BrandKit)
    tier: Tier = Tier.economy
    budget_per_run: float = 25.0
    daily_budget: float = 250.0
    trust_score: int = 0  # consecutive human approvals
    auto_approve_after: int = 10  # N in "trust >= N"
    calendar: PostingCalendar = Field(default_factory=PostingCalendar)
    publisher: Literal["upload_post", "ayrshare"] = "upload_post"


# --------------------------------------------------------------------------- stage IO


class Hook(BaseModel):
    text: str
    angle: str = ""
    score: float = Field(ge=0, le=1, default=0.5)
    rationale: str = ""


class Ideas(BaseModel):
    hooks: list[Hook] = Field(min_length=1)


class Beat(BaseModel):
    text: str
    purpose: Literal["hook", "setup", "value", "payoff", "cta"] = "value"


class Script(BaseModel):
    title: str
    hook: str
    beats: list[Beat] = Field(min_length=1)
    vo_text: str
    caption_text: str
    cta: str
    mood: str = "upbeat"
    target_seconds: int = Field(default=40, ge=30, le=60)

    @property
    def word_count(self) -> int:
        return len(self.vo_text.split())


class Shot(BaseModel):
    index: int
    prompt: str
    duration: float = Field(ge=2, le=60)
    negative_prompt: str = ""
    ref_image: str | None = None  # storage path of reference frame (image-to-video)


class ShotList(BaseModel):
    shots: list[Shot] = Field(min_length=3, max_length=6)

    @property
    def total_duration(self) -> float:
        return sum(s.duration for s in self.shots)


class ScriptPackage(BaseModel):
    """Structured output of the script agent."""

    script: Script
    shot_list: ShotList

    @model_validator(mode="after")
    def _index_shots(self) -> ScriptPackage:
        for i, s in enumerate(self.shot_list.shots):
            s.index = i
        return self


class WordTiming(BaseModel):
    word: str
    start: float
    end: float


class VoiceOver(BaseModel):
    audio_path: str
    duration: float
    words: list[WordTiming]
    lufs: float | None = None


class Clip(BaseModel):
    shot_index: int
    path: str
    duration: float
    provider: str
    model: str = ""


class MusicTrack(BaseModel):
    path: str
    title: str
    license_id: str
    provider: str
    duck_db: float = -12.0


class RenderOutput(BaseModel):
    aspect: Aspect
    path: str
    width: int
    height: int
    duration: float


class QACheck(BaseModel):
    name: str
    passed: bool
    value: Any = None
    detail: str = ""
    weight: float = 1.0


class QAReport(BaseModel):
    checks: list[QACheck] = Field(default_factory=list)

    @property
    def score(self) -> float:
        total = sum(c.weight for c in self.checks)
        if not total:
            return 0.0
        return round(sum(c.weight for c in self.checks if c.passed) / total, 3)

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.checks if c.weight >= 1.0)

    def model_dump_full(self) -> dict[str, Any]:
        return {**self.model_dump(), "score": self.score, "passed": self.passed}


class PlatformMetadata(BaseModel):
    platform: Platform
    title: str
    description: str
    hashtags: list[str] = Field(default_factory=list)
    thumbnail_path: str | None = None
    thumbnail_time: float = 0.0
    ai_disclosure: bool = True
    aspect: Aspect = Aspect.vertical


class PostRecord(BaseModel):
    id: str = Field(default_factory=new_id)
    run_id: str
    platform: Platform
    external_id: str | None = None
    url: str | None = None
    scheduled_at: datetime | None = None
    published_at: datetime | None = None
    status: Literal["scheduled", "published", "failed"] = "scheduled"
    metadata: dict[str, Any] = Field(default_factory=dict)


class PostMetrics(BaseModel):
    post_id: str
    captured_at: datetime = Field(default_factory=utcnow)
    views: int = 0
    likes: int = 0
    comments: int = 0
    shares: int = 0
    retention: dict[str, Any] = Field(default_factory=dict)


# --------------------------------------------------------------------------- approval


class Decision(StrEnum):
    approve = "approve"
    regenerate = "regenerate"
    edit = "edit"
    reject = "reject"


REGENERATABLE = ("ideate", "script", "tts", "gen_shots", "music", "render")


class ApprovalDecision(BaseModel):
    decision: Decision
    stage: str | None = None  # for regenerate
    patch: dict[str, Any] | None = None  # for edit: partial Script fields
    reviewer: str | None = None
    note: str | None = None

    @field_validator("stage")
    @classmethod
    def _stage_ok(cls, v: str | None) -> str | None:
        if v is not None and v not in REGENERATABLE:
            raise ValueError(f"stage must be one of {REGENERATABLE}")
        return v

    @model_validator(mode="after")
    def _consistent(self) -> ApprovalDecision:
        if self.decision == Decision.regenerate and not self.stage:
            raise ValueError("regenerate requires stage")
        if self.decision == Decision.edit and not self.patch:
            raise ValueError("edit requires patch")
        shots = (self.patch or {}).get("shots")
        if shots is not None:
            if not isinstance(shots, list) or not 3 <= len(shots) <= 6:
                raise ValueError("patch.shots must be a list of 3-6 shots")
            for s in shots:
                prompt = s.get("prompt") if isinstance(s, dict) else s
                if not isinstance(prompt, str) or not prompt.strip():
                    raise ValueError("each shot needs a non-empty prompt")
        return self


# --------------------------------------------------------------------------- run / ledger


class RunCreate(BaseModel):
    brand_id: str
    brief: str | None = None
    tier: Tier | None = None
    schedule: datetime | None = None  # explicit publish time; else brand calendar
    platforms: list[Platform] | None = None
    budget: float | None = None
    language: str | None = None  # voice + captions; defaults to the region's language, then the brand kit's
    subtitle_languages: list[str] | None = None  # extra translated subtitle files
    region: str | None = None  # audience location for this run (ISO 3166); sets language defaults

    @field_validator("language")
    @classmethod
    def _lang_ok(cls, v: str | None) -> str | None:
        return _check_language(v) if v else v

    @field_validator("subtitle_languages")
    @classmethod
    def _subs_ok(cls, v: list[str] | None) -> list[str] | None:
        return _check_languages(v) if v is not None else v


class Run(BaseModel):
    id: str = Field(default_factory=new_id)
    brand_id: str
    brief: str | None = None
    status: RunStatus = RunStatus.queued
    tier: Tier = Tier.economy
    budget: float = 25.0
    cost_total: float = 0.0
    checkpoint_id: str | None = None
    schedule: datetime | None = None
    platforms: list[Platform] = Field(default_factory=lambda: list(DEFAULT_PLATFORMS))
    error: str | None = None
    attempts: int = 0
    pending_decision: dict[str, Any] | None = None  # approval decision waiting for the worker to resume
    language: str = "en"
    subtitle_languages: list[str] = Field(default_factory=list)
    region: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class StageRecord(BaseModel):
    id: str = Field(default_factory=new_id)
    run_id: str
    name: str
    status: StageStatus = StageStatus.pending
    attempt: int = 0
    provider: str | None = None
    cost: float = 0.0
    input_ref: str | None = None
    output_ref: str | None = None
    error: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None


class Asset(BaseModel):
    id: str = Field(default_factory=new_id)
    run_id: str
    type: str
    storage_path: str
    sha256: str
    meta: dict[str, Any] = Field(default_factory=dict)


class LedgerEntry(BaseModel):
    id: str = Field(default_factory=new_id)
    run_id: str
    brand_id: str
    stage: str
    provider: str
    units: float
    unit_cost: float
    total: float
    at: datetime = Field(default_factory=utcnow)


class RenderJob(BaseModel):
    id: str = Field(default_factory=new_id)
    run_id: str
    status: Literal["queued", "running", "done", "failed"] = "queued"
    spec: dict[str, Any]
    output: dict[str, Any] | None = None
    error: str | None = None
    attempts: int = 0
