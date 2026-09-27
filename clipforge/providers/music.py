"""Licensed music sources (PRD §6: licensed stock library only; license IDs stored).

- `LibraryMusic`: a local/mounted licensed library described by `manifest.json`
  (tracks exported from Artlist/Epidemic with their license IDs).
- `EpidemicMusic`: Epidemic Sound Partner Content API search + download.
"""

from __future__ import annotations

import hashlib
import json
import random
from pathlib import Path

import httpx
from pydantic import BaseModel, Field

from ..ratelimit import bucket
from .base import MusicResult, ProviderError


class LibraryTrack(BaseModel):
    file: str
    title: str
    license_id: str
    moods: list[str] = Field(default_factory=list)
    duration: float
    bpm: int | None = None


class LibraryMusic:
    """manifest.json: {"tracks": [{"file": "a.mp3", "title": "...", "license_id": "...",
    "moods": ["upbeat"], "duration": 120}]}"""

    name = "music:library"

    def __init__(self, root: Path):
        self.root = Path(root)
        manifest = json.loads((self.root / "manifest.json").read_text())
        self.tracks = [LibraryTrack.model_validate(t) for t in manifest["tracks"]]
        if not self.tracks:
            raise ProviderError("music library is empty")

    async def pick(self, mood: str, min_duration: float, exclude: list[str] | None = None) -> MusicResult:
        exclude = exclude or []
        pool = [t for t in self.tracks if t.license_id not in exclude and t.duration >= min_duration]
        by_mood = [t for t in pool if mood.lower() in (m.lower() for m in t.moods)]
        choices = by_mood or pool or self.tracks
        # deterministic per mood so reruns are idempotent
        t = random.Random(hashlib.sha256(mood.encode()).hexdigest()).choice(choices)
        return MusicResult(local_path=self.root / t.file, title=t.title, license_id=t.license_id,
                           duration=t.duration, format=Path(t.file).suffix.lstrip("."))


class EpidemicMusic:
    name = "music:epidemic"
    BASE = "https://partner-content-api.epidemicsound.com/v0"

    def __init__(self, api_key: str, client: httpx.AsyncClient | None = None):
        self.client = client or httpx.AsyncClient(timeout=60, headers={"Authorization": f"Bearer {api_key}"})

    async def pick(self, mood: str, min_duration: float, exclude: list[str] | None = None) -> MusicResult:
        exclude = exclude or []
        await bucket("music").acquire()
        r = await self.client.get(f"{self.BASE}/tracks/search", params={"term": mood, "limit": 25})
        r.raise_for_status()
        tracks = r.json().get("tracks", [])
        for t in tracks:
            tid = str(t["id"])
            dur = float(t.get("length") or t.get("durationMs", 0) / 1000 or 0)
            if tid in exclude or (dur and dur < min_duration):
                continue
            d = await self.client.get(f"{self.BASE}/tracks/{tid}/download", params={"format": "mp3"})
            d.raise_for_status()
            url = d.json().get("url")
            if not url:
                continue
            return MusicResult(url=url, title=t.get("title", tid), license_id=f"epidemic:{tid}", duration=dur)
        raise ProviderError(f"no epidemic track for mood {mood!r}")
