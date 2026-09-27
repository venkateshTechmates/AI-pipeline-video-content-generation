"""FastAPI surface (PRD §10): runs, approvals, queue, costs, SSE, webhooks, cron."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections import defaultdict
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ValidationError
from sse_starlette.sse import EventSourceResponse

from ..config import Settings, get_settings
from ..db import NotFound
from ..models import ApprovalDecision, Brand, BrandKit, PostingCalendar, Run, RunCreate, RunStatus, Tier
from ..orchestrator import App, create_app_state, worker_loop
from ..platforms import missing_options
from ..providers.jobs import get_waiter
from ..storage import LocalStore
from .auth import Principal, brand_ids_for, principal, require_brand
from .signatures import SignatureError, verify_fal, verify_hmac_hex, verify_standard_webhook

log = logging.getLogger(__name__)
TERMINAL = {RunStatus.published, RunStatus.scheduled, RunStatus.failed, RunStatus.aborted, RunStatus.dead_letter}

Auth = Annotated[Principal, Depends(principal)]


class CredentialIn(BaseModel):
    provider: str
    token: str
    expires_at: datetime | None = None


class BrandPatch(BaseModel):
    name: str | None = None
    tier: Tier | None = None
    budget_per_run: float | None = Field(None, gt=0)
    daily_budget: float | None = Field(None, gt=0)
    auto_approve_after: int | None = Field(None, ge=1)
    publisher: Literal["upload_post", "ayrshare"] | None = None
    calendar: PostingCalendar | None = None
    kit: dict[str, Any] | None = None  # top-level kit fields to replace (e.g. platforms, platform_options)


def create_app(settings: Settings | None = None, app_state: App | None = None,
               on_startup: Callable[[App], Awaitable[None]] | None = None) -> FastAPI:
    settings = settings or get_settings()

    @contextlib.asynccontextmanager
    async def lifespan(api: FastAPI) -> AsyncIterator[None]:
        cf = app_state or await create_app_state(settings)
        api.state.cf = cf
        if on_startup:
            await on_startup(cf)
        stop = asyncio.Event()
        worker = None
        if cf.settings.embedded_worker:
            worker = asyncio.create_task(worker_loop(cf, stop, cf.settings.worker_concurrency))
        try:
            yield
        finally:
            stop.set()
            if worker:
                await asyncio.wait_for(worker, 60)
            if app_state is None:
                await cf.aclose()

    api = FastAPI(title="ClipForge", version="1.0.0", lifespan=lifespan)
    api.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    if settings.otel_exporter_otlp_endpoint:
        with contextlib.suppress(ImportError):
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

            FastAPIInstrumentor.instrument_app(api)

    def cf(request: Request) -> App:
        return request.app.state.cf

    async def get_run_scoped(request: Request, p: Principal, run_id: str) -> Run:
        try:
            run = await cf(request).repo.get_run(run_id)
        except NotFound:
            raise HTTPException(404, "run not found") from None
        await require_brand(request, p, run.brand_id)
        return run

    def with_url(request: Request, key: str | None) -> str | None:
        return cf(request).deps.store.url(key) if key else None

    # ------------------------------------------------------------------ health
    @api.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @api.get("/locale")
    async def locale(request: Request, region: str | None = None) -> dict[str, Any]:
        """Default content language for this viewer: ?region=, else CDN geo headers, else Accept-Language."""
        from ..regions import suggest_locale

        return suggest_locale(dict(request.headers), region)

    @api.get("/regions")
    async def regions() -> dict[str, Any]:
        from ..regions import all_regions

        return {"items": [{"code": r.code, "name": r.name, "language": r.language,
                           "subtitle_languages": list(r.subtitles)} for r in all_regions()]}

    @api.get("/languages")
    async def languages() -> dict[str, Any]:
        from ..languages import LANGUAGES

        return {"items": [{"code": lang.code, "name": lang.name, "native": lang.native, "rtl": lang.rtl}
                          for lang in LANGUAGES.values()]}

    # ------------------------------------------------------------------ brands
    @api.get("/brands")
    async def list_brands(request: Request, p: Auth) -> dict[str, Any]:
        brands = await cf(request).repo.list_brands(p.org_ids)
        return {"items": [b.model_dump(mode="json") for b in brands]}

    @api.post("/brands")
    async def upsert_brand(request: Request, p: Auth, brand: Brand) -> dict[str, Any]:
        if p.org_ids is not None and brand.org_id not in p.org_ids:
            raise HTTPException(403, "not a member of this org")
        if brand.kit.region and "language" not in brand.kit.model_fields_set:
            brand.kit.apply_region_defaults()
        await cf(request).repo.upsert_brand(brand)
        return brand.model_dump(mode="json")

    async def brand_view(request: Request, brand: Brand) -> dict[str, Any]:
        repo = cf(request).repo
        warnings = [f"{pl.value}: needs {', '.join(m)}" for pl in brand.kit.platforms
                    if (m := missing_options(pl, brand.kit.platform_options.get(pl, {})))]
        return {
            **brand.model_dump(mode="json"),
            # whether a publisher profile key is stored (the key itself is never returned)
            "credentials": {prov: bool(await repo.get_credential(brand.id, prov))
                            for prov in ("upload_post", "ayrshare")},
            "warnings": warnings,
        }

    @api.get("/brands/{brand_id}")
    async def get_brand(request: Request, p: Auth, brand_id: str) -> dict[str, Any]:
        await require_brand(request, p, brand_id)
        try:
            return await brand_view(request, await cf(request).repo.get_brand(brand_id))
        except NotFound:
            raise HTTPException(404, "brand not found") from None

    @api.patch("/brands/{brand_id}")
    async def patch_brand(request: Request, p: Auth, brand_id: str, body: BrandPatch) -> dict[str, Any]:
        await require_brand(request, p, brand_id)
        repo = cf(request).repo
        try:
            brand = await repo.get_brand(brand_id)
        except NotFound:
            raise HTTPException(404, "brand not found") from None
        fields = body.model_dump(exclude_unset=True, exclude={"kit"})
        try:
            kit = BrandKit.model_validate({**brand.kit.model_dump(mode="json"), **(body.kit or {})})
            if (body.kit or {}).get("region") and "language" not in (body.kit or {}):
                kit.apply_region_defaults()  # new location → its language, unless the patch picked one
            merged = {**brand.model_dump(mode="json"), **fields, "kit": kit.model_dump(mode="json")}
            brand = Brand.model_validate(merged)
        except ValidationError as e:
            raise HTTPException(422, e.errors(include_url=False, include_context=False)) from None
        await repo.upsert_brand(brand)
        return await brand_view(request, brand)

    @api.post("/brands/{brand_id}/credentials", status_code=204)
    async def put_credential(request: Request, p: Auth, brand_id: str, body: CredentialIn) -> None:
        await require_brand(request, p, brand_id)
        await cf(request).repo.put_credential(brand_id, body.provider, body.token, body.expires_at)

    @api.get("/brands/{brand_id}/costs")
    async def costs(request: Request, p: Auth, brand_id: str, from_: Annotated[date | None, Query(alias="from")] = None,
                    to: date | None = None) -> dict[str, Any]:
        await require_brand(request, p, brand_id)
        end_d = to or datetime.now(UTC).date()
        start_d = from_ or end_d - timedelta(days=30)
        start = datetime(start_d.year, start_d.month, start_d.day, tzinfo=UTC)
        end = datetime(end_d.year, end_d.month, end_d.day, tzinfo=UTC) + timedelta(days=1)
        entries = await cf(request).repo.brand_ledger(brand_id, start, end)
        by_provider: dict[str, float] = defaultdict(float)
        by_stage: dict[str, float] = defaultdict(float)
        by_day: dict[str, float] = defaultdict(float)
        day_stage: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        day_provider: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        for e in entries:
            day = e.at.date().isoformat()
            by_provider[e.provider] += e.total
            by_stage[e.stage] += e.total
            by_day[day] += e.total
            day_stage[day][e.stage] += e.total
            day_provider[day][e.provider] += e.total
        return {
            "brand_id": brand_id, "from": start_d.isoformat(), "to": end_d.isoformat(),
            "total": round(sum(e.total for e in entries), 4),
            "by_provider": {k: round(v, 4) for k, v in by_provider.items()},
            "by_stage": {k: round(v, 4) for k, v in by_stage.items()},
            "by_day": [{"day": d, "total": round(v, 4),
                        "by_stage": {k: round(x, 4) for k, x in day_stage[d].items()},
                        "by_provider": {k: round(x, 4) for k, x in day_provider[d].items()}}
                       for d, v in sorted(by_day.items())],
            "runs": len({e.run_id for e in entries}),
        }

    # ------------------------------------------------------------------ runs
    @api.post("/runs", status_code=201)
    async def create_run(request: Request, p: Auth, body: RunCreate) -> dict[str, str]:
        await require_brand(request, p, body.brand_id)
        try:
            brand = await cf(request).repo.get_brand(body.brand_id)
        except NotFound:
            raise HTTPException(404, "brand not found") from None
        from ..regions import get_region

        region = get_region(body.region) if body.region else None
        if body.region and region is None:
            raise HTTPException(422, f"unknown region {body.region!r}")
        language = body.language or (region.language if region else brand.kit.language)
        subtitles = (body.subtitle_languages if body.subtitle_languages is not None
                     else list(region.subtitles) if region else brand.kit.subtitle_languages)
        run = Run(brand_id=brand.id, brief=body.brief, tier=body.tier or brand.tier,
                  budget=body.budget or brand.budget_per_run, schedule=body.schedule,
                  platforms=body.platforms or brand.kit.platforms, language=language,
                  subtitle_languages=[s for s in subtitles if s != language], region=region.code if region else None)
        await cf(request).repo.create_run(run)
        return {"run_id": run.id}

    @api.get("/runs")
    async def list_runs(request: Request, p: Auth, brand_id: str | None = None, status: str | None = None,
                        limit: int = 50) -> dict[str, Any]:
        allowed = await brand_ids_for(request, p)
        ids = [brand_id] if brand_id else allowed
        if brand_id and allowed is not None and brand_id not in allowed:
            raise HTTPException(404, "brand not found")
        runs = await cf(request).repo.list_runs(ids, status, min(limit, 200))
        return {"items": [r.model_dump(mode="json") for r in runs]}

    @api.get("/runs/{run_id}")
    async def get_run(request: Request, p: Auth, run_id: str) -> dict[str, Any]:
        run = await get_run_scoped(request, p, run_id)
        repo = cf(request).repo
        state = await repo.get_run_state(run_id)
        view = {k: state.get(k) for k in ("hooks", "hook", "script", "shot_list", "qa_report", "metadata", "vo",
                                          "music", "decision", "auto_approved") if state.get(k) is not None}
        view["renders"] = [{**r, "url": with_url(request, r["path"])} for r in state.get("renders") or []]
        view["clips"] = [{**c, "url": with_url(request, c["path"])} for c in state.get("clips") or []]
        view["subtitles"] = [
            {**s, "srt_url": with_url(request, s.get("srt")), "vtt_url": with_url(request, s.get("vtt"))}
            for s in state.get("subtitles") or []]
        view["language"] = state.get("language") or run.language
        if view.get("metadata"):
            view["metadata"] = [{**m, "thumbnail_url": with_url(request, m.get("thumbnail_path"))}
                                for m in view["metadata"]]
        return {
            "run": run.model_dump(mode="json"),
            "stages": [s.model_dump(mode="json") for s in await repo.list_stages(run_id)],
            "assets": [{**a.model_dump(mode="json"), "url": with_url(request, a.storage_path)}
                       for a in await repo.list_assets(run_id)],
            "ledger": [e.model_dump(mode="json") for e in await repo.list_ledger(run_id)],
            "posts": [p_.model_dump(mode="json") for p_ in await repo.list_posts(run_id)],
            "state": view,
        }

    @api.post("/runs/{run_id}/approve")
    async def approve(request: Request, p: Auth, run_id: str, body: ApprovalDecision) -> dict[str, str]:
        run = await get_run_scoped(request, p, run_id)
        if run.status != RunStatus.awaiting_approval:
            raise HTTPException(409, f"run is {run.status}, not awaiting approval")
        body.reviewer = body.reviewer or p.user_id or "service"
        await cf(request).repo.update_run(run_id, pending_decision=body.model_dump(mode="json"),
                                          status=RunStatus.resume_requested)
        return {"status": RunStatus.resume_requested.value}

    @api.post("/runs/{run_id}/retry")
    async def retry(request: Request, p: Auth, run_id: str) -> dict[str, str]:
        run = await get_run_scoped(request, p, run_id)
        if run.status not in (RunStatus.failed, RunStatus.dead_letter, RunStatus.aborted):
            raise HTTPException(409, f"run is {run.status}")
        await cf(request).repo.update_run(run_id, status=RunStatus.queued, attempts=0, error=None)
        return {"status": RunStatus.queued.value}

    @api.get("/queue")
    async def queue(request: Request, p: Auth, brand_id: str | None = None) -> dict[str, Any]:
        allowed = await brand_ids_for(request, p)
        ids = [brand_id] if brand_id else allowed
        if brand_id and allowed is not None and brand_id not in allowed:
            raise HTTPException(404, "brand not found")
        repo = cf(request).repo
        runs = await repo.list_runs(ids, RunStatus.awaiting_approval.value, 100)
        names: dict[str, str] = {}
        items = []
        for r in runs:
            if r.brand_id not in names:
                names[r.brand_id] = (await repo.get_brand(r.brand_id)).name
            st = await repo.get_run_state(r.id)
            vertical = next((x for x in st.get("renders") or [] if x["aspect"] == "9:16"), None)
            items.append({"run": r.model_dump(mode="json"), "brand_name": names[r.brand_id],
                          "qa": st.get("qa_report"), "script": st.get("script"), "vo": st.get("vo"),
                          "shot_list": st.get("shot_list"),
                          "preview_url": with_url(request, vertical["path"]) if vertical else None,
                          "cost_total": r.cost_total, "budget": r.budget})
        return {"items": items}

    @api.get("/runs/{run_id}/events")
    async def events(request: Request, p: Auth, run_id: str) -> EventSourceResponse:
        await get_run_scoped(request, p, run_id)
        repo = cf(request).repo

        async def gen() -> AsyncIterator[dict[str, str]]:
            seen_stages: dict[str, str] = {}
            last_status, last_cost = None, None
            while not await request.is_disconnected():
                run = await repo.get_run(run_id)
                for s in await repo.list_stages(run_id):
                    sig = f"{s.status}:{s.attempt}:{s.cost}:{s.ended_at}"
                    if seen_stages.get(s.name) != sig:
                        seen_stages[s.name] = sig
                        yield {"data": json.dumps({"type": "stage", **s.model_dump(mode="json")})}
                if run.status != last_status:
                    last_status = run.status
                    yield {"data": json.dumps({"type": "status", "status": run.status.value, "error": run.error})}
                if run.cost_total != last_cost:
                    last_cost = run.cost_total
                    yield {"data": json.dumps({"type": "cost", "cost_total": run.cost_total, "budget": run.budget})}
                await asyncio.sleep(1.5)

        return EventSourceResponse(gen(), ping=15)

    # ------------------------------------------------------------------ tracing (tracing/ app)
    async def trace_summaries(request: Request, runs: list[Run]) -> list[dict[str, Any]]:
        repo = cf(request).repo
        counts = await repo.span_counts([r.id for r in runs])
        names: dict[str, str] = {}
        out = []
        for r in runs:
            if r.brand_id not in names:
                try:
                    names[r.brand_id] = (await repo.get_brand(r.brand_id)).name
                except NotFound:
                    names[r.brand_id] = "?"
            c = counts.get(r.id, {})
            start, end = c.get("start") or r.created_at, c.get("end")
            running = r.status in (RunStatus.queued, RunStatus.running, RunStatus.resume_requested)
            title = ((await repo.get_run_state(r.id)).get("script") or {}).get("title") or r.brief
            out.append({
                "trace_id": r.id, "run_id": r.id, "brand_id": r.brand_id, "brand_name": names[r.brand_id],
                "title": title, "status": r.status.value, "started_at": start.isoformat(),
                "ended_at": None if running or not end else end.isoformat(),
                "duration_ms": round(((end or start) - start).total_seconds() * 1000, 1) if end else None,
                "span_count": c.get("spans", 0), "error_count": c.get("errors", 0), "cost_total": r.cost_total,
                "language": r.language, "tier": r.tier.value,
            })
        return out

    @api.get("/traces")
    async def list_traces(request: Request, p: Auth, brand_id: str | None = None, status: str | None = None,
                          q: str | None = None, limit: int = 50) -> dict[str, Any]:
        allowed = await brand_ids_for(request, p)
        if brand_id and allowed is not None and brand_id not in allowed:
            raise HTTPException(404, "brand not found")
        ids = [brand_id] if brand_id else allowed
        run_status = None if status in (None, "", "error") else status
        runs = await cf(request).repo.list_runs(ids, run_status, 500)
        items = await trace_summaries(request, runs)
        if status == "error":
            items = [t for t in items if t["error_count"]]
        if q:
            ql = q.lower()
            items = [t for t in items if ql in (t["title"] or "").lower() or ql in t["run_id"]]
        return {"items": items[: min(limit, 200)]}

    @api.get("/traces/stats")
    async def trace_stats(request: Request, p: Auth, from_: Annotated[date | None, Query(alias="from")] = None,
                          to: date | None = None, brand_id: str | None = None) -> dict[str, Any]:
        from ..tracing import percentile

        allowed = await brand_ids_for(request, p)
        if brand_id and allowed is not None and brand_id not in allowed:
            raise HTTPException(404, "brand not found")
        ids = [brand_id] if brand_id else allowed
        end_d = to or datetime.now(UTC).date()
        start_d = from_ or end_d - timedelta(days=14)
        start = datetime(start_d.year, start_d.month, start_d.day, tzinfo=UTC)
        end = datetime(end_d.year, end_d.month, end_d.day, tzinfo=UTC) + timedelta(days=1)
        spans = [s for s in await cf(request).repo.spans_between(start, end, ids) if s.duration_ms is not None]

        providers: dict[tuple[str, str], list[Any]] = defaultdict(list)
        stages: dict[str, list[Any]] = defaultdict(list)
        for s in spans:
            if s.kind in ("llm", "video", "tts", "music", "render", "publish"):
                key = s.attributes.get("model") if s.kind == "llm" else s.attributes.get("provider")
                providers[(str(key or s.name), s.kind)].append(s)
            elif s.kind == "stage":
                stages[s.name].append(s)

        def stat(group: list[Any]) -> dict[str, Any]:
            d = [s.duration_ms for s in group]
            return {"calls": len(group), "errors": sum(s.status == "error" for s in group),
                    "p50_ms": percentile(d, 0.5), "p95_ms": percentile(d, 0.95),
                    "avg_ms": round(sum(d) / len(d), 1) if d else 0.0}

        provider_stats = []
        for (name, kind), group in providers.items():
            st = stat(group)
            st["cost"] = round(sum(float(s.attributes.get("cost_usd", 0) or 0) for s in group), 4)
            provider_stats.append({"name": name, "kind": kind, **st})
        stage_stats = []
        for name, group in stages.items():
            st = stat(group)
            stage_stats.append({"name": name, "runs": len({s.trace_id for s in group}), "errors": st["errors"],
                                "p50_ms": st["p50_ms"], "p95_ms": st["p95_ms"]})

        runs = [r for r in await cf(request).repo.list_runs(ids, None, 1000) if start <= r.created_at < end]
        summaries = await trace_summaries(request, runs)
        by_day: dict[str, dict[str, float]] = defaultdict(lambda: {"runs": 0, "errors": 0, "cost": 0.0})
        for t in summaries:
            day = t["started_at"][:10]
            by_day[day]["runs"] += 1
            by_day[day]["errors"] += 1 if t["error_count"] else 0
            by_day[day]["cost"] = round(by_day[day]["cost"] + t["cost_total"], 4)
        slowest = sorted((t for t in summaries if t["duration_ms"]), key=lambda t: -t["duration_ms"])[:10]
        return {
            "providers": sorted(provider_stats, key=lambda x: -x["calls"]),
            "stages": sorted(stage_stats, key=lambda x: x["name"]),
            "throughput": [{"day": d, **v} for d, v in sorted(by_day.items())],
            "slowest": slowest,
        }

    @api.get("/traces/{trace_id}")
    async def get_trace(request: Request, p: Auth, trace_id: str) -> dict[str, Any]:
        run = await get_run_scoped(request, p, trace_id)
        spans = await cf(request).repo.list_spans(trace_id)
        return {"trace": (await trace_summaries(request, [run]))[0],
                "spans": [s.model_dump(mode="json") for s in spans]}

    # ------------------------------------------------------------------ assets (local store only)
    @api.get("/assets/{key:path}")
    async def asset(request: Request, p: Auth, key: str) -> FileResponse:
        store = cf(request).deps.store
        if not isinstance(store, LocalStore):
            raise HTTPException(404, "assets are served from Supabase Storage signed URLs")
        parts = key.split("/")
        if len(parts) > 2 and parts[0] == "runs":
            await get_run_scoped(request, p, parts[1])
        path = store.local_path(key)
        if not path.exists():
            raise HTTPException(404, "asset not found")
        return FileResponse(path)

    # ------------------------------------------------------------------ webhooks
    async def _body(request: Request) -> tuple[bytes, dict[str, str]]:
        return await request.body(), {k.lower(): v for k, v in request.headers.items()}

    @api.post("/webhooks/fal")
    async def fal_webhook(request: Request) -> dict[str, bool]:
        body, headers = await _body(request)
        s = cf(request).settings
        verified = False
        if s.fal_webhook_secret:
            if request.query_params.get("token") != s.fal_webhook_secret:
                raise HTTPException(401, "bad token")
            verified = True
        if "x-fal-webhook-signature" in headers:
            try:
                await verify_fal(headers, body)
                verified = True
            except SignatureError as e:
                raise HTTPException(401, str(e)) from e
        if not verified and s.env == "prod":
            raise HTTPException(401, "unverified webhook")
        data = json.loads(body)
        rid = data.get("request_id") or data.get("gateway_request_id")
        if not rid:
            raise HTTPException(400, "missing request_id")
        if not await cf(request).repo.mark_webhook(rid, "fal"):
            return {"duplicate": True}
        get_waiter().resolve(rid, data)
        return {"ok": True}

    @api.post("/webhooks/replicate")
    async def replicate_webhook(request: Request) -> dict[str, bool]:
        body, headers = await _body(request)
        s = cf(request).settings
        if s.replicate_webhook_secret:
            try:
                verify_standard_webhook(s.replicate_webhook_secret, headers, body)
            except SignatureError as e:
                raise HTTPException(401, str(e)) from e
        elif s.env == "prod":
            raise HTTPException(401, "unverified webhook")
        data = json.loads(body)
        if data.get("status") in ("succeeded", "failed", "canceled"):
            if not await cf(request).repo.mark_webhook(data["id"], "replicate"):
                return {"duplicate": True}
            get_waiter().resolve(data["id"], data)
        return {"ok": True}

    @api.post("/webhooks/publisher")
    async def publisher_webhook(request: Request) -> dict[str, Any]:
        body, headers = await _body(request)
        s = cf(request).settings
        if s.publisher_webhook_secret:
            try:
                verify_hmac_hex(s.publisher_webhook_secret, headers, body)
            except SignatureError as e:
                raise HTTPException(401, str(e)) from e
        elif s.env == "prod":
            raise HTTPException(401, "unverified webhook")
        data = json.loads(body)
        repo = cf(request).repo
        ext = str(data.get("platform_post_id") or data.get("postId") or data.get("post_id") or data.get("id") or "")
        post = await repo.find_post_by_external(ext) if ext else None
        if not post:
            return {"ok": True, "matched": False}
        status = str(data.get("status", "")).lower()
        if status in ("success", "published", "posted", "completed"):
            post.status = "published"
            post.published_at = post.published_at or datetime.now(UTC)
        elif status in ("error", "failed"):
            post.status = "failed"
            post.metadata["error"] = data.get("error") or data.get("message")
        post.url = data.get("postUrl") or data.get("url") or post.url
        await repo.upsert_post(post)
        if post.status == "published":
            posts = await repo.list_posts(post.run_id)
            if all(p_.status == "published" for p_ in posts):
                await repo.update_run(post.run_id, status=RunStatus.published)
        return {"ok": True, "matched": True}

    # ------------------------------------------------------------------ cron (pg_cron -> pg_net)
    @api.post("/cron/{job}")
    async def cron(request: Request, job: str) -> dict[str, int]:
        s = cf(request).settings
        if s.cron_secret and request.headers.get("x-cron-secret") != s.cron_secret:
            raise HTTPException(401, "bad cron secret")
        if not s.cron_secret and s.env == "prod":
            raise HTTPException(401, "CRON_SECRET not configured")
        from ..ops import run_job

        try:
            return await run_job(cf(request), job)
        except ValueError as e:
            raise HTTPException(404, str(e)) from e

    return api

