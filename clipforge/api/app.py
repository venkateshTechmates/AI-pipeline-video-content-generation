"""FastAPI surface (PRD §10): runs, approvals, queue, costs, SSE, webhooks, cron."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections import defaultdict
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from ..config import Settings, get_settings
from ..db import NotFound
from ..models import ApprovalDecision, Brand, Run, RunCreate, RunStatus
from ..orchestrator import App, create_app_state, worker_loop
from ..providers.jobs import get_waiter
from ..storage import LocalStore
from .auth import Principal, brand_ids_for, principal, require_brand
from .signatures import SignatureError, verify_fal, verify_hmac_hex, verify_standard_webhook

log = logging.getLogger(__name__)
TERMINAL = {RunStatus.published, RunStatus.scheduled, RunStatus.failed, RunStatus.aborted, RunStatus.dead_letter}

Auth = Annotated[Principal, Depends(principal)]


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

    # ------------------------------------------------------------------ brands
    @api.get("/brands")
    async def list_brands(request: Request, p: Auth) -> dict[str, Any]:
        brands = await cf(request).repo.list_brands(p.org_ids)
        return {"items": [b.model_dump(mode="json") for b in brands]}

    @api.post("/brands")
    async def upsert_brand(request: Request, p: Auth, brand: Brand) -> dict[str, Any]:
        if p.org_ids is not None and brand.org_id not in p.org_ids:
            raise HTTPException(403, "not a member of this org")
        await cf(request).repo.upsert_brand(brand)
        return brand.model_dump(mode="json")

    @api.get("/brands/{brand_id}")
    async def get_brand(request: Request, p: Auth, brand_id: str) -> dict[str, Any]:
        await require_brand(request, p, brand_id)
        try:
            return (await cf(request).repo.get_brand(brand_id)).model_dump(mode="json")
        except NotFound:
            raise HTTPException(404, "brand not found") from None

    class CredentialIn(BaseModel):
        provider: str
        token: str
        expires_at: datetime | None = None

    @api.post("/brands/{brand_id}/credentials", status_code=204)
    async def put_credential(request: Request, p: Auth, brand_id: str, body: CredentialIn) -> None:
        await require_brand(request, p, brand_id)
        await cf(request).repo.put_credential(brand_id, body.provider, body.token, body.expires_at)

    @api.get("/brands/{brand_id}/costs")
    async def costs(request: Request, p: Auth, brand_id: str, from_: Annotated[date | None, Query(alias="from")] = None,
                    to: date | None = None) -> dict[str, Any]:
        await require_brand(request, p, brand_id)
        end_d = to or datetime.now(timezone.utc).date()
        start_d = from_ or end_d - timedelta(days=30)
        start = datetime(start_d.year, start_d.month, start_d.day, tzinfo=timezone.utc)
        end = datetime(end_d.year, end_d.month, end_d.day, tzinfo=timezone.utc) + timedelta(days=1)
        entries = await cf(request).repo.brand_ledger(brand_id, start, end)
        by_provider: dict[str, float] = defaultdict(float)
        by_stage: dict[str, float] = defaultdict(float)
        by_day: dict[str, float] = defaultdict(float)
        for e in entries:
            by_provider[e.provider] += e.total
            by_stage[e.stage] += e.total
            by_day[e.at.date().isoformat()] += e.total
        return {
            "brand_id": brand_id, "from": start_d.isoformat(), "to": end_d.isoformat(),
            "total": round(sum(e.total for e in entries), 4),
            "by_provider": {k: round(v, 4) for k, v in by_provider.items()},
            "by_stage": {k: round(v, 4) for k, v in by_stage.items()},
            "by_day": [{"day": d, "total": round(v, 4)} for d, v in sorted(by_day.items())],
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
        run = Run(brand_id=brand.id, brief=body.brief, tier=body.tier or brand.tier,
                  budget=body.budget or brand.budget_per_run, schedule=body.schedule,
                  platforms=body.platforms or brand.kit.platforms)
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
                          "qa": st.get("qa_report"), "script": st.get("script"),
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
            post.published_at = post.published_at or datetime.now(timezone.utc)
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

