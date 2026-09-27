"""Replicate adapter (secondary aggregator)."""

from __future__ import annotations

import math

import httpx

from ..ledger import price
from ..ratelimit import bucket
from .base import ProviderError, VideoRequest, VideoResult
from .jobs import JobWaiter, get_waiter

API = "https://api.replicate.com/v1"

REPLICATE_MODELS = {
    "kling-3.0": "kwaivgi/kling-v3.0",
}


class ReplicateVideo:
    supported_durations = (5.0, 10.0)
    max_clip_seconds = 10.0

    def __init__(self, token: str, model: str = "kling-3.0", waiter: JobWaiter | None = None,
                 client: httpx.AsyncClient | None = None):
        self.slug = REPLICATE_MODELS.get(model, model)
        self.name = f"replicate:{model}"
        self.headers = {"Authorization": f"Bearer {token}"}
        self.waiter = waiter or get_waiter()
        self.client = client or httpx.AsyncClient(timeout=60)

    def estimate(self, seconds: float) -> float:
        return math.ceil(seconds / 5) * 5 * price(self.name)

    async def generate(self, req: VideoRequest) -> VideoResult:
        dur = 5.0 if req.duration <= 5.25 else 10.0
        inp: dict = {"prompt": req.prompt, "duration": int(dur), "aspect_ratio": req.aspect.value}
        if req.negative_prompt:
            inp["negative_prompt"] = req.negative_prompt
        if req.image_url:
            inp["start_image"] = req.image_url
        body: dict = {"input": inp}
        if req.webhook_url:
            body["webhook"] = req.webhook_url
            body["webhook_events_filter"] = ["completed"]
        await bucket("replicate").acquire()
        r = await self.client.post(f"{API}/models/{self.slug}/predictions", json=body, headers=self.headers)
        r.raise_for_status()
        pred = r.json()
        pid = pred["id"]

        async def poll() -> dict | None:
            s = await self.client.get(f"{API}/predictions/{pid}", headers=self.headers)
            s.raise_for_status()
            j = s.json()
            return j if j["status"] in ("succeeded", "failed", "canceled") else None

        done = await self.waiter.wait(pid, poll, poll_interval=10)
        if done.get("status") != "succeeded":
            raise ProviderError(f"replicate {pid} {done.get('status')}: {done.get('error')}")
        out = done.get("output")
        url = out[0] if isinstance(out, list) else out
        return VideoResult(url=url, duration=dur, model=self.slug, billable_seconds=dur, request_id=pid)
