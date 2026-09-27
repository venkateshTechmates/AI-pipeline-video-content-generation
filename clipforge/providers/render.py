"""Renderers.

- `FfmpegRenderer`: in-process ffmpeg (M1): scale/crop clips per aspect, concat,
  word-highlight ASS captions, logo overlay, CTA card, VO + ducked music,
  loudnorm to -16 LUFS, H.264 30 fps.
- `RemotionRenderer`: enqueues a `render_jobs` row picked up by the Node
  render workers (`render/`) via FOR UPDATE SKIP LOCKED; overflows to
  Creatomate when the queue is deeper than the threshold.
- `CreatomateRenderer`: managed overflow renderer.
"""

from __future__ import annotations

import asyncio
import tempfile
import time
from pathlib import Path

import httpx

from .. import media
from ..captions import to_ass
from ..db import Repo
from ..models import ASPECT_SIZE, Aspect, RenderJob
from ..ratelimit import bucket
from ..render_spec import RenderResult, RenderResultItem, RenderSpec
from ..storage import AssetStore
from .base import ProviderError


def aspect_slug(a: Aspect) -> str:
    return a.value.replace(":", "x")


def _ass_cta(text: str, start: float, end: float, w: int, h: int, color: str) -> str:
    size = int(64 * w / 1080)
    from ..captions import _ass_color, _ass_time, _esc

    return (f"Dialogue: 1,{_ass_time(start)},{_ass_time(end)},Cap,,0,0,0,,"
            f"{{\\an2\\pos({w // 2},{int(h * 0.9)})\\fs{size}\\c{_ass_color(color)}\\fad(250,0)}}{_esc(text)}\n")


class FfmpegRenderer:
    name = "ffmpeg:render"

    def __init__(self, store: AssetStore, preset: str = "medium"):
        self.store = store
        self.preset = preset

    async def render(self, spec: RenderSpec) -> RenderResult:
        outs = await asyncio.gather(*(self._render_aspect(spec, a) for a in spec.aspects))
        return RenderResult(outputs=list(outs), renderer="ffmpeg")

    async def _render_aspect(self, spec: RenderSpec, aspect: Aspect) -> RenderResultItem:
        w, h = ASPECT_SIZE[aspect]
        with tempfile.TemporaryDirectory() as tmp:
            tmpd = Path(tmp)
            ass = to_ass(spec.words, spec.caption_style, w, h)
            if spec.brand.cta_text:
                ass += _ass_cta(spec.brand.cta_text, max(0.0, spec.duration - 2.5), spec.duration, w, h,
                                spec.brand.accent_color)
            (tmpd / "captions.ass").write_text(ass)

            args: list[str] = [media.ffmpeg(), "-y", "-hide_banner"]
            filters: list[str] = []
            for i, c in enumerate(spec.clips):
                args += ["-i", str(self.store.local_path(c.path))]
                src_dur = await media.duration(self.store.local_path(c.path))
                # Short source: slow it down up to 1.3x (invisible), then hold the last frame for any remainder.
                stretch = min(1.3, c.duration / src_dur) if src_dur < c.duration else 1.0
                pad = max(0.0, c.duration - src_dur * stretch)
                filters.append(
                    f"[{i}:v]trim=0:{min(c.duration, src_dur):.3f},setpts={stretch:.4f}*(PTS-STARTPTS),"
                    f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},fps={spec.fps},setsar=1,"
                    f"format=yuv420p" + (f",tpad=stop_mode=clone:stop_duration={pad:.3f}" if pad > 0.01 else "")
                    + f",trim=0:{c.duration:.3f},setpts=PTS-STARTPTS[v{i}]"
                )
            n = len(spec.clips)
            filters.append("".join(f"[v{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[vcat]")
            filters.append(f"[vcat]ass={tmpd / 'captions.ass'}[vcap]")
            last_v = "vcap"

            vo_idx = n
            args += ["-i", str(self.store.local_path(spec.audio.voice_path))]
            next_idx = n + 1
            filters.append(f"[{vo_idx}:a]aresample=44100,volume={spec.audio.voice_gain_db}dB,apad[vo]")
            if spec.audio.music_path:
                mu_idx = next_idx
                next_idx += 1
                args += ["-stream_loop", "-1", "-i", str(self.store.local_path(spec.audio.music_path))]
                filters.append("[vo]asplit=2[vo1][vosc]")
                filters.append(f"[{mu_idx}:a]aresample=44100,volume={spec.audio.music_gain_db}dB[mu]")
                # extra sidechain ducking while the VO speaks
                filters.append("[mu][vosc]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=300[duck]")
                filters.append("[vo1][duck]amix=inputs=2:duration=first:normalize=0[amixed]")
                last_a = "amixed"
            else:
                last_a = "vo"
            filters.append(f"[{last_a}]atrim=0:{spec.duration:.3f},loudnorm=I=-16:TP=-1.5:LRA=11[aout]")

            if spec.brand.logo_path:
                logo_idx = next_idx
                args += ["-i", str(self.store.local_path(spec.brand.logo_path))]
                lw = int(w * 0.18)
                filters.append(f"[{logo_idx}:v]scale={lw}:-1,format=rgba,colorchannelmixer=aa=0.9[logo]")
                filters.append(f"[{last_v}][logo]overlay=W-w-{int(w * 0.04)}:{int(h * 0.03)}[vlogo]")
                last_v = "vlogo"

            out = tmpd / f"{aspect_slug(aspect)}.mp4"
            args += [
                "-filter_complex", ";".join(filters), "-map", f"[{last_v}]", "-map", "[aout]",
                "-t", f"{spec.duration:.3f}", "-r", str(spec.fps),
                "-c:v", "libx264", "-preset", self.preset, "-crf", "20", "-pix_fmt", "yuv420p", "-profile:v", "high",
                "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-movflags", "+faststart", str(out),
            ]
            await media.run(args, timeout=1800)
            key = f"{spec.output_prefix}/{aspect_slug(aspect)}.mp4"
            self.store.put_file(key, out, "video/mp4")
            dur = await media.duration(out)
        return RenderResultItem(aspect=aspect, path=key, width=w, height=h, duration=dur)


class CreatomateRenderer:
    name = "creatomate:render"

    def __init__(self, api_key: str, store: AssetStore, client: httpx.AsyncClient | None = None):
        self.store = store
        self.client = client or httpx.AsyncClient(
            timeout=60, headers={"Authorization": f"Bearer {api_key}"})

    def _source(self, spec: RenderSpec, aspect: Aspect) -> dict:
        w, h = ASPECT_SIZE[aspect]
        st = spec.caption_style
        elements: list[dict] = [
            {"type": "video", "track": 1, "time": c.start, "duration": c.duration,
             "source": self.store.url(c.path), "fit": "cover"}
            for c in spec.clips
        ]
        elements.append({"name": "vo", "type": "audio", "track": 2, "time": 0,
                         "source": self.store.url(spec.audio.voice_path)})
        if spec.audio.music_path:
            vol = round(100 * 10 ** (spec.audio.music_gain_db / 20))
            elements.append({"type": "audio", "track": 3, "time": 0, "duration": spec.duration,
                             "source": self.store.url(spec.audio.music_path), "volume": f"{vol}%",
                             "loop": True, "audio_fade_out": 1})
        elements.append({
            "type": "text", "track": 4, "transcript_source": "vo", "transcript_effect": "highlight",
            "transcript_maximum_length": st.words_per_line * 8, "width": "86%", "height": "30%",
            "y_alignment": {"top": "10%", "center": "50%", "bottom": "85%"}[st.position],
            "font_family": st.font, "font_weight": "800", "font_size": f"{st.font_size * w / 1080:.0f} px",
            "fill_color": st.color, "stroke_color": st.stroke_color, "stroke_width": "1.2 vmin",
            "transcript_color": st.highlight_color,
            "text_transform": "uppercase" if st.uppercase else "none",
        })
        if spec.brand.logo_path:
            elements.append({"type": "image", "track": 5, "source": self.store.url(spec.brand.logo_path),
                             "x": "88%", "y": "6%", "width": "18%"})
        if spec.brand.cta_text:
            elements.append({"type": "text", "track": 6, "time": max(0, spec.duration - 2.5), "duration": 2.5,
                             "text": spec.brand.cta_text, "y": "88%", "fill_color": spec.brand.accent_color,
                             "font_family": spec.brand.font, "font_weight": "800"})
        return {"output_format": "mp4", "width": w, "height": h, "frame_rate": spec.fps,
                "duration": spec.duration, "elements": elements}

    async def render(self, spec: RenderSpec) -> RenderResult:
        outs = []
        for aspect in spec.aspects:
            await bucket("creatomate").acquire()
            r = await self.client.post("https://api.creatomate.com/v1/renders",
                                       json={"source": self._source(spec, aspect)})
            r.raise_for_status()
            job = r.json()[0]
            deadline = time.monotonic() + 900
            while job["status"] not in ("succeeded", "failed"):
                if time.monotonic() > deadline:
                    raise ProviderError(f"creatomate render {job['id']} timed out")
                await asyncio.sleep(5)
                g = await self.client.get(f"https://api.creatomate.com/v1/renders/{job['id']}")
                g.raise_for_status()
                job = g.json()
            if job["status"] != "succeeded":
                raise ProviderError(f"creatomate failed: {job.get('error_message')}")
            async with httpx.AsyncClient(timeout=300, follow_redirects=True) as dl:
                data = (await dl.get(job["url"])).content
            key = f"{spec.output_prefix}/{aspect_slug(aspect)}.mp4"
            self.store.put_bytes(key, data, "video/mp4")
            w, h = ASPECT_SIZE[aspect]
            outs.append(RenderResultItem(aspect=aspect, path=key, width=w, height=h, duration=spec.duration))
        return RenderResult(outputs=outs, renderer="creatomate")


class RemotionRenderer:
    name = "remotion:render"

    def __init__(self, repo: Repo, overflow: CreatomateRenderer | None = None, overflow_threshold: int = 20,
                 poll_s: float = 3.0, timeout_s: float = 1800):
        self.repo = repo
        self.overflow = overflow
        self.threshold = overflow_threshold
        self.poll_s = poll_s
        self.timeout_s = timeout_s

    async def render(self, spec: RenderSpec) -> RenderResult:
        if self.overflow and await self.repo.count_render_queue() >= self.threshold:
            return await self.overflow.render(spec)
        job = await self.repo.enqueue_render(RenderJob(run_id=spec.run_id, spec=spec.model_dump(mode="json")))
        deadline = time.monotonic() + self.timeout_s
        while time.monotonic() < deadline:
            await asyncio.sleep(self.poll_s)
            j = await self.repo.get_render_job(job.id)
            if j.status == "done" and j.output:
                return RenderResult.model_validate(j.output)
            if j.status == "failed":
                raise ProviderError(f"remotion render failed: {j.error}")
        raise ProviderError(f"remotion render {job.id} timed out")
