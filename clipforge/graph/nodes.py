"""Pipeline nodes (PRD §7). Each node is idempotent: outputs are content-addressed in
the asset store, and a re-run with the same inputs reuses them instead of paying twice."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import tempfile
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
from langgraph.errors import GraphBubbleUp
from langgraph.types import Command, Send, interrupt

from .. import media, tracing
from ..agents.llm import LLMBackend
from ..captions import segments_to_srt, segments_to_vtt, subtitle_segments
from ..config import Settings
from ..db import Repo
from ..dedupe import filter_hooks
from ..ledger import CostLedger
from ..models import (
    ASPECT_SIZE,
    ApprovalDecision,
    Aspect,
    Asset,
    Brand,
    Clip,
    Decision,
    Hook,
    MusicTrack,
    Platform,
    PlatformMetadata,
    PostRecord,
    QAReport,
    RunStatus,
    Script,
    ScriptPackage,
    ShotList,
    StageRecord,
    StageStatus,
    Tier,
    VoiceOver,
    utcnow,
)
from ..platforms import PLATFORM_LIMITS, fit_metadata, missing_options
from ..providers.base import PublishRequest, VideoRequest, VideoResult
from ..providers.registry import Providers
from ..qa import run_qa
from ..ratelimit import PostingQuota
from ..render_spec import BrandOverlay, RenderAudio, RenderClip, RenderSpec
from ..retry import PermanentError, retry_async, with_fallback
from ..schedule import next_slot
from ..storage import AssetStore, content_key, sha256_bytes, sha256_file
from ..timeline import plan_timeline
from .state import RESET, RunState, clear_from

log = logging.getLogger(__name__)

VO_TAIL_S = 0.6  # breathing room after the last word


@dataclass
class Deps:
    settings: Settings
    repo: Repo
    store: AssetStore
    providers: Providers
    llm: LLMBackend
    ledger: CostLedger
    quota: PostingQuota = field(default_factory=PostingQuota)


@dataclass
class StageCtx:
    deps: Deps
    run_id: str
    brand_id: str
    stage: str
    cost: float = 0.0
    providers: list[str] = field(default_factory=list)

    async def charge(self, provider: str, units: float, unit_cost: float | None = None) -> None:
        e = await self.deps.ledger.charge(run_id=self.run_id, brand_id=self.brand_id, stage=self.stage,
                                          provider=provider, units=units, unit_cost=unit_cost)
        self.cost += e.total
        if provider not in self.providers:
            self.providers.append(provider)

    async def charge_llm(self, tokens: int) -> None:
        st = self.deps.settings
        offline = (st.llm_mode or st.provider_mode) == "fake"
        prov = "fake:llm" if offline else f"{st.llm_model.split(':')[0]}:llm"
        if tokens:
            await self.charge(prov, tokens / 1_000_000)
        elif prov not in self.providers:  # offline fakes: record who ran the stage even at $0
            self.providers.append(prov)

    async def asset(self, type_: str, key: str, sha: str, **meta: Any) -> None:
        await self.deps.repo.add_asset(Asset(run_id=self.run_id, type=type_, storage_path=key, sha256=sha,
                                             meta=meta))


async def _snapshot(deps: Deps, run_id: str, update: dict[str, Any] | None) -> None:
    if not update:
        return
    state = await deps.repo.get_run_state(run_id)
    for k, v in update.items():
        if k == "clips":
            v = [c for c in (v or []) if c != RESET] if v is not None else []
            if v and state.get("clips"):
                merged = {c["index"]: c for c in state["clips"]}
                merged.update({c["index"]: c for c in v})
                v = [merged[i] for i in sorted(merged)]
        state[k] = v
    await deps.repo.set_run_state(run_id, state)


async def _stage_start(deps: Deps, run_id: str, name: str) -> StageRecord:
    rec = await deps.repo.get_stage(run_id, name) or StageRecord(run_id=run_id, name=name)
    rec.status = StageStatus.running
    rec.attempt += 1
    rec.started_at, rec.ended_at, rec.error = utcnow(), None, None
    await deps.repo.upsert_stage(rec)
    return rec


async def _stage_end(deps: Deps, rec: StageRecord, status: StageStatus, *, error: str | None = None,
                     cost: float | None = None, provider: str | None = None, output_ref: str | None = None) -> None:
    rec.status, rec.error, rec.ended_at = status, error, utcnow()
    if cost is not None:
        rec.cost = round(cost, 4)
    if provider:
        rec.provider = provider
    if output_ref:
        rec.output_ref = output_ref
    await deps.repo.upsert_stage(rec)


def tracked(deps: Deps, name: str):
    """Stage bookkeeping (stages table), OTel span, state snapshot for the review UI."""

    def deco(fn):
        async def node(state: RunState):
            run_id = state["run_id"]
            rec = await _stage_start(deps, run_id, name)
            ctx = StageCtx(deps, run_id, state["brand_id"], name)
            try:
                async with tracing.span(name, kind="stage", attempt=rec.attempt, language=state.get("language")):
                    out = await fn(state, ctx)
            except GraphBubbleUp:  # interrupt(): waiting for a human, not a failure
                await _stage_end(deps, rec, StageStatus.pending, cost=ctx.cost)
                rec.ended_at = None
                await deps.repo.upsert_stage(rec)
                raise
            except Exception as e:
                await _stage_end(deps, rec, StageStatus.failed, error=f"{type(e).__name__}: {e}"[:2000],
                                 cost=ctx.cost, provider=",".join(ctx.providers) or None)
                raise
            update = out.update if isinstance(out, Command) else out
            await _stage_end(deps, rec, StageStatus.succeeded, cost=ctx.cost,
                             provider=",".join(ctx.providers) or None,
                             output_ref=(update or {}).get("_output_ref") if isinstance(update, dict) else None)
            if isinstance(update, dict):
                update.pop("_output_ref", None)
                await _snapshot(deps, run_id, update)
            return out

        node.__name__ = name
        return node

    return deco


async def _fetch(result: VideoResult | Any) -> bytes:
    if getattr(result, "data", None):
        return result.data
    if getattr(result, "local_path", None):
        return Path(result.local_path).read_bytes()
    async with httpx.AsyncClient(timeout=300, follow_redirects=True) as c:
        r = await c.get(result.url)
        r.raise_for_status()
        return r.content


def _stable_hash(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()


# =========================================================================== nodes


def build_nodes(deps: Deps) -> dict[str, Any]:
    repo, store, providers, llm, settings = deps.repo, deps.store, deps.providers, deps.llm, deps.settings

    # ------------------------------------------------------------------ 1 ideate
    @tracked(deps, "ideate")
    async def ideate(state: RunState, ctx: StageCtx):
        brand = await repo.get_brand(state["brand_id"])
        since = utcnow() - timedelta(days=settings.dedupe_days)
        history = await repo.recent_hooks(brand.id, since, exclude_run_id=state["run_id"])
        texts = [t for t, _ in history] + list(state.get("rejected_hooks") or [])
        missing = [t for t, e in history if not e] + list(state.get("rejected_hooks") or [])
        vecs = [e for _, e in history if e] + (await llm.embed(missing) if missing else [])

        kept: list[tuple[Hook, float]] = []
        for attempt in range(2):
            ideas, tok = await llm.ideate(brand.kit, state.get("brief"), texts, n=5 + 3 * attempt,
                                          language=_lang(state))
            await ctx.charge_llm(tok)
            hook_vecs = await llm.embed([h.text for h in ideas.hooks])
            kept = filter_hooks(ideas.hooks, hook_vecs, vecs, brand.kit.banned_topics, settings.dedupe_threshold)
            if kept:
                break
            texts += [h.text for h in ideas.hooks]
        if not kept:
            raise PermanentError("no novel hook (all duplicates of the last 90 days or banned)")
        pick = kept[0][0]
        await repo.add_hook(brand.id, state["run_id"], pick.text, (await llm.embed([pick.text]))[0])
        return {"hooks": [h.model_dump() | {"similarity": round(s, 3)} for h, s in kept[:5]],
                "hook": pick.model_dump()}

    # ------------------------------------------------------------------ 2 script + shots
    @tracked(deps, "script")
    async def script(state: RunState, ctx: StageCtx):
        brand = await repo.get_brand(state["brand_id"])
        tier = Tier(state["tier"])
        chain = providers.video_chain(tier)
        hook = Hook.model_validate(state["hook"])
        pkg: ScriptPackage | None = None
        for _ in range(2):
            pkg, tok = await llm.script(brand.kit, hook, state.get("brief"), tier, chain[0].max_clip_seconds,
                                        language=_lang(state))
            await ctx.charge_llm(tok)
            text = "\n".join([pkg.script.vo_text, *(s.prompt for s in pkg.shot_list.shots)])
            mod, tok = await llm.moderate_text(text, brand.kit.banned_topics)
            await ctx.charge_llm(tok)
            if mod.safe:
                break
            log.warning("script moderation failed (%s), retrying", mod.reason)
            pkg = None
        if pkg is None:
            raise PermanentError("script failed prompt moderation twice")
        neg = ", ".join(brand.kit.negative_prompts)
        ref = brand.kit.reference_images[0] if brand.kit.consistency == "reference" and brand.kit.reference_images \
            else None
        for s in pkg.shot_list.shots:
            s.negative_prompt = ", ".join(x for x in (neg, s.negative_prompt) if x)
            s.ref_image = s.ref_image or ref
        return {"script": pkg.script.model_dump(), "shot_list": pkg.shot_list.model_dump()}

    # ------------------------------------------------------------------ 3 tts
    @tracked(deps, "tts")
    async def tts(state: RunState, ctx: StageCtx):
        brand = await repo.get_brand(state["brand_id"])
        sc = Script.model_validate(state["script"])
        lang = _lang(state)
        res, prov = await with_fallback(
            providers.tts, lambda p: p.synthesize(sc.vo_text, brand.kit.voice_for(lang), lang), kind="tts")
        await ctx.charge(prov.name, res.characters / 1000)
        with tempfile.TemporaryDirectory() as d:
            raw = Path(d) / f"raw.{res.format}"
            raw.write_bytes(res.audio)
            norm = await media.normalize_loudness(raw, Path(d) / "vo.mp3", -16.0)
            sha = sha256_file(norm)
            key = content_key(state["run_id"], "vo", sha, ".mp3")
            store.put_file(key, norm, "audio/mpeg")
            dur = await media.duration(norm)
            lufs = (await media.loudness(norm))["lufs"]
        await ctx.asset("voiceover", key, sha, provider=prov.name, duration=dur)
        vo = VoiceOver(audio_path=key, duration=dur, words=res.words, lufs=lufs)

        # Timeline: fit shots to the real VO length, choosing billable clip lengths (see timeline.py).
        shots = ShotList.model_validate(state["shot_list"]).shots
        total = max(dur, res.words[-1].end if res.words else dur) + VO_TAIL_S
        primary = providers.video_chain(Tier(state["tier"]))[0]
        infos = [{"shot_index": s.index, "prompt": s.prompt, "negative_prompt": s.negative_prompt,
                  "ref_image": s.ref_image, "length": s.duration} for s in shots]
        return {"vo": vo.model_dump(), "timeline": build_timeline(infos, total, primary), "_output_ref": key}

    # ------------------------------------------------------------------ 4 gen_shots (fan-out)
    def clip_key(run_id: str, seg: dict, ref_id: str | None, tier: Tier, nonce: int) -> tuple[str, str]:
        """Content address of a generated clip. `ref_id` identifies the reference frame: a kit image path, or
        (first_shot mode) the key of shot 0, so later shots' keys are known before the frame is extracted."""
        want = seg.get("billed") or math.ceil(seg["duration"])
        cache = _stable_hash({"p": seg["prompt"], "n": seg["negative_prompt"], "d": want, "r": ref_id,
                              "t": tier.value, "nonce": nonce})
        return f"runs/{run_id}/clips/{cache[:24]}.mp4", cache

    async def generate_clip(payload: dict[str, Any]) -> dict[str, Any]:
        run_id, tier = payload["run_id"], Tier(payload["tier"])
        seg = payload["segment"]
        chain = providers.video_chain(tier)
        want = seg.get("billed") or math.ceil(seg["duration"])
        ref = seg.get("ref_image") or payload.get("ref_frame")
        nonce = payload.get("nonce", 0)
        key, cache = clip_key(run_id, seg, seg.get("ref_image") or payload.get("ref_id"), tier, nonce)
        if store.exists(key):
            tracing.event("cache_hit", key=key)
            meta = json.loads(store.local_path(key + ".json").read_text()) if store.exists(key + ".json") else {}
            return Clip(shot_index=seg["index"], path=key, duration=meta.get("duration", want),
                        provider=meta.get("provider", "cache"), model=meta.get("model", "")).model_dump() | {
                "index": seg["index"]}

        await deps.ledger.ensure_budget(run_id=run_id, brand_id=payload["brand_id"], tier=tier,
                                        estimate=chain[0].estimate(want))
        req = VideoRequest(
            prompt=seg["prompt"], negative_prompt=seg["negative_prompt"],
            duration=min(want, chain[0].max_clip_seconds), aspect=Aspect.vertical,
            image_url=store.url(ref, 86400) if ref else None,
            image_path=store.local_path(ref) if ref else None,
            seed=(int(cache[:6], 16) + nonce) % 2**31,
            webhook_url=webhook_url(settings, "fal"),
        )

        async def call(p):
            return await p.generate(req.model_copy(update={"duration": min(req.duration, p.max_clip_seconds)}))

        res, prov = await with_fallback(chain, call, attempts_each=3, kind="video",
                                        base=0.01 if settings.provider_mode == "fake" else 1.0)
        data = await _fetch(res)
        store.put_bytes(key, data, "video/mp4")
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "c.mp4"
            p.write_bytes(data)
            real = await media.duration(p)
        store.put_bytes(key + ".json", json.dumps({"duration": real, "provider": prov.name,
                                                   "model": res.model}).encode())
        await deps.ledger.charge(run_id=run_id, brand_id=payload["brand_id"], stage="gen_shots",
                                 provider=prov.name, units=res.billable_seconds)
        await repo.add_asset(Asset(run_id=run_id, type="clip", storage_path=key, sha256=sha256_bytes(data),
                                   meta={"index": seg["index"], "provider": prov.name, "model": res.model,
                                         "prompt": seg["prompt"]}))
        return Clip(shot_index=seg["index"], path=key, duration=real, provider=prov.name,
                    model=res.model).model_dump() | {"index": seg["index"]}

    async def gen_shots(state: RunState):
        """Dispatcher: budget check (maybe downgrade tier), optional consistency frame, then parallel Send."""
        async with tracing.span("gen_shots", kind="stage", trace_id=state["run_id"],
                                shots=len(state.get("timeline") or [])):
            return await _gen_shots(state)

    async def _gen_shots(state: RunState):
        run_id = state["run_id"]
        rec = await _stage_start(deps, run_id, "gen_shots")
        try:
            tier = Tier(state["tier"])
            timeline = state["timeline"]
            brand = await repo.get_brand(state["brand_id"])
            nonce = (state.get("nonce") or {}).get("gen_shots", 0)
            first_shot = (brand.kit.consistency == "first_shot" and not timeline[0].get("ref_image")
                          and len(timeline) > 1)

            def ref_ids(t: Tier) -> list[str | None]:
                k0 = clip_key(run_id, timeline[0], None, t, nonce)[0]
                return [s.get("ref_image") or (k0 if first_shot and i else None) for i, s in enumerate(timeline)]

            def estimate(t: Tier) -> float:  # only clips not already in the content-addressed store cost money
                p = providers.video_chain(t)[0]
                return sum(p.estimate(s["billed"]) for s, r in zip(timeline, ref_ids(t), strict=True)
                           if not store.exists(clip_key(run_id, s, r, t, nonce)[0]))

            premium_est = estimate(tier)
            if tier != Tier.economy:  # what the same video would cost re-planned for the economy provider
                econ_tl = replan(timeline, providers.video_chain(Tier.economy)[0])
                p = providers.video_chain(Tier.economy)[0]
                econ_est = sum(p.estimate(s["billed"]) for s in econ_tl)
            else:
                econ_tl, econ_est = timeline, premium_est
            decision = await deps.ledger.ensure_budget(
                run_id=run_id, brand_id=state["brand_id"], tier=tier,
                estimate=premium_est, economy_estimate=econ_est)
            update: dict[str, Any] = {}
            if decision.downgraded:
                timeline = econ_tl
                update["timeline"] = timeline
                await _snapshot(deps, run_id, {"timeline": timeline})
            tier = decision.tier
            base = {"run_id": run_id, "brand_id": state["brand_id"], "tier": tier.value, "nonce": nonce}
            ref_id = ref_ids(tier)[1] if first_shot else None
            update["tier"] = tier.value
            first: list[dict] = []
            ref_frame = state.get("ref_frame")
            todo = list(timeline)
            if first_shot and not ref_frame:
                clip0 = await generate_clip({**base, "segment": timeline[0]})
                first = [clip0]
                with tempfile.TemporaryDirectory() as d:
                    src = store.local_path(clip0["path"])
                    frame = await media.extract_frame(src, min(1.0, clip0["duration"] / 2), Path(d) / "ref.png",
                                                      width=ASPECT_SIZE[Aspect.vertical][0])
                    sha = sha256_file(frame)
                    ref_frame = content_key(run_id, "ref", sha, ".png")
                    store.put_file(ref_frame, frame, "image/png")
                todo = timeline[1:]
            update["ref_frame"] = ref_frame
            update["clips"] = [RESET, *first]
            await _snapshot(deps, run_id, {"tier": tier.value, "ref_frame": ref_frame})
        except Exception as e:
            await _stage_end(deps, rec, StageStatus.failed, error=f"{type(e).__name__}: {e}"[:2000])
            raise
        if not todo:
            return Command(goto="collect_shots", update=update)
        return Command(goto=[Send("gen_shot", {**base, "segment": s, "ref_frame": ref_frame, "ref_id": ref_id})
                             for s in todo], update=update)

    async def gen_shot(payload: dict[str, Any]):
        try:
            async with tracing.span("gen_shot", kind="stage", trace_id=payload["run_id"],
                                    shot_index=payload["segment"]["index"], prompt=payload["segment"]["prompt"],
                                    seconds=payload["segment"].get("billed")):
                return {"clips": [await generate_clip(payload)]}
        except Exception as e:
            rec = await repo.get_stage(payload["run_id"], "gen_shots")
            if rec:
                await _stage_end(deps, rec, StageStatus.failed,
                                 error=f"shot {payload['segment']['index']}: {type(e).__name__}: {e}"[:2000])
            raise

    async def collect_shots(state: RunState):
        async with tracing.span("collect_shots", kind="stage", trace_id=state["run_id"]):
            return await _collect_shots(state)

    async def _collect_shots(state: RunState):
        run_id = state["run_id"]
        have = {c["index"] for c in state.get("clips") or []}
        want = {s["index"] for s in state["timeline"]}
        rec = await repo.get_stage(run_id, "gen_shots") or StageRecord(run_id=run_id, name="gen_shots")
        if want - have:
            await _stage_end(deps, rec, StageStatus.failed, error=f"missing clips {sorted(want - have)}")
            raise RuntimeError(f"missing clips {sorted(want - have)}")
        ledger = [e for e in await repo.list_ledger(run_id) if e.stage == "gen_shots"]
        provs = sorted({c["provider"] for c in state["clips"]})
        await _stage_end(deps, rec, StageStatus.succeeded, cost=sum(e.total for e in ledger),
                         provider=",".join(provs))
        await _snapshot(deps, run_id, {"clips": state["clips"]})
        return {}

    # ------------------------------------------------------------------ 5 music
    @tracked(deps, "music")
    async def music(state: RunState, ctx: StageCtx):
        if not providers.music:
            return {"music": None}
        sc = Script.model_validate(state["script"])
        vo = VoiceOver.model_validate(state["vo"])
        res, prov = await with_fallback(providers.music, lambda p: p.pick(sc.mood, vo.duration + VO_TAIL_S),
                                        kind="music")
        data = await _fetch(res)
        sha = sha256_bytes(data)
        key = content_key(state["run_id"], "music", sha, "." + (res.format or "mp3"))
        store.put_bytes(key, data, "audio/mpeg")
        await ctx.charge(prov.name if ":" in prov.name else "music:track", 1)
        await ctx.asset("music", key, sha, title=res.title, license_id=res.license_id, provider=prov.name)
        track = MusicTrack(path=key, title=res.title, license_id=res.license_id, provider=prov.name, duck_db=-12.0)
        return {"music": track.model_dump(), "_output_ref": key}

    async def make_subtitles(state: RunState, vo: VoiceOver, ctx: StageCtx) -> list[dict[str, Any]]:
        """Subtitle files (SRT + WebVTT): the narration language from word timings, plus translations of the
        same cues (same timing) for each requested subtitle language."""
        lang = _lang(state)
        segments = subtitle_segments(vo.words, 7, lang)
        out = []
        for target in [lang, *[x for x in state.get("subtitle_languages") or [] if x != lang]]:
            if target == lang:
                texts = [t for _, _, t in segments]
            else:
                texts, tok = await llm.translate([t for _, _, t in segments], lang, target)
                await ctx.charge_llm(tok)
            segs = [(a, b, t) for (a, b, _), t in zip(segments, texts, strict=True)]
            item: dict[str, Any] = {"language": target, "translated": target != lang}
            for ext, body in (("srt", segments_to_srt(segs)), ("vtt", segments_to_vtt(segs))):
                data = body.encode()
                sha = sha256_bytes(data)
                key = content_key(state["run_id"], f"subtitles/{target}", sha, f".{ext}")
                store.put_bytes(key, data, "text/vtt" if ext == "vtt" else "application/x-subrip")
                await ctx.asset(f"subtitle_{ext}", key, sha, language=target)
                item[ext] = key
            out.append(item)
        return out

    # ------------------------------------------------------------------ 6 render
    @tracked(deps, "render")
    async def render(state: RunState, ctx: StageCtx):
        brand = await repo.get_brand(state["brand_id"])
        sc = Script.model_validate(state["script"])
        vo = VoiceOver.model_validate(state["vo"])
        clips = {c["index"]: c for c in state["clips"]}
        timeline = state["timeline"]
        duration = round(timeline[-1]["start"] + timeline[-1]["duration"], 3)
        nonce = (state.get("nonce") or {}).get("render", 0)
        m = state.get("music")
        spec = RenderSpec(
            run_id=state["run_id"], template=brand.kit.template, duration=duration,
            clips=[RenderClip(path=clips[s["index"]]["path"], start=s["start"], duration=s["duration"])
                   for s in timeline],
            audio=RenderAudio(voice_path=vo.audio_path, music_path=m["path"] if m else None,
                              music_gain_db=m["duck_db"] if m else -12.0),
            words=vo.words, caption_style=brand.kit.caption_style, language=_lang(state),
            brand=BrandOverlay(logo_path=brand.kit.logo_path, primary_color=brand.kit.colors.get("primary", "#111"),
                               accent_color=brand.kit.colors.get("accent", "#FFD400"),
                               font=brand.kit.fonts[0] if brand.kit.fonts else "Inter", cta_text=sc.cta),
            output_prefix="",
        )
        # content-address the outputs by the full spec (clips, audio, captions, CTA, brand, template)
        spec_hash = _stable_hash([spec.model_dump(mode="json"), nonce])[:16]
        spec.output_prefix = f"runs/{state['run_id']}/render/{spec_hash}"
        renderer = providers.renderer
        async with tracing.span(f"render:{renderer.name}", kind="render", renderer=renderer.name,
                                aspects=len(spec.aspects), seconds=spec.duration, language=spec.language):
            result = await renderer.render(spec)
        await ctx.charge(f"{result.renderer}:render", len(result.outputs) if result.renderer == "creatomate" else 0)
        renders = []
        for o in result.outputs:
            sha = sha256_file(store.local_path(o.path))
            await ctx.asset("render", o.path, sha, aspect=o.aspect.value, width=o.width, height=o.height,
                            duration=o.duration, renderer=result.renderer)
            renders.append(o.model_dump(mode="json"))
        subtitles = await make_subtitles(state, vo, ctx)
        return {"renders": renders, "subtitles": subtitles, "_output_ref": renders[0]["path"]}

    # ------------------------------------------------------------------ 7 qa
    @tracked(deps, "qa")
    async def qa(state: RunState, ctx: StageCtx):
        brand = await repo.get_brand(state["brand_id"])
        vertical = next(r for r in state["renders"] if r["aspect"] == Aspect.vertical.value)
        vo = VoiceOver.model_validate(state["vo"])
        report, tok = await run_qa(
            store.local_path(vertical["path"]), words=vo.words, vo_duration=vo.duration,
            script=Script.model_validate(state["script"]), shot_list=ShotList.model_validate(state["shot_list"]),
            banned=brand.kit.banned_topics, llm=llm, expected_size=ASPECT_SIZE[Aspect.vertical],
        )
        await ctx.charge_llm(tok)
        return {"qa_report": report.model_dump_full()}

    # ------------------------------------------------------------------ 8 approve (interrupt)
    @tracked(deps, "approve")
    async def approve(state: RunState, ctx: StageCtx):
        brand = await repo.get_brand(state["brand_id"])
        report = QAReport.model_validate({"checks": state["qa_report"]["checks"]})
        auto = auto_approvable(brand, report)
        if auto:
            decision = ApprovalDecision(decision=Decision.approve, reviewer="auto", note="trust+qa rule")
        else:
            await repo.update_run(state["run_id"], status=RunStatus.awaiting_approval)
            payload = interrupt({"run_id": state["run_id"], "qa_score": report.score, "qa_passed": report.passed})
            decision = ApprovalDecision.model_validate(payload)
            await repo.record_review(brand.id, decision.decision == Decision.approve)
        await repo.update_run(state["run_id"], status=RunStatus.running)
        d = decision.model_dump(mode="json")
        nonce = dict(state.get("nonce") or {})

        if decision.decision == Decision.approve:
            return Command(goto="metadata", update={"decision": d, "auto_approved": auto})
        if decision.decision == Decision.reject:
            return Command(goto="finalize", update={"decision": d, "status": RunStatus.aborted.value})
        if decision.decision == Decision.regenerate:
            stage = decision.stage or "gen_shots"
            nonce[stage] = nonce.get(stage, 0) + 1
            upd = {**clear_from(stage), "decision": d, "nonce": nonce}
            if stage == "ideate" and state.get("hook"):
                upd["rejected_hooks"] = [*(state.get("rejected_hooks") or []), state["hook"]["text"]]
            return Command(goto=stage, update=upd)
        # edit: patch the script (and optionally the shot list), then redo VO and everything downstream
        patch = dict(decision.patch or {})
        shots_patch = patch.pop("shots", None)
        shot_list = state["shot_list"]
        if shots_patch is not None:
            brand = await repo.get_brand(state["brand_id"])
            neg = ", ".join(brand.kit.negative_prompts)
            old = ShotList.model_validate(state["shot_list"]).shots
            avg = sum(s.duration for s in old) / len(old)
            shot_list = ShotList.model_validate({"shots": [
                {"index": i, "prompt": (s["prompt"] if isinstance(s, dict) else str(s)),
                 "duration": float(s.get("duration", avg)) if isinstance(s, dict) else avg,
                 "negative_prompt": (s.get("negative_prompt") if isinstance(s, dict) else None) or neg}
                for i, s in enumerate(shots_patch)]}).model_dump()
        sc = Script.model_validate({**state["script"], **patch})
        if "beats" not in patch and "vo_text" in patch:
            sc.caption_text = patch.get("caption_text", sc.vo_text)
        upd = {**clear_from("tts"), "script": sc.model_dump(), "shot_list": shot_list, "decision": d,
               "nonce": nonce}
        await _snapshot(deps, state["run_id"], {"script": upd["script"], "shot_list": shot_list})
        return Command(goto="tts", update=upd)

    # ------------------------------------------------------------------ 9 metadata
    @tracked(deps, "metadata")
    async def metadata(state: RunState, ctx: StageCtx):
        brand = await repo.get_brand(state["brand_id"])
        sc = Script.model_validate(state["script"])
        platforms = [Platform(p) for p in state["platforms"]]
        bundle, tok = await llm.metadata(brand.kit, sc, platforms, language=_lang(state))
        await ctx.charge_llm(tok)
        by_p = {i.platform: i for i in bundle.items}

        vertical = next(r for r in state["renders"] if r["aspect"] == Aspect.vertical.value)
        src = store.local_path(vertical["path"])
        scores = await media.scene_scores(src, 8)
        t_best = max(scores, key=lambda x: x[1])[0] if scores else 1.0
        with tempfile.TemporaryDirectory() as d:
            thumb = await media.extract_frame(src, t_best, Path(d) / "thumb.jpg", width=1080)
            sha = sha256_file(thumb)
            thumb_key = content_key(state["run_id"], "thumb", sha, ".jpg")
            store.put_file(thumb_key, thumb, "image/jpeg")
        await ctx.asset("thumbnail", thumb_key, sha, time=t_best)

        out = []
        for p in platforms:
            c = by_p.get(p)
            title, desc, tags = fit_metadata(p, c.title if c else sc.title,
                                             c.description if c else f"{sc.hook} {sc.cta}",
                                             (c.hashtags if c else []) + brand.kit.hashtags)
            lim = PLATFORM_LIMITS[p]
            out.append(PlatformMetadata(
                platform=p, title=title, description=desc, hashtags=tags, thumbnail_path=thumb_key,
                thumbnail_time=round(t_best, 2),
                ai_disclosure=lim.disclosure_required or brand.kit.disclosure.required(p), aspect=lim.aspect,
            ).model_dump(mode="json"))
        return {"metadata": out}

    # ------------------------------------------------------------------ 10 publish
    @tracked(deps, "publish")
    async def publish(state: RunState, ctx: StageCtx):
        run = await repo.get_run(state["run_id"])
        brand = await repo.get_brand(state["brand_id"])
        publisher = providers.publisher_for(brand)
        profile_key = await repo.get_credential(brand.id, brand.publisher)
        existing = {p.platform: p for p in await repo.list_posts(run.id)}
        renders = {r["aspect"]: r for r in state["renders"]}
        now = utcnow()
        posts, failures = [], []
        for md in state["metadata"]:
            meta = PlatformMetadata.model_validate(md)
            done = existing.get(meta.platform)
            if done and done.external_id and done.status != "failed":
                posts.append(done.model_dump(mode="json"))
                continue
            options = brand.kit.platform_options.get(meta.platform, {})
            missing = missing_options(meta.platform, options)
            if missing:  # not connected for this brand: record why, keep publishing the others
                err = f"missing brand kit platform_options.{meta.platform.value}: {', '.join(missing)}"
                failures.append(f"{meta.platform.value}: {err}")
                rec = PostRecord(run_id=run.id, platform=meta.platform, status="failed",
                                 metadata={"error": err, **meta.model_dump(mode="json")})
                posts.append((await repo.upsert_post(rec)).model_dump(mode="json"))
                continue
            when = await _pick_slot(deps, brand, meta.platform, run.schedule, now)
            r = renders.get(meta.aspect.value) or renders[Aspect.vertical.value]
            req = PublishRequest(
                brand_id=brand.id, run_id=run.id, platform=meta.platform,
                video_url=store.url(r["path"], 7 * 86400), video_path=store.local_path(r["path"]),
                metadata=meta, thumbnail_url=store.url(meta.thumbnail_path, 7 * 86400) if meta.thumbnail_path else None,
                scheduled_at=when if when and when > now + timedelta(minutes=5) else None,
                profile_key=profile_key, options=options,
            )
            try:
                async with tracing.span(f"publish:{meta.platform.value}", kind="publish", provider=publisher.name,
                                        platform=meta.platform.value,
                                        scheduled_at=req.scheduled_at.isoformat() if req.scheduled_at else None):
                    res = await retry_async(lambda req=req: publisher.publish(req), attempts=3,
                                            base=0.01 if settings.provider_mode == "fake" else 2.0)
            except Exception as e:  # one platform failing must not block the others
                log.error("publish %s failed: %s", meta.platform, e)
                failures.append(f"{meta.platform.value}: {e}")
                rec = PostRecord(run_id=run.id, platform=meta.platform, status="failed",
                                 metadata={"error": str(e)[:500], **meta.model_dump(mode="json")})
                posts.append((await repo.upsert_post(rec)).model_dump(mode="json"))
                continue
            await ctx.charge(publisher.name, 1)
            deps.quota.record(brand.id, meta.platform, (req.scheduled_at or now).date())
            rec = PostRecord(
                run_id=run.id, platform=meta.platform, external_id=res.external_id, url=res.url,
                scheduled_at=req.scheduled_at, published_at=None if req.scheduled_at else now,
                status="scheduled" if req.scheduled_at else ("published" if res.status == "published" else res.status),
                metadata={**meta.model_dump(mode="json"), **({"ayrshare_id": res.raw.get("ayrshare_id")}
                                                            if res.raw.get("ayrshare_id") else {})},
            )
            posts.append((await repo.upsert_post(rec)).model_dump(mode="json"))
        if failures and len(failures) == len(state["metadata"]):
            raise RuntimeError("all platforms failed: " + "; ".join(failures))
        any_sched = any(p["status"] == "scheduled" for p in posts)
        return {"posts": posts,
                "status": (RunStatus.scheduled if any_sched else RunStatus.published).value}

    # ------------------------------------------------------------------ finalize (+ 11 metrics scheduling)
    async def finalize(state: RunState):
        run_id = state["run_id"]
        status = state.get("status") or RunStatus.published.value
        if status in (RunStatus.scheduled.value, RunStatus.published.value):
            # 11 metrics: pulled by the scheduler at +24 h / +7 d (see ops.collect_due_metrics)
            await repo.upsert_stage(StageRecord(run_id=run_id, name="metrics", status=StageStatus.pending,
                                                provider="scheduler"))
        await _snapshot(deps, run_id, {"status": status})
        return {"status": status}

    return {
        "ideate": ideate, "script": script, "tts": tts, "gen_shots": gen_shots, "gen_shot": gen_shot,
        "collect_shots": collect_shots, "music": music, "render": render, "qa": qa, "approve": approve,
        "metadata": metadata, "publish": publish, "finalize": finalize,
    }


def _lang(state: RunState) -> str:
    return state.get("language") or "en"


def build_timeline(infos: list[dict[str, Any]], total: float, provider: Any) -> list[dict[str, Any]]:
    """Shot infos (shot_index, prompt, negative_prompt, ref_image, length) -> billing-aware timeline entries."""
    segs = plan_timeline([i["length"] for i in infos], total, provider.supported_durations,
                         provider.max_clip_seconds)
    by_idx = {i["shot_index"]: i for i in infos}
    timeline, t = [], 0.0
    for seg in segs:
        s = by_idx[seg.shot_index]
        prompt = s["prompt"] if seg.part == 0 else f"{s['prompt']}. Continuation, same subject and style."
        timeline.append({"index": len(timeline), "shot_index": seg.shot_index, "prompt": prompt,
                         "negative_prompt": s["negative_prompt"], "ref_image": s["ref_image"],
                         "start": round(t, 3), "duration": seg.length, "billed": seg.billed})
        t += seg.length
    return timeline


def replan(timeline: list[dict[str, Any]], provider: Any) -> list[dict[str, Any]]:
    """Re-plan an existing timeline for another provider's billable durations (tier downgrade)."""
    infos: dict[int, dict[str, Any]] = {}
    for s in timeline:
        i = infos.setdefault(s["shot_index"], {"shot_index": s["shot_index"], "prompt": s["prompt"],
                                               "negative_prompt": s["negative_prompt"],
                                               "ref_image": s["ref_image"], "length": 0.0})
        i["length"] += s["duration"]
    return build_timeline(list(infos.values()), sum(s["duration"] for s in timeline), provider)


def webhook_url(settings: Settings, source: str) -> str:
    """Provider callback URL; fal gets a shared-secret token on top of its ED25519 signature."""
    url = f"{settings.public_api_url.rstrip('/')}/webhooks/{source}"
    if source == "fal" and settings.fal_webhook_secret:
        return f"{url}?token={settings.fal_webhook_secret}"
    return url


def auto_approvable(brand: Brand, report: QAReport) -> bool:
    """PRD stage 8: brand.trust >= N consecutive approvals AND qa.score >= 0.9 (and no blocking failure)."""
    return brand.trust_score >= brand.auto_approve_after and report.score >= 0.9 and report.passed


async def _pick_slot(deps: Deps, brand: Brand, platform: Platform, explicit: datetime | None,
                     now: datetime) -> datetime | None:
    """Explicit schedule, else next calendar slot; skip days where the platform's daily quota is used up."""
    when = explicit or next_slot(brand.calendar, platform, now)
    for _ in range(14):
        day = (when or now).date()
        used = await deps.repo.posts_on_day(brand.id, platform, day)
        if deps.quota.allow(brand.id, platform, day, used):
            return when
        base = datetime(day.year, day.month, day.day, tzinfo=UTC) + timedelta(days=1)
        when = next_slot(brand.calendar, platform, base) or base + timedelta(hours=(when or now).hour)
    raise PermanentError(f"{platform.value} posting quota exhausted for 14 days")
