"""Persistence layer.

`Repo` is the async interface used by the graph, API and workers. Two
implementations: `MemoryRepo` (tests, local demos) and `PostgresRepo`
(Supabase Postgres, service role; RLS protects direct client access).
"""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Any, Protocol

from .models import (
    Asset,
    Brand,
    BrandKit,
    LedgerEntry,
    Platform,
    PostingCalendar,
    PostMetrics,
    PostRecord,
    RenderJob,
    Run,
    RunStatus,
    StageRecord,
    utcnow,
)


class NotFound(KeyError):
    pass


class Repo(Protocol):
    # brands
    async def get_brand(self, brand_id: str) -> Brand: ...
    async def list_brands(self, org_ids: list[str] | None = None) -> list[Brand]: ...
    async def upsert_brand(self, brand: Brand) -> Brand: ...
    async def record_review(self, brand_id: str, approved: bool) -> int: ...
    # runs
    async def create_run(self, run: Run) -> Run: ...
    async def get_run(self, run_id: str) -> Run: ...
    async def update_run(self, run_id: str, **fields: Any) -> Run: ...
    async def list_runs(
        self, brand_ids: list[str] | None = None, status: str | None = None, limit: int = 50
    ) -> list[Run]: ...
    async def set_run_state(self, run_id: str, state: dict[str, Any]) -> None: ...
    async def get_run_state(self, run_id: str) -> dict[str, Any]: ...
    # stages
    async def upsert_stage(self, stage: StageRecord) -> StageRecord: ...
    async def get_stage(self, run_id: str, name: str) -> StageRecord | None: ...
    async def list_stages(self, run_id: str) -> list[StageRecord]: ...
    # assets
    async def add_asset(self, asset: Asset) -> Asset: ...
    async def list_assets(self, run_id: str) -> list[Asset]: ...
    # ledger
    async def add_ledger(self, entry: LedgerEntry) -> None: ...
    async def list_ledger(self, run_id: str) -> list[LedgerEntry]: ...
    async def brand_ledger(self, brand_id: str, start: datetime, end: datetime) -> list[LedgerEntry]: ...
    # posts / metrics
    async def upsert_post(self, post: PostRecord) -> PostRecord: ...
    async def list_posts(self, run_id: str) -> list[PostRecord]: ...
    async def posts_on_day(self, brand_id: str, platform: Platform, day: date) -> int: ...
    async def posts_due_metrics(self, now: datetime) -> list[tuple[PostRecord, str]]: ...
    async def add_metrics(self, m: PostMetrics) -> None: ...
    async def list_metrics(self, post_id: str) -> list[PostMetrics]: ...
    # render queue
    async def enqueue_render(self, job: RenderJob) -> RenderJob: ...
    async def get_render_job(self, job_id: str) -> RenderJob: ...
    async def claim_render_job(self, worker: str) -> RenderJob | None: ...
    async def finish_render_job(self, job_id: str, output: dict | None, error: str | None) -> None: ...
    async def count_render_queue(self) -> int: ...
    # hooks (dedupe)
    async def add_hook(self, brand_id: str, run_id: str, text: str, embedding: list[float] | None) -> None: ...
    async def recent_hooks(
        self, brand_id: str, since: datetime, exclude_run_id: str | None = None
    ) -> list[tuple[str, list[float] | None]]: ...
    # ops
    async def add_dead_letter(self, run_id: str, stage: str | None, error: str, payload: dict) -> None: ...
    async def mark_webhook(self, event_id: str, source: str) -> bool:
        """Return True the first time an event id is seen (idempotent webhooks)."""
        ...
    async def get_credential(self, brand_id: str, provider: str) -> str | None: ...
    async def put_credential(
        self, brand_id: str, provider: str, token: str, expires_at: datetime | None = None
    ) -> None: ...
    async def expiring_credentials(self, before: datetime) -> list[tuple[str, str]]: ...
    async def stale_runs(self, older_than: datetime) -> list[Run]: ...
    async def user_org_ids(self, user_id: str) -> list[str]: ...
    # tracing
    async def upsert_span(self, span: Any) -> None: ...
    async def list_spans(self, trace_id: str) -> list[Any]: ...
    async def span_counts(self, trace_ids: list[str]) -> dict[str, dict[str, Any]]:
        """trace_id -> {spans, errors, start, end}"""
        ...
    async def spans_between(self, start: datetime, end: datetime, brand_ids: list[str] | None) -> list[Any]: ...
    async def find_post_by_external(self, external_id: str) -> PostRecord | None: ...
    async def claim_runs(self, worker: str, limit: int = 1) -> list[Run]:
        """Atomically move queued / resume_requested runs to running for this worker."""
        ...


# ============================================================================ memory


class MemoryRepo:
    def __init__(self) -> None:
        self.brands: dict[str, Brand] = {}
        self.runs: dict[str, Run] = {}
        self.states: dict[str, dict[str, Any]] = {}
        self.stages: dict[tuple[str, str], StageRecord] = {}
        self.assets: dict[str, list[Asset]] = defaultdict(list)
        self.ledger: list[LedgerEntry] = []
        self.posts: dict[tuple[str, Platform], PostRecord] = {}
        self.metrics: dict[str, list[PostMetrics]] = defaultdict(list)
        self.render_jobs: dict[str, RenderJob] = {}
        self.hooks: list[tuple[str, str, str, list[float] | None, datetime]] = []
        self.dead_letters: list[dict[str, Any]] = []
        self.webhooks: set[str] = set()
        self.credentials: dict[tuple[str, str], tuple[str, datetime | None]] = {}
        self.org_members: dict[str, set[str]] = defaultdict(set)
        self.spans: dict[str, Any] = {}

    async def get_brand(self, brand_id: str) -> Brand:
        try:
            return self.brands[brand_id].model_copy(deep=True)
        except KeyError as e:
            raise NotFound(f"brand {brand_id}") from e

    async def list_brands(self, org_ids: list[str] | None = None) -> list[Brand]:
        return [b for b in self.brands.values() if org_ids is None or b.org_id in org_ids]

    async def upsert_brand(self, brand: Brand) -> Brand:
        self.brands[brand.id] = brand.model_copy(deep=True)
        return brand

    async def record_review(self, brand_id: str, approved: bool) -> int:
        b = self.brands[brand_id]
        b.trust_score = b.trust_score + 1 if approved else 0
        return b.trust_score

    async def create_run(self, run: Run) -> Run:
        self.runs[run.id] = run.model_copy(deep=True)
        return run

    async def get_run(self, run_id: str) -> Run:
        try:
            return self.runs[run_id].model_copy(deep=True)
        except KeyError as e:
            raise NotFound(f"run {run_id}") from e

    async def update_run(self, run_id: str, **fields: Any) -> Run:
        r = self.runs[run_id]
        for k, v in fields.items():
            setattr(r, k, v)
        r.updated_at = utcnow()
        return r.model_copy(deep=True)

    async def list_runs(self, brand_ids=None, status=None, limit=50) -> list[Run]:
        out = [
            r for r in self.runs.values()
            if (brand_ids is None or r.brand_id in brand_ids) and (status is None or r.status == status)
        ]
        return sorted(out, key=lambda r: r.created_at, reverse=True)[:limit]

    async def set_run_state(self, run_id: str, state: dict[str, Any]) -> None:
        self.states[run_id] = json.loads(json.dumps(state, default=str))

    async def get_run_state(self, run_id: str) -> dict[str, Any]:
        return json.loads(json.dumps(self.states.get(run_id, {})))

    async def upsert_stage(self, stage: StageRecord) -> StageRecord:
        self.stages[(stage.run_id, stage.name)] = stage.model_copy(deep=True)
        return stage

    async def get_stage(self, run_id: str, name: str) -> StageRecord | None:
        s = self.stages.get((run_id, name))
        return s.model_copy(deep=True) if s else None

    async def list_stages(self, run_id: str) -> list[StageRecord]:
        return [s for (rid, _), s in self.stages.items() if rid == run_id]

    async def add_asset(self, asset: Asset) -> Asset:
        existing = [a for a in self.assets[asset.run_id] if a.storage_path == asset.storage_path]
        if existing:
            return existing[0]
        self.assets[asset.run_id].append(asset)
        return asset

    async def list_assets(self, run_id: str) -> list[Asset]:
        return list(self.assets[run_id])

    async def add_ledger(self, entry: LedgerEntry) -> None:
        self.ledger.append(entry)
        if entry.run_id in self.runs:
            self.runs[entry.run_id].cost_total = round(self.runs[entry.run_id].cost_total + entry.total, 4)

    async def list_ledger(self, run_id: str) -> list[LedgerEntry]:
        return [e for e in self.ledger if e.run_id == run_id]

    async def brand_ledger(self, brand_id: str, start: datetime, end: datetime) -> list[LedgerEntry]:
        return [e for e in self.ledger if e.brand_id == brand_id and start <= e.at < end]

    async def upsert_post(self, post: PostRecord) -> PostRecord:
        self.posts[(post.run_id, post.platform)] = post.model_copy(deep=True)
        return post

    async def list_posts(self, run_id: str) -> list[PostRecord]:
        return [p for (rid, _), p in self.posts.items() if rid == run_id]

    async def posts_on_day(self, brand_id: str, platform: Platform, day: date) -> int:
        n = 0
        for p in self.posts.values():
            run = self.runs.get(p.run_id)
            when = p.scheduled_at or p.published_at
            if run and run.brand_id == brand_id and p.platform == platform and when and when.date() == day:
                n += 1
        return n

    async def posts_due_metrics(self, now: datetime) -> list[tuple[PostRecord, str]]:
        return _due_metrics(
            [(p, self.runs[p.run_id].brand_id) for p in self.posts.values() if p.run_id in self.runs],
            {pid: [m.captured_at for m in ms] for pid, ms in self.metrics.items()},
            now,
        )

    async def add_metrics(self, m: PostMetrics) -> None:
        self.metrics[m.post_id].append(m)

    async def list_metrics(self, post_id: str) -> list[PostMetrics]:
        return list(self.metrics[post_id])

    async def enqueue_render(self, job: RenderJob) -> RenderJob:
        self.render_jobs[job.id] = job.model_copy(deep=True)
        return job

    async def get_render_job(self, job_id: str) -> RenderJob:
        return self.render_jobs[job_id].model_copy(deep=True)

    async def claim_render_job(self, worker: str) -> RenderJob | None:
        for j in self.render_jobs.values():
            if j.status == "queued":
                j.status = "running"
                j.attempts += 1
                return j.model_copy(deep=True)
        return None

    async def finish_render_job(self, job_id: str, output: dict | None, error: str | None) -> None:
        j = self.render_jobs[job_id]
        j.output, j.error = output, error
        j.status = "done" if error is None else ("failed" if j.attempts >= 3 else "queued")

    async def count_render_queue(self) -> int:
        return sum(1 for j in self.render_jobs.values() if j.status in ("queued", "running"))

    async def add_hook(self, brand_id, run_id, text, embedding) -> None:
        self.hooks.append((brand_id, run_id, text, embedding, utcnow()))

    async def recent_hooks(self, brand_id: str, since: datetime, exclude_run_id: str | None = None):
        return [(t, e) for b, rid, t, e, at in self.hooks
                if b == brand_id and at >= since and (exclude_run_id is None or rid != exclude_run_id)]

    async def add_dead_letter(self, run_id, stage, error, payload) -> None:
        self.dead_letters.append({"run_id": run_id, "stage": stage, "error": error, "payload": payload})

    async def mark_webhook(self, event_id: str, source: str) -> bool:
        key = f"{source}:{event_id}"
        if key in self.webhooks:
            return False
        self.webhooks.add(key)
        return True

    async def get_credential(self, brand_id: str, provider: str) -> str | None:
        v = self.credentials.get((brand_id, provider))
        return v[0] if v else None

    async def put_credential(self, brand_id, provider, token, expires_at=None) -> None:
        self.credentials[(brand_id, provider)] = (token, expires_at)

    async def expiring_credentials(self, before: datetime) -> list[tuple[str, str]]:
        return [k for k, (_, exp) in self.credentials.items() if exp and exp < before]

    async def user_org_ids(self, user_id: str) -> list[str]:
        return [org for org, users in self.org_members.items() if user_id in users]

    async def upsert_span(self, span: Any) -> None:
        self.spans[span.id] = span.model_copy(deep=True)

    async def list_spans(self, trace_id: str) -> list[Any]:
        return sorted((s for s in self.spans.values() if s.trace_id == trace_id), key=lambda s: s.start_at)

    async def span_counts(self, trace_ids: list[str]) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        for s in self.spans.values():
            if s.trace_id not in trace_ids:
                continue
            c = out.setdefault(s.trace_id, {"spans": 0, "errors": 0, "start": s.start_at, "end": None})
            c["spans"] += 1
            c["errors"] += s.status == "error"
            c["start"] = min(c["start"], s.start_at)
            end = s.end_at or s.start_at
            c["end"] = max(c["end"], end) if c["end"] else end
        return out

    async def spans_between(self, start: datetime, end: datetime, brand_ids: list[str] | None) -> list[Any]:
        return [s for s in self.spans.values() if start <= s.start_at < end and (
            brand_ids is None or (s.trace_id in self.runs and self.runs[s.trace_id].brand_id in brand_ids))]

    async def find_post_by_external(self, external_id: str) -> PostRecord | None:
        for p in self.posts.values():
            if p.external_id == external_id or p.metadata.get("ayrshare_id") == external_id:
                return p.model_copy(deep=True)
        return None

    async def claim_runs(self, worker: str, limit: int = 1) -> list[Run]:
        out = []
        for r in sorted(self.runs.values(), key=lambda r: r.created_at):
            if len(out) >= limit:
                break
            if r.status in (RunStatus.queued, RunStatus.resume_requested):
                r.status = RunStatus.running
                r.updated_at = utcnow()
                out.append(r.model_copy(deep=True))
        return out

    async def stale_runs(self, older_than: datetime) -> list[Run]:
        return [
            r for r in self.runs.values()
            if r.status in (RunStatus.running, RunStatus.queued) and r.updated_at < older_than
        ]


def _due_metrics(
    posts: list[tuple[PostRecord, str]], captured: dict[str, list[datetime]], now: datetime
) -> list[tuple[PostRecord, str]]:
    """Posts whose 24 h or 7 d metrics snapshot is due and not yet captured."""
    due = []
    for p, brand_id in posts:
        if p.status != "published" or not p.published_at:
            continue
        caps = captured.get(p.id, [])
        for window in (timedelta(hours=24), timedelta(days=7)):
            at = p.published_at + window
            if now >= at and not any(c >= at for c in caps):
                due.append((p, brand_id))
                break
    return due


# ============================================================================ postgres


def _j(v: Any) -> str:
    return json.dumps(v, default=str)


class PostgresRepo:
    """psycopg3 async implementation against the Supabase schema (supabase/migrations)."""

    def __init__(self, dsn: str):
        from psycopg_pool import AsyncConnectionPool

        self.pool = AsyncConnectionPool(dsn, min_size=1, max_size=10, open=False, kwargs={"autocommit": True})

    async def open(self) -> None:
        await self.pool.open()

    async def close(self) -> None:
        await self.pool.close()

    async def _one(self, sql: str, *args: Any) -> dict[str, Any] | None:
        from psycopg.rows import dict_row

        async with self.pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(sql, args)
            return await cur.fetchone() if cur.description else None

    async def _all(self, sql: str, *args: Any) -> list[dict[str, Any]]:
        from psycopg.rows import dict_row

        async with self.pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(sql, args)
            return await cur.fetchall() if cur.description else []

    # ---- brands
    @staticmethod
    def _brand(r: dict[str, Any]) -> Brand:
        return Brand(
            id=str(r["id"]), org_id=r["org_id"], name=r["name"],
            kit=BrandKit.model_validate(r["kit_json"] or {}), tier=r["tier"],
            budget_per_run=float(r["budget_per_run"]), daily_budget=float(r["daily_budget"]),
            trust_score=r["trust_score"], auto_approve_after=r["auto_approve_after"],
            calendar=PostingCalendar.model_validate(r["calendar_json"] or {}), publisher=r["publisher"],
        )

    async def get_brand(self, brand_id: str) -> Brand:
        r = await self._one("select * from brands where id = %s", brand_id)
        if not r:
            raise NotFound(f"brand {brand_id}")
        return self._brand(r)

    async def list_brands(self, org_ids=None) -> list[Brand]:
        if org_ids is None:
            rows = await self._all("select * from brands order by name")
        else:
            rows = await self._all("select * from brands where org_id = any(%s) order by name", org_ids)
        return [self._brand(r) for r in rows]

    async def upsert_brand(self, brand: Brand) -> Brand:
        await self._one("insert into orgs (id, name) values (%s, %s) on conflict do nothing",
                        brand.org_id, brand.org_id)
        await self._one(
            """insert into brands (id, org_id, name, kit_json, tier, budget_per_run, daily_budget, trust_score,
                 auto_approve_after, calendar_json, publisher)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               on conflict (id) do update set org_id=excluded.org_id, name=excluded.name,
                 kit_json=excluded.kit_json, tier=excluded.tier, budget_per_run=excluded.budget_per_run,
                 daily_budget=excluded.daily_budget, auto_approve_after=excluded.auto_approve_after,
                 calendar_json=excluded.calendar_json, publisher=excluded.publisher""",
            brand.id, brand.org_id, brand.name, _j(brand.kit.model_dump(mode="json")), brand.tier,
            brand.budget_per_run, brand.daily_budget, brand.trust_score, brand.auto_approve_after,
            _j(brand.calendar.model_dump(mode="json")), brand.publisher,
        )
        return brand

    async def record_review(self, brand_id: str, approved: bool) -> int:
        r = await self._one(
            "update brands set trust_score = case when %s then trust_score + 1 else 0 end "
            "where id = %s returning trust_score", approved, brand_id)
        return r["trust_score"] if r else 0

    # ---- runs
    @staticmethod
    def _run(r: dict[str, Any]) -> Run:
        return Run(
            id=str(r["id"]), brand_id=str(r["brand_id"]), brief=r["brief"], status=r["status"], tier=r["tier"],
            budget=float(r["budget"]), cost_total=float(r["cost_total"]), checkpoint_id=r["checkpoint_id"],
            schedule=r["schedule"], platforms=r["platforms"], error=r["error"], attempts=r["attempts"],
            pending_decision=r.get("pending_decision"), language=r.get("language") or "en",
            subtitle_languages=r.get("subtitle_languages") or [], created_at=r["created_at"],
            updated_at=r["updated_at"],
        )

    async def create_run(self, run: Run) -> Run:
        await self._one(
            """insert into runs (id, brand_id, brief, status, tier, budget, schedule, platforms, language,
                 subtitle_languages) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            run.id, run.brand_id, run.brief, run.status, run.tier, run.budget, run.schedule,
            [p.value for p in run.platforms], run.language, run.subtitle_languages,
        )
        return run

    async def get_run(self, run_id: str) -> Run:
        r = await self._one("select * from runs where id = %s", run_id)
        if not r:
            raise NotFound(f"run {run_id}")
        return self._run(r)

    _RUN_COLS = {"status", "tier", "budget", "cost_total", "checkpoint_id", "schedule", "error", "attempts",
                 "brief", "platforms", "pending_decision", "language", "subtitle_languages"}

    async def update_run(self, run_id: str, **fields: Any) -> Run:
        bad = set(fields) - self._RUN_COLS
        if bad:
            raise ValueError(f"unknown run fields {bad}")
        if "platforms" in fields:
            fields["platforms"] = [getattr(p, "value", p) for p in fields["platforms"]]
        if "pending_decision" in fields and fields["pending_decision"] is not None:
            fields["pending_decision"] = _j(fields["pending_decision"])
        sets = ", ".join(f"{k} = %s" for k in fields)
        r = await self._one(f"update runs set {sets} where id = %s returning *", *fields.values(), run_id)
        if not r:
            raise NotFound(f"run {run_id}")
        return self._run(r)

    async def list_runs(self, brand_ids=None, status=None, limit=50) -> list[Run]:
        q, args = "select * from runs where true", []
        if brand_ids is not None:
            q += " and brand_id = any(%s::uuid[])"
            args.append(brand_ids)
        if status:
            q += " and status = %s"
            args.append(status)
        q += " order by created_at desc limit %s"
        args.append(limit)
        return [self._run(r) for r in await self._all(q, *args)]

    async def set_run_state(self, run_id: str, state: dict[str, Any]) -> None:
        await self._one("update runs set state_json = %s where id = %s", _j(state), run_id)

    async def get_run_state(self, run_id: str) -> dict[str, Any]:
        r = await self._one("select state_json from runs where id = %s", run_id)
        return (r or {}).get("state_json") or {}

    # ---- stages
    async def upsert_stage(self, s: StageRecord) -> StageRecord:
        await self._one(
            """insert into stages (id, run_id, name, status, attempt, provider, cost, input_ref, output_ref, error,
                 started_at, ended_at) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               on conflict (run_id, name) do update set status=excluded.status, attempt=excluded.attempt,
                 provider=excluded.provider, cost=excluded.cost, input_ref=excluded.input_ref,
                 output_ref=excluded.output_ref, error=excluded.error, started_at=excluded.started_at,
                 ended_at=excluded.ended_at""",
            s.id, s.run_id, s.name, s.status, s.attempt, s.provider, s.cost, s.input_ref, s.output_ref, s.error,
            s.started_at, s.ended_at,
        )
        return s

    @staticmethod
    def _stage(r: dict[str, Any]) -> StageRecord:
        return StageRecord(**{**r, "id": str(r["id"]), "run_id": str(r["run_id"]), "cost": float(r["cost"])})

    async def get_stage(self, run_id: str, name: str) -> StageRecord | None:
        r = await self._one("select * from stages where run_id = %s and name = %s", run_id, name)
        return self._stage(r) if r else None

    async def list_stages(self, run_id: str) -> list[StageRecord]:
        return [self._stage(r) for r in
                await self._all("select * from stages where run_id = %s order by started_at nulls last", run_id)]

    # ---- assets
    async def add_asset(self, a: Asset) -> Asset:
        existing = await self._one(
            "select id from assets where run_id = %s and storage_path = %s", a.run_id, a.storage_path)
        if existing:
            return a.model_copy(update={"id": str(existing["id"])})
        await self._one(
            "insert into assets (id, run_id, type, storage_path, sha256, meta_json) values (%s,%s,%s,%s,%s,%s)",
            a.id, a.run_id, a.type, a.storage_path, a.sha256, _j(a.meta))
        return a

    async def list_assets(self, run_id: str) -> list[Asset]:
        rows = await self._all("select * from assets where run_id = %s order by created_at", run_id)
        return [Asset(id=str(r["id"]), run_id=str(r["run_id"]), type=r["type"], storage_path=r["storage_path"],
                      sha256=r["sha256"], meta=r["meta_json"] or {}) for r in rows]

    # ---- ledger (runs.cost_total maintained by trigger)
    async def add_ledger(self, e: LedgerEntry) -> None:
        stage = await self.get_stage(e.run_id, e.stage)
        await self._one(
            """insert into cost_ledger (id, run_id, brand_id, stage_id, stage, provider, units, unit_cost, total, at)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            e.id, e.run_id, e.brand_id, stage.id if stage else None, e.stage, e.provider, e.units, e.unit_cost,
            e.total, e.at)

    @staticmethod
    def _ledger(r: dict[str, Any]) -> LedgerEntry:
        return LedgerEntry(id=str(r["id"]), run_id=str(r["run_id"]), brand_id=str(r["brand_id"]), stage=r["stage"],
                           provider=r["provider"], units=float(r["units"]), unit_cost=float(r["unit_cost"]),
                           total=float(r["total"]), at=r["at"])

    async def list_ledger(self, run_id: str) -> list[LedgerEntry]:
        return [self._ledger(r) for r in await self._all("select * from cost_ledger where run_id = %s order by at",
                                                         run_id)]

    async def brand_ledger(self, brand_id: str, start: datetime, end: datetime) -> list[LedgerEntry]:
        rows = await self._all(
            "select * from cost_ledger where brand_id = %s and at >= %s and at < %s order by at", brand_id, start, end)
        return [self._ledger(r) for r in rows]

    # ---- posts
    async def upsert_post(self, p: PostRecord) -> PostRecord:
        r = await self._one(
            """insert into posts (id, run_id, platform, external_id, url, scheduled_at, published_at, status,
                 metadata_json) values (%s,%s,%s,%s,%s,%s,%s,%s,%s)
               on conflict (run_id, platform) do update set external_id=excluded.external_id, url=excluded.url,
                 scheduled_at=excluded.scheduled_at, published_at=excluded.published_at, status=excluded.status,
                 metadata_json=excluded.metadata_json returning id""",
            p.id, p.run_id, p.platform, p.external_id, p.url, p.scheduled_at, p.published_at, p.status,
            _j(p.metadata))
        return p.model_copy(update={"id": str(r["id"])}) if r else p

    @staticmethod
    def _post(r: dict[str, Any]) -> PostRecord:
        return PostRecord(id=str(r["id"]), run_id=str(r["run_id"]), platform=r["platform"],
                          external_id=r["external_id"], url=r["url"], scheduled_at=r["scheduled_at"],
                          published_at=r["published_at"], status=r["status"], metadata=r["metadata_json"] or {})

    async def list_posts(self, run_id: str) -> list[PostRecord]:
        return [self._post(r) for r in await self._all("select * from posts where run_id = %s", run_id)]

    async def posts_on_day(self, brand_id: str, platform: Platform, day: date) -> int:
        r = await self._one(
            """select count(*) n from posts p join runs r on r.id = p.run_id
               where r.brand_id = %s and p.platform = %s
                 and coalesce(p.scheduled_at, p.published_at)::date = %s""", brand_id, platform, day)
        return int(r["n"]) if r else 0

    async def posts_due_metrics(self, now: datetime) -> list[tuple[PostRecord, str]]:
        rows = await self._all(
            """select p.*, r.brand_id from posts p join runs r on r.id = p.run_id
               where p.status = 'published' and p.published_at > now() - interval '8 days'""")
        caps = await self._all(
            """select post_id, captured_at from post_metrics
               where captured_at > now() - interval '9 days'""")
        captured: dict[str, list[datetime]] = defaultdict(list)
        for c in caps:
            captured[str(c["post_id"])].append(c["captured_at"])
        return _due_metrics([(self._post(r), str(r["brand_id"])) for r in rows], captured, now)

    async def add_metrics(self, m: PostMetrics) -> None:
        await self._one(
            """insert into post_metrics (post_id, captured_at, views, likes, comments, shares, retention_json)
               values (%s,%s,%s,%s,%s,%s,%s) on conflict do nothing""",
            m.post_id, m.captured_at, m.views, m.likes, m.comments, m.shares, _j(m.retention))

    async def list_metrics(self, post_id: str) -> list[PostMetrics]:
        rows = await self._all("select * from post_metrics where post_id = %s order by captured_at", post_id)
        return [PostMetrics(post_id=str(r["post_id"]), captured_at=r["captured_at"], views=r["views"],
                            likes=r["likes"], comments=r["comments"], shares=r["shares"],
                            retention=r["retention_json"] or {}) for r in rows]

    # ---- render queue
    @staticmethod
    def _job(r: dict[str, Any]) -> RenderJob:
        return RenderJob(id=str(r["id"]), run_id=str(r["run_id"]), status=r["status"], spec=r["spec"],
                         output=r["output"], error=r["error"], attempts=r["attempts"])

    async def enqueue_render(self, job: RenderJob) -> RenderJob:
        await self._one("insert into render_jobs (id, run_id, status, spec) values (%s,%s,%s,%s)",
                        job.id, job.run_id, job.status, _j(job.spec))
        return job

    async def get_render_job(self, job_id: str) -> RenderJob:
        r = await self._one("select * from render_jobs where id = %s", job_id)
        if not r:
            raise NotFound(f"render job {job_id}")
        return self._job(r)

    async def claim_render_job(self, worker: str) -> RenderJob | None:
        r = await self._one(
            """update render_jobs set status = 'running', locked_by = %s, locked_at = now(), attempts = attempts + 1
               where id = (select id from render_jobs
                           where status = 'queued'
                              or (status = 'running' and locked_at < now() - interval '15 minutes')
                           order by created_at for update skip locked limit 1)
               returning *""", worker)
        return self._job(r) if r else None

    async def finish_render_job(self, job_id: str, output: dict | None, error: str | None) -> None:
        await self._one(
            """update render_jobs set output = %s, error = %s,
                 status = case when %s::text is null then 'done' when attempts >= 3 then 'failed' else 'queued' end
               where id = %s""", _j(output) if output else None, error, error, job_id)

    async def count_render_queue(self) -> int:
        r = await self._one("select count(*) n from render_jobs where status in ('queued', 'running')")
        return int(r["n"]) if r else 0

    # ---- hooks
    async def add_hook(self, brand_id, run_id, text, embedding) -> None:
        await self._one(
            "insert into hook_history (brand_id, run_id, text, embedding) values (%s,%s,%s,%s)",
            brand_id, run_id, text, embedding)

    async def recent_hooks(self, brand_id: str, since: datetime, exclude_run_id: str | None = None):
        rows = await self._all(
            """select text, embedding emb from hook_history
               where brand_id = %s and created_at >= %s and run_id is distinct from %s::uuid""",
            brand_id, since, exclude_run_id)
        return [(r["text"], list(r["emb"]) if r["emb"] else None) for r in rows]

    # ---- ops
    async def add_dead_letter(self, run_id, stage, error, payload) -> None:
        await self._one("insert into dead_letters (run_id, stage, error, payload) values (%s,%s,%s,%s)",
                        run_id, stage, error, _j(payload))

    async def mark_webhook(self, event_id: str, source: str) -> bool:
        r = await self._one(
            "insert into webhook_events (id, source) values (%s, %s) on conflict do nothing returning id",
            f"{source}:{event_id}", source)
        return r is not None

    async def get_credential(self, brand_id: str, provider: str) -> str | None:
        r = await self._one("select get_provider_credential(%s, %s) tok", brand_id, provider)
        return r["tok"] if r else None

    async def put_credential(self, brand_id, provider, token, expires_at=None) -> None:
        await self._one("select put_provider_credential(%s, %s, %s, %s)", brand_id, provider, token, expires_at)

    async def expiring_credentials(self, before: datetime) -> list[tuple[str, str]]:
        rows = await self._all(
            "select brand_id, provider from provider_credentials where expires_at < %s", before)
        return [(str(r["brand_id"]), r["provider"]) for r in rows]

    async def user_org_ids(self, user_id: str) -> list[str]:
        rows = await self._all("select org_id from org_members where user_id = %s", user_id)
        return [r["org_id"] for r in rows]

    async def upsert_span(self, s: Any) -> None:
        await self._one(
            """insert into trace_spans (id, trace_id, parent_id, name, kind, status, start_at, end_at, duration_ms,
                 attributes, events, error) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               on conflict (id) do update set status=excluded.status, end_at=excluded.end_at,
                 duration_ms=excluded.duration_ms, attributes=excluded.attributes, events=excluded.events,
                 error=excluded.error""",
            s.id, s.trace_id, s.parent_id, s.name, s.kind, s.status, s.start_at, s.end_at, s.duration_ms,
            _j(s.attributes), _j([e.model_dump(mode="json") for e in s.events]), s.error)

    @staticmethod
    def _span(r: dict[str, Any]) -> Any:
        from .tracing import Span

        return Span(id=str(r["id"]), trace_id=str(r["trace_id"]), parent_id=str(r["parent_id"]) if r["parent_id"]
                    else None, name=r["name"], kind=r["kind"], status=r["status"], start_at=r["start_at"],
                    end_at=r["end_at"], duration_ms=r["duration_ms"], attributes=r["attributes"] or {},
                    events=r["events"] or [], error=r["error"])

    async def list_spans(self, trace_id: str) -> list[Any]:
        rows = await self._all("select * from trace_spans where trace_id = %s order by start_at", trace_id)
        return [self._span(r) for r in rows]

    async def span_counts(self, trace_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not trace_ids:
            return {}
        rows = await self._all(
            """select trace_id, count(*) n, count(*) filter (where status = 'error') e, min(start_at) s,
                 max(coalesce(end_at, start_at)) f from trace_spans where trace_id = any(%s::uuid[])
               group by trace_id""", trace_ids)
        return {str(r["trace_id"]): {"spans": r["n"], "errors": r["e"], "start": r["s"], "end": r["f"]} for r in rows}

    async def spans_between(self, start: datetime, end: datetime, brand_ids: list[str] | None) -> list[Any]:
        q = """select s.* from trace_spans s join runs r on r.id = s.trace_id
               where s.start_at >= %s and s.start_at < %s"""
        args: list[Any] = [start, end]
        if brand_ids is not None:
            q += " and r.brand_id = any(%s::uuid[])"
            args.append(brand_ids)
        return [self._span(r) for r in await self._all(q + " order by s.start_at limit 100000", *args)]

    async def find_post_by_external(self, external_id: str) -> PostRecord | None:
        r = await self._one(
            "select * from posts where external_id = %s or metadata_json->>'ayrshare_id' = %s limit 1",
            external_id, external_id)
        return self._post(r) if r else None

    async def claim_runs(self, worker: str, limit: int = 1) -> list[Run]:
        rows = await self._all(
            """update runs set status = 'running', locked_by = %s, locked_at = now()
               where id in (select id from runs where status in ('queued', 'resume_requested')
                            order by created_at for update skip locked limit %s)
               returning *""", worker, limit)
        return [self._run(r) for r in rows]

    async def stale_runs(self, older_than: datetime) -> list[Run]:
        rows = await self._all(
            "select * from runs where status in ('running', 'queued') and updated_at < %s", older_than)
        return [self._run(r) for r in rows]


def day_bounds(d: date) -> tuple[datetime, datetime]:
    start = datetime(d.year, d.month, d.day, tzinfo=UTC)
    return start, start + timedelta(days=1)
