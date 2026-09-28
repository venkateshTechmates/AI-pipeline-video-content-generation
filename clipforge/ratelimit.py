"""Per-provider token buckets and per-platform daily posting quotas (PRD §11)."""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from datetime import date

from .models import Platform


class TokenBucket:
    def __init__(self, rate_per_s: float, capacity: float):
        self.rate = rate_per_s
        self.capacity = capacity
        self.tokens = capacity
        self.updated = time.monotonic()
        self._lock = asyncio.Lock()

    def _refill(self) -> None:
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
        self.updated = now

    async def acquire(self, n: float = 1.0) -> None:
        async with self._lock:
            while True:
                self._refill()
                if self.tokens >= n:
                    self.tokens -= n
                    return
                await asyncio.sleep((n - self.tokens) / self.rate)


# requests/second, burst
PROVIDER_LIMITS: dict[str, tuple[float, float]] = {
    "fal": (2.0, 10),
    "vertex": (0.5, 4),
    "replicate": (1.0, 5),
    "elevenlabs": (2.0, 5),
    "openai": (5.0, 10),
    "anthropic": (5.0, 10),
    "upload_post": (1.0, 3),
    "ayrshare": (1.0, 5),
    "openrouter": (1.0, 5),
    "creatomate": (1.0, 3),
    "music": (2.0, 5),
}

_buckets: dict[str, TokenBucket] = {}


def bucket(provider: str) -> TokenBucket:
    key = provider.split(":")[0]
    if key not in _buckets:
        rate, cap = PROVIDER_LIMITS.get(key, (2.0, 5))
        _buckets[key] = TokenBucket(rate, cap)
    return _buckets[key]


# Conservative per-account daily caps (platform limits change; keep configurable).
PLATFORM_DAILY_CAP: dict[Platform, int] = {
    Platform.tiktok: 15,
    Platform.instagram: 25,
    Platform.youtube: 50,
    Platform.linkedin: 50,
    Platform.x: 100,
    Platform.facebook: 25,
    Platform.threads: 25,
    Platform.pinterest: 25,
    Platform.bluesky: 50,
    Platform.reddit: 5,
}


class PostingQuota:
    """In-process counter; the Postgres repo enforces it durably via `posts` counts."""

    def __init__(self) -> None:
        self._counts: dict[tuple[str, Platform, date], int] = defaultdict(int)

    def allow(self, brand_id: str, platform: Platform, day: date, used: int | None = None) -> bool:
        n = used if used is not None else self._counts[(brand_id, platform, day)]
        return n < PLATFORM_DAILY_CAP.get(platform, 25)

    def record(self, brand_id: str, platform: Platform, day: date) -> None:
        self._counts[(brand_id, platform, day)] += 1
