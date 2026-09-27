"""Local procedural animation (Remotion `scene` composition in `render/`): real animated shots with
illustrated characters and settings, generated from each shot prompt. No API key, no per-second cost.

Used as the video provider when `VIDEO_PROVIDER=animated`, and as the last fallback in the video chains
when `ANIMATION_FALLBACK=true` (or when no AI video key is configured at all).

Shots of one run arrive in parallel (LangGraph fan-out); they are collected for a short window and
rendered in one CLI call so the bundle and browser start once per batch.
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .. import media
from ..models import ASPECT_SIZE
from .base import ProviderError, VideoRequest, VideoResult

DEFAULT_RENDER_DIR = Path(__file__).resolve().parents[2] / "render"


@dataclass
class _Job:
    req: VideoRequest
    out: Path
    fut: asyncio.Future[bytes]


class AnimatedVideo:
    name = "local:animation"
    supported_durations = None
    max_clip_seconds = 10.0

    def __init__(self, render_dir: Path | None = None, scale: float = 2 / 3, batch_window_s: float = 1.0,
                 timeout_s: float = 1800):
        self.render_dir = Path(render_dir or DEFAULT_RENDER_DIR)
        self.scale = scale  # 1080x1920 * 2/3 = 720x1280; the renderer upscales
        self.window = batch_window_s
        self.timeout = timeout_s
        self._pending: list[_Job] = []
        self._lock = asyncio.Lock()
        self._flush_task: asyncio.Task | None = None
        self._tmp = Path(tempfile.mkdtemp(prefix="clipforge-anim-"))

    def estimate(self, seconds: float) -> float:
        return 0.0

    async def generate(self, req: VideoRequest) -> VideoResult:
        loop = asyncio.get_running_loop()
        job = _Job(req, self._tmp / f"clip-{os.urandom(6).hex()}.mp4", loop.create_future())
        async with self._lock:
            self._pending.append(job)
            if self._flush_task is None or self._flush_task.done():
                self._flush_task = asyncio.create_task(self._flush_later())
        data = await job.fut
        return VideoResult(data=data, duration=req.duration, model="remotion-scene",
                           billable_seconds=req.duration, request_id=job.out.stem)

    async def _flush_later(self) -> None:
        await asyncio.sleep(self.window)
        async with self._lock:
            batch, self._pending = self._pending, []
        if batch:
            await self._render(batch)

    async def _render(self, batch: list[_Job]) -> None:
        jobs = []
        for j in batch:
            w, h = ASPECT_SIZE[j.req.aspect]
            jobs.append({
                "prompt": j.req.prompt, "seed": int(j.req.seed or 0) % 2**31,
                "durationInSeconds": round(j.req.duration, 3),
                "width": int(w * self.scale) // 2 * 2, "height": int(h * self.scale) // 2 * 2,
                "out": str(j.out),
            })
        spec = self._tmp / f"jobs-{os.urandom(4).hex()}.json"
        spec.write_text(json.dumps(jobs))
        err: Exception | None = None
        try:
            await media.run(["npm", "run", "--silent", "--prefix", str(self.render_dir), "scene", "--",
                             "--jobs", str(spec)], timeout=self.timeout)
        except Exception as e:  # noqa: BLE001
            err = e
        for j in batch:
            if j.out.exists() and j.out.stat().st_size > 0:
                j.fut.set_result(j.out.read_bytes())
                j.out.unlink(missing_ok=True)
            else:
                j.fut.set_exception(ProviderError(f"animation render failed for {j.req.prompt[:60]!r}: {err}"))
        spec.unlink(missing_ok=True)
