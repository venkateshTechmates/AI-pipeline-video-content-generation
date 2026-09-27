"""Runtime settings (env / .env). Secrets never live in code."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    env: str = "dev"  # dev | prod
    # "fake" swaps every provider for deterministic offline fakes (tests, demos, CI).
    provider_mode: str = "live"  # live | fake

    # ---- persistence
    database_url: str | None = None  # Postgres (Supabase). None -> in-memory repo + memory checkpointer
    supabase_url: str | None = None
    supabase_service_key: str | None = None
    supabase_jwt_secret: str | None = None
    storage_bucket: str = "clipforge"
    asset_root: Path = Path("data/assets")  # local asset store (used when Supabase Storage is not configured)
    public_api_url: str = "http://localhost:8000"

    # ---- LLM
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    llm_model: str = "anthropic:claude-sonnet-5"
    llm_fallback_model: str = "openai:gpt-5"
    vision_model: str = "anthropic:claude-sonnet-5"
    embedding_model: str = "text-embedding-3-small"

    # ---- providers
    fal_key: str | None = None
    fal_webhook_secret: str | None = None
    replicate_api_token: str | None = None
    replicate_webhook_secret: str | None = None
    google_project: str | None = None
    google_location: str = "us-central1"
    google_api_key: str | None = None  # AI Studio (Gemini API) key for Veo
    gcs_output_uri: str | None = None
    elevenlabs_api_key: str | None = None
    epidemic_api_key: str | None = None
    artlist_api_key: str | None = None
    music_library_dir: Path | None = None  # local licensed library with manifest.json
    creatomate_api_key: str | None = None
    upload_post_api_key: str | None = None
    ayrshare_api_key: str | None = None
    publisher_webhook_secret: str | None = None  # HMAC secret configured on the publisher webhook

    # ---- rendering
    renderer: str = "ffmpeg"  # ffmpeg | remotion | creatomate
    render_overflow_threshold: int = 20  # queued remotion jobs before overflowing to Creatomate
    x264_preset: str = "medium"  # ultrafast in tests
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"

    # ---- orchestration
    provider_poll_interval_s: float = 20.0
    provider_timeout_s: float = 600.0
    max_run_attempts: int = 3
    budget_alert_ratio: float = 0.8
    dedupe_days: int = 90
    dedupe_threshold: float = 0.85

    # ---- security
    cron_secret: str | None = None
    auth_required: bool = False  # require Supabase JWT on API
    api_token: str | None = None  # static service token (MCP server / CLI) accepted as a Bearer token
    embedded_worker: bool = True  # run the graph worker inside the API process (single-container mode)
    worker_concurrency: int = 2
    calendar_lead_hours: float = 2.0  # create calendar runs this long before the slot
    alert_webhook_url: str | None = None  # Slack-compatible webhook for budget / DLQ alerts

    # ---- observability
    otel_exporter_otlp_endpoint: str | None = None
    langfuse_public_key: str | None = None
    langfuse_secret_key: str | None = None
    langfuse_host: str = "https://cloud.langfuse.com"


@lru_cache
def get_settings() -> Settings:
    return Settings()
