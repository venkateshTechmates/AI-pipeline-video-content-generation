"""Builds provider chains per tier from settings (PRD §8 "Config: provider tiers per brand").

economy  = Kling 3.0 (fal)  -> Seedance -> Hailuo -> Replicate Kling -> Veo Lite
premium  = Veo 3.1 std      -> Veo Fast -> Kling 3.0 (fal)
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..config import Settings
from ..db import Repo
from ..models import Brand, Tier
from ..storage import AssetStore
from . import fake
from .base import MetricsSource, MusicSource, Publisher, Renderer, TTS, VideoGen


@dataclass
class Providers:
    video: dict[Tier, list[VideoGen]]
    tts: list[TTS]
    music: list[MusicSource]
    renderer: Renderer
    publishers: dict[str, Publisher]
    metrics: dict[str, MetricsSource]
    extras: dict = field(default_factory=dict)

    def video_chain(self, tier: Tier) -> list[VideoGen]:
        return self.video.get(tier) or self.video[Tier.economy]

    def publisher_for(self, brand: Brand) -> Publisher:
        return self.publishers.get(brand.publisher) or next(iter(self.publishers.values()))

    def metrics_for(self, brand: Brand) -> MetricsSource:
        return self.metrics.get(brand.publisher) or next(iter(self.metrics.values()))


def build_providers(settings: Settings, repo: Repo, store: AssetStore) -> Providers:
    if settings.provider_mode == "fake":
        return fake_providers(store)

    from .fal import FalVideo
    from .music import EpidemicMusic, LibraryMusic
    from .publish import AyrshareMetrics, AyrsharePublisher, UploadPostMetrics, UploadPostPublisher
    from .render import CreatomateRenderer, FfmpegRenderer, RemotionRenderer
    from .replicate import ReplicateVideo
    from .tts import ElevenLabsTTS, OpenAITTS
    from .veo import VeoVideo

    economy: list[VideoGen] = []
    premium: list[VideoGen] = []
    has_veo = bool(settings.google_api_key or settings.google_project)

    def veo(variant: str) -> VeoVideo:
        return VeoVideo(variant=variant, api_key=settings.google_api_key, project=settings.google_project,
                        location=settings.google_location, gcs_output_uri=settings.gcs_output_uri)

    if settings.fal_key:
        economy += [FalVideo(settings.fal_key, m) for m in ("kling-3.0", "seedance", "hailuo")]
    if settings.replicate_api_token:
        economy.append(ReplicateVideo(settings.replicate_api_token))
    if has_veo:
        economy.append(veo("veo-3.1-lite"))
        premium += [veo("veo-3.1"), veo("veo-3.1-fast")]
    premium += [p for p in economy if p.name.startswith("fal:kling")]
    if not economy:
        raise RuntimeError("no video provider configured (FAL_KEY / REPLICATE_API_TOKEN / GOOGLE_*)")

    tts: list[TTS] = []
    if settings.elevenlabs_api_key:
        tts.append(ElevenLabsTTS(settings.elevenlabs_api_key))
    if settings.openai_api_key:
        tts.append(OpenAITTS(settings.openai_api_key))
    if not tts:
        raise RuntimeError("no TTS provider configured (ELEVENLABS_API_KEY / OPENAI_API_KEY)")

    music: list[MusicSource] = []
    if settings.music_library_dir:
        music.append(LibraryMusic(settings.music_library_dir))
    if settings.epidemic_api_key:
        music.append(EpidemicMusic(settings.epidemic_api_key))

    creatomate = CreatomateRenderer(settings.creatomate_api_key, store) if settings.creatomate_api_key else None
    renderer: Renderer
    if settings.renderer == "remotion":
        renderer = RemotionRenderer(repo, overflow=creatomate, overflow_threshold=settings.render_overflow_threshold)
    elif settings.renderer == "creatomate" and creatomate:
        renderer = creatomate
    else:
        renderer = FfmpegRenderer(store)

    publishers: dict[str, Publisher] = {}
    metrics: dict[str, MetricsSource] = {}
    if settings.upload_post_api_key:
        publishers["upload_post"] = UploadPostPublisher(settings.upload_post_api_key)
        metrics["upload_post"] = UploadPostMetrics(settings.upload_post_api_key)
    if settings.ayrshare_api_key:
        publishers["ayrshare"] = AyrsharePublisher(settings.ayrshare_api_key)
        metrics["ayrshare"] = AyrshareMetrics(settings.ayrshare_api_key)
    if not publishers:
        publishers["fake"] = fake.FakePublisher()  # dry-run publishing
        metrics["fake"] = fake.FakeMetrics()

    return Providers(video={Tier.economy: economy, Tier.premium: premium or economy}, tts=tts, music=music,
                     renderer=renderer, publishers=publishers, metrics=metrics)


def fake_providers(store: AssetStore) -> Providers:
    from .render import FfmpegRenderer

    kling = fake.FakeVideo("fake:kling")
    return Providers(
        video={Tier.economy: [kling, fake.FakeVideo("fake:seedance")],
               Tier.premium: [fake.FakeVideo("fake:veo"), kling]},
        tts=[fake.FakeTTS()],
        music=[fake.FakeMusic()],
        renderer=FfmpegRenderer(store),
        publishers={"upload_post": fake.FakePublisher(), "ayrshare": fake.FakePublisher()},
        metrics={"upload_post": fake.FakeMetrics(), "ayrshare": fake.FakeMetrics()},
    )
