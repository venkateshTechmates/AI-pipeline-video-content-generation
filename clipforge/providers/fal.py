"""fal.ai queue adapter: Kling 3.0 (default), Seedance and Hailuo (fallbacks).

Queue API: POST https://queue.fal.run/<model>?fal_webhook=<url> -> request_id,
then status/response URLs. Completion arrives via webhook (fast path) or polling.
"""

from __future__ import annotations

import base64
import math
from dataclasses import dataclass

import httpx

from ..ledger import price
from ..models import Aspect
from ..ratelimit import bucket
from .base import ProviderError, VideoRequest, VideoResult
from .jobs import JobWaiter, get_waiter

QUEUE = "https://queue.fal.run"


@dataclass(frozen=True)
class FalModel:
    key: str  # ledger key suffix
    t2v: str  # text-to-video endpoint
    i2v: str  # image-to-video endpoint
    durations: tuple[float, ...]
    max_seconds: float
    duration_as_str: bool = True
    supports_negative: bool = True


# Endpoint ids are configuration: override with FAL_MODEL_<KEY> env if fal renames them.
FAL_MODELS: dict[str, FalModel] = {
    "kling-3.0": FalModel("kling-3.0", "fal-ai/kling-video/v3/pro/text-to-video",
                          "fal-ai/kling-video/v3/pro/image-to-video", (5, 10), 10),
    "seedance": FalModel("seedance", "fal-ai/bytedance/seedance/v1/pro/text-to-video",
                         "fal-ai/bytedance/seedance/v1/pro/image-to-video", (5, 10), 10,
                         supports_negative=False),
    "hailuo": FalModel("hailuo", "fal-ai/minimax/hailuo-02/standard/text-to-video",
                       "fal-ai/minimax/hailuo-02/standard/image-to-video", (6, 10), 10,
                       supports_negative=False),
}


def snap_duration(want: float, allowed: tuple[float, ...]) -> float:
    """Smallest allowed duration >= want (clips are trimmed in render), else the max."""
    for d in sorted(allowed):
        if d >= want - 0.25:
            return d
    return max(allowed)


class FalVideo:
    def __init__(self, api_key: str, model: str = "kling-3.0", waiter: JobWaiter | None = None,
                 client: httpx.AsyncClient | None = None):
        import os

        m = FAL_MODELS[model]
        override_t2v = os.environ.get(f"FAL_MODEL_{model.upper().replace('-', '_').replace('.', '_')}")
        if override_t2v:
            m = FalModel(m.key, override_t2v, override_t2v.replace("text-to-video", "image-to-video"),
                         m.durations, m.max_seconds, m.duration_as_str, m.supports_negative)
        self.m = m
        self.name = f"fal:{m.key}"
        self.max_clip_seconds = m.max_seconds
        self.supported_durations = m.durations
        self.api_key = api_key
        self.waiter = waiter or get_waiter()
        self.client = client or httpx.AsyncClient(timeout=60)

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Key {self.api_key}"}

    def estimate(self, seconds: float) -> float:
        n = math.ceil(seconds / self.max_clip_seconds)
        return snap_duration(seconds / n, self.supported_durations) * n * price(self.name)

    async def generate(self, req: VideoRequest) -> VideoResult:
        dur = snap_duration(req.duration, self.m.durations)
        endpoint = self.m.i2v if (req.image_url or req.image_path) else self.m.t2v
        body: dict = {
            "prompt": req.prompt,
            "duration": str(int(dur)) if self.m.duration_as_str else dur,
            "aspect_ratio": req.aspect.value,
        }
        if self.m.supports_negative and req.negative_prompt:
            body["negative_prompt"] = req.negative_prompt
        if req.image_url:
            body["image_url"] = req.image_url
        elif req.image_path:
            b64 = base64.b64encode(req.image_path.read_bytes()).decode()
            body["image_url"] = f"data:image/{req.image_path.suffix.lstrip('.') or 'png'};base64,{b64}"
        if req.seed is not None:
            body["seed"] = req.seed
        if req.aspect != Aspect.vertical and "image_url" in body:
            body.pop("aspect_ratio")  # i2v follows the reference frame

        await bucket("fal").acquire()
        params = {"fal_webhook": req.webhook_url} if req.webhook_url else None
        r = await self.client.post(f"{QUEUE}/{endpoint}", json=body, headers=self.headers, params=params)
        if r.status_code in (400, 422):
            from ..retry import PermanentError

            raise PermanentError(f"fal rejected request: {r.text[:500]}")
        r.raise_for_status()
        sub = r.json()
        rid = sub["request_id"]
        status_url = sub.get("status_url") or f"{QUEUE}/{endpoint}/requests/{rid}/status"
        response_url = sub.get("response_url") or f"{QUEUE}/{endpoint}/requests/{rid}"

        async def poll() -> dict | None:
            s = await self.client.get(status_url, headers=self.headers)
            s.raise_for_status()
            st = s.json().get("status")
            if st == "COMPLETED":
                res = await self.client.get(response_url, headers=self.headers)
                res.raise_for_status()
                return {"status": "OK", "payload": res.json()}
            if st in ("FAILED", "ERROR"):
                return {"status": "ERROR", "error": s.text}
            return None

        done = await self.waiter.wait(rid, poll)
        if done.get("status") not in ("OK", "COMPLETED"):
            raise ProviderError(f"fal job {rid} failed: {done.get('error') or done}")
        payload = done.get("payload") or done
        url = (payload.get("video") or {}).get("url")
        if not url:
            raise ProviderError(f"fal job {rid} returned no video: {payload}")
        return VideoResult(url=url, duration=dur, model=endpoint, billable_seconds=dur, request_id=rid)
