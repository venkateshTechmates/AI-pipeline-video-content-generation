"""Google Veo 3.1 (premium tier): native 9:16, native audio, long single shots.

Two transports:
- Gemini API / AI Studio (`GOOGLE_API_KEY`): models/<model>:predictLongRunning
- Vertex AI (`GOOGLE_PROJECT` + ADC via google-auth): publishers/google/models/<model>:predictLongRunning
Both return a long-running operation that we poll (no webhooks).
"""

from __future__ import annotations

import base64
import math

import httpx

from ..ledger import price
from ..ratelimit import bucket
from .base import ProviderError, VideoRequest, VideoResult, styled_prompt
from .jobs import JobWaiter, get_waiter

GEMINI = "https://generativelanguage.googleapis.com/v1beta"

VEO_MODELS = {
    "veo-3.1": "veo-3.1-generate-preview",
    "veo-3.1-fast": "veo-3.1-fast-generate-preview",
    "veo-3.1-lite": "veo-3.1-lite-generate-preview",
}


class VeoVideo:
    supported_durations = (4.0, 6.0, 8.0)

    def __init__(self, *, variant: str = "veo-3.1", api_key: str | None = None, project: str | None = None,
                 location: str = "us-central1", gcs_output_uri: str | None = None,
                 waiter: JobWaiter | None = None, client: httpx.AsyncClient | None = None):
        if not api_key and not project:
            raise ValueError("Veo needs GOOGLE_API_KEY or GOOGLE_PROJECT")
        import os

        self.variant = variant
        # Google renames preview models; override with e.g. VEO_MODEL_VEO_3_1_LITE=veo-3.1-lite-generate-001
        self.model = os.environ.get(f"VEO_MODEL_{variant.upper().replace('-', '_').replace('.', '_')}",
                                    VEO_MODELS[variant])
        self.name = f"vertex:{variant}"
        # Veo 3.1 scene extension reaches ~60 s; single request is up to 8 s.
        self.max_clip_seconds = 8.0
        self.api_key, self.project, self.location = api_key, project, location
        self.gcs_output_uri = gcs_output_uri
        self.waiter = waiter or get_waiter()
        self.client = client or httpx.AsyncClient(timeout=120)

    def estimate(self, seconds: float) -> float:
        n = math.ceil(seconds / self.max_clip_seconds)
        return n * self._snap(seconds / n) * price(self.name)

    def _snap(self, want: float) -> float:
        for d in self.supported_durations:
            if d >= want - 0.25:
                return d
        return self.supported_durations[-1]

    async def _vertex_headers(self) -> dict[str, str]:
        try:
            import google.auth
            import google.auth.transport.requests
        except ImportError as e:  # pragma: no cover
            raise ProviderError("Vertex transport needs `pip install google-auth`") from e
        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        creds.refresh(google.auth.transport.requests.Request())
        return {"Authorization": f"Bearer {creds.token}"}

    async def generate(self, req: VideoRequest) -> VideoResult:
        dur = self._snap(req.duration)
        instance: dict = {"prompt": styled_prompt(req)}
        if req.image_path:
            instance["image"] = {
                "bytesBase64Encoded": base64.b64encode(req.image_path.read_bytes()).decode(),
                "mimeType": "image/png" if req.image_path.suffix == ".png" else "image/jpeg",
            }
        params: dict = {
            "aspectRatio": req.aspect.value if req.aspect.value in ("9:16", "16:9") else "9:16",
            "durationSeconds": int(dur),
            "generateAudio": req.generate_audio,
            "sampleCount": 1,
        }
        if req.negative_prompt:
            params["negativePrompt"] = req.negative_prompt
        # Veo 3.1 reference images keep the same characters/products across shots; a first-frame image
        # (image-to-video) takes precedence when both are given.
        if req.reference_images and not req.image_path:
            params["referenceImages"] = [
                {"image": {"bytesBase64Encoded": base64.b64encode(p.read_bytes()).decode(),
                           "mimeType": "image/png" if p.suffix == ".png" else "image/jpeg"},
                 "referenceType": "asset"}
                for p in req.reference_images[:3]]
        if req.seed is not None:
            params["seed"] = req.seed
        body = {"instances": [instance], "parameters": params}

        await bucket("vertex").acquire()
        if self.api_key:
            headers = {"x-goog-api-key": self.api_key}
            r = await self.client.post(f"{GEMINI}/models/{self.model}:predictLongRunning", json=body,
                                       headers=headers)
        else:
            headers = await self._vertex_headers()
            if self.gcs_output_uri:
                params["storageUri"] = self.gcs_output_uri
            base = (f"https://{self.location}-aiplatform.googleapis.com/v1/projects/{self.project}"
                    f"/locations/{self.location}/publishers/google/models/{self.model}")
            r = await self.client.post(f"{base}:predictLongRunning", json=body, headers=headers)
        if r.status_code in (400, 403):
            from ..retry import PermanentError

            raise PermanentError(f"veo rejected request: {r.text[:500]}")
        r.raise_for_status()
        op = r.json()["name"]

        async def poll() -> dict | None:
            if self.api_key:
                s = await self.client.get(f"{GEMINI}/{op}", headers=headers)
            else:
                s = await self.client.post(
                    f"{base}:fetchPredictOperation", json={"operationName": op}, headers=headers)
            s.raise_for_status()
            j = s.json()
            return j if j.get("done") else None

        done = await self.waiter.wait(op, poll, poll_interval=10)
        if "error" in done:
            raise ProviderError(f"veo failed: {done['error']}")
        resp = done.get("response", {})
        samples = (resp.get("generateVideoResponse") or {}).get("generatedSamples") or resp.get("videos") or []
        if not samples:
            filtered = resp.get("raiMediaFilteredReasons") or resp.get("generateVideoResponse", {}).get(
                "raiMediaFilteredReasons")
            from ..retry import PermanentError

            raise PermanentError(f"veo returned no video (filtered: {filtered})")
        v = samples[0].get("video", samples[0])
        if v.get("bytesBase64Encoded"):
            data = base64.b64decode(v["bytesBase64Encoded"])
            return VideoResult(data=data, duration=dur, model=self.model, billable_seconds=dur, request_id=op)
        uri = v.get("uri") or v.get("gcsUri")
        if uri and uri.startswith("gs://"):
            raise ProviderError("gs:// outputs need GCS download; configure API-key transport or signed URLs")
        if self.api_key and uri:
            dl = await self.client.get(uri, headers=headers, follow_redirects=True)
            dl.raise_for_status()
            return VideoResult(data=dl.content, duration=dur, model=self.model, billable_seconds=dur,
                               request_id=op)
        return VideoResult(url=uri, duration=dur, model=self.model, billable_seconds=dur, request_id=op)
