"""OpenRouter video API (async): Kling v3.0 Std/Pro and other video models behind one OpenRouter key.

POST {base}/videos -> job id, then poll GET {base}/videos/{id} until completed and download the MP4.
Field names follow OpenRouter's video API; the parser accepts the common variants
(`video_url` / `output.video_url` / `output[0].url` / `data[0].url`) because the API is new.
"""

from __future__ import annotations

import base64
import math

import httpx

from ..ledger import price
from ..ratelimit import bucket
from .base import ProviderError, VideoRequest, VideoResult, styled_prompt
from .jobs import JobWaiter, get_waiter

BASE = "https://openrouter.ai/api/v1"

MODELS = {
    "kling-v3.0-pro": ("kwaivgi/kling-v3.0-pro", 15.0),
    "kling-v3.0-std": ("kwaivgi/kling-v3.0-std", 15.0),
}


def _video_url(j: dict) -> str | None:
    out = j.get("output")
    candidates = [j.get("video_url"), j.get("url")]
    if isinstance(out, dict):
        candidates += [out.get("video_url"), out.get("url")]
    if isinstance(out, list) and out:
        candidates.append(out[0].get("url") if isinstance(out[0], dict) else out[0])
    data = j.get("data")
    if isinstance(data, list) and data and isinstance(data[0], dict):
        candidates.append(data[0].get("url"))
    return next((c for c in candidates if isinstance(c, str) and c.startswith("http")), None)


class OpenRouterVideo:
    supported_durations = None  # 3-15 s, any whole second

    def __init__(self, api_key: str, model: str = "kling-v3.0-pro", waiter: JobWaiter | None = None,
                 client: httpx.AsyncClient | None = None, poll_interval: float = 10.0):
        self.poll_interval = poll_interval
        self.slug, self.max_clip_seconds = MODELS.get(model, (model, 10.0))
        self.name = f"openrouter:{model}"
        self.headers = {"Authorization": f"Bearer {api_key}"}
        self.waiter = waiter or get_waiter()
        self.client = client or httpx.AsyncClient(timeout=120)

    def estimate(self, seconds: float) -> float:
        return max(3, math.ceil(seconds)) * price(self.name)

    async def generate(self, req: VideoRequest) -> VideoResult:
        dur = int(min(self.max_clip_seconds, max(3, math.ceil(req.duration))))
        body: dict = {"model": self.slug, "prompt": styled_prompt(req), "duration": dur,
                      "aspect_ratio": req.aspect.value, "generate_audio": req.generate_audio}
        if req.negative_prompt:
            body["negative_prompt"] = req.negative_prompt
        if req.image_url:
            body["image"] = req.image_url  # image-to-video (first frame)
        elif req.image_path:
            b64 = base64.b64encode(req.image_path.read_bytes()).decode()
            body["image"] = f"data:image/{req.image_path.suffix.lstrip('.') or 'png'};base64,{b64}"
        if req.seed is not None:
            body["seed"] = req.seed
        await bucket("openrouter").acquire()
        r = await self.client.post(f"{BASE}/videos", json=body, headers=self.headers)
        if r.status_code in (400, 401, 402, 403, 422):
            from ..retry import PermanentError

            raise PermanentError(f"openrouter video rejected ({r.status_code}): {r.text[:400]}")
        r.raise_for_status()
        job = r.json()
        jid = job.get("id") or job.get("job_id")
        if not jid:
            raise ProviderError(f"openrouter returned no job id: {job}")
        poll_url = job.get("polling_url") or f"{BASE}/videos/{jid}"

        async def poll() -> dict | None:
            s = await self.client.get(poll_url, headers=self.headers)
            s.raise_for_status()
            j = s.json()
            st = str(j.get("status", "")).lower()
            if st in ("completed", "succeeded", "success", "done"):
                return j
            if st in ("failed", "error", "cancelled", "canceled"):
                raise ProviderError(f"openrouter video {jid} {st}: {j.get('error')}")
            return None

        done = await self.waiter.wait(jid, poll, poll_interval=self.poll_interval)
        url = _video_url(done)
        if not url:
            raise ProviderError(f"openrouter video {jid} finished without a video URL: {str(done)[:300]}")
        return VideoResult(url=url, duration=float(dur), model=self.slug, billable_seconds=float(dur),
                           request_id=jid)
