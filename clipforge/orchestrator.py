"""Run orchestration: build dependencies, start/resume graph runs, worker loop, recovery.

The API only writes to the `runs` table (status queued / resume_requested with a
pending decision). Workers claim runs with FOR UPDATE SKIP LOCKED and drive the
LangGraph graph with the Postgres checkpointer (thread_id = run_id), so any
worker can resume any run from its last checkpoint.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import socket
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from langgraph.types import Command

from . import tracing
from .agents.llm import build_llm
from .config import Settings, get_settings
from .db import MemoryRepo, PostgresRepo, Repo
from .graph.builder import build_graph
from .graph.nodes import Deps
from .ledger import CostLedger, alert
from .models import Run, RunStatus, utcnow
from .providers.registry import build_providers
from .retry import BudgetExceeded, PermanentError
from .storage import build_store
from .telemetry import setup_telemetry

log = logging.getLogger(__name__)


@dataclass
class App:
    settings: Settings
    deps: Deps
    graph: Any
    _closers: list[Any]

    @property
    def repo(self) -> Repo:
        return self.deps.repo

    async def aclose(self) -> None:
        for c in reversed(self._closers):
            with contextlib.suppress(Exception):
                await c()


async def create_app_state(settings: Settings | None = None, repo: Repo | None = None) -> App:
    settings = settings or get_settings()
    setup_telemetry(settings)
    closers: list[Any] = []
    checkpointer: Any
    if repo is None and settings.database_url:
        pg = PostgresRepo(settings.database_url)
        await pg.open()
        closers.append(pg.close)
        repo = pg
    repo = repo or MemoryRepo()
    if settings.database_url and isinstance(repo, PostgresRepo):
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

        cm = AsyncPostgresSaver.from_conn_string(settings.database_url)
        checkpointer = await cm.__aenter__()
        await checkpointer.setup()
        closers.append(lambda: cm.__aexit__(None, None, None))
    else:
        from langgraph.checkpoint.memory import InMemorySaver

        checkpointer = InMemorySaver()
    store = build_store(settings)
    tracing.set_tracer(tracing.Tracer(repo))
    llm_model = "fake" if (settings.llm_mode or settings.provider_mode) == "fake" else settings.llm_model
    deps = Deps(settings=settings, repo=repo, store=store, providers=build_providers(settings, repo, store),
                llm=tracing.TracingLLM(build_llm(settings), llm_model), ledger=CostLedger(repo, settings))
    return App(settings=settings, deps=deps, graph=build_graph(deps, checkpointer), _closers=closers)


def _config(run_id: str) -> dict[str, Any]:
    return {"configurable": {"thread_id": run_id}, "recursion_limit": 200}


async def execute(app: App, run: Run) -> Run:
    """Start or resume one run until it finishes or pauses at the approval interrupt."""
    repo = app.repo
    cfg = _config(run.id)
    snapshot = await app.graph.aget_state(cfg)
    if run.pending_decision is not None and snapshot.next:
        inp: Any = Command(resume=run.pending_decision)
        await repo.update_run(run.id, pending_decision=None)
    elif snapshot.next:
        inp = None  # resume after a crash from the last checkpoint (completed nodes are not re-run)
    elif snapshot.values:
        return await repo.get_run(run.id)  # already finished
    else:
        inp = {"run_id": run.id, "brand_id": run.brand_id, "tier": run.tier.value, "brief": run.brief,
               "platforms": [p.value for p in run.platforms], "nonce": {}, "language": run.language,
               "subtitle_languages": run.subtitle_languages}
    await repo.update_run(run.id, status=RunStatus.running, error=None)
    try:
        async with tracing.tracer().span(
                "run.execute", kind="run", trace_id=run.id, brand_id=run.brand_id, tier=run.tier.value,
                language=run.language, resume=not isinstance(inp, dict),
                decision=(run.pending_decision or {}).get("decision"), attempt=run.attempts + 1):
            await app.graph.ainvoke(inp, cfg)
    except (BudgetExceeded, PermanentError) as e:
        log.error("run %s aborted: %s", run.id, e)
        status = RunStatus.aborted if isinstance(e, BudgetExceeded) else RunStatus.failed
        await repo.update_run(run.id, status=status, error=str(e)[:2000])
        await alert(app.settings, f"Run {run.id} {status.value}: {e}")
        return await repo.get_run(run.id)
    except Exception as e:  # transient: retried by recover() until max attempts, then DLQ
        log.exception("run %s failed", run.id)
        r = await repo.get_run(run.id)
        attempts = r.attempts + 1
        if attempts >= app.settings.max_run_attempts:
            await repo.update_run(run.id, status=RunStatus.dead_letter, error=str(e)[:2000], attempts=attempts)
            await repo.add_dead_letter(run.id, None, str(e)[:2000], {"type": type(e).__name__})
            await alert(app.settings, f"Run {run.id} moved to DLQ after {attempts} attempts: {e}")
        else:
            await repo.update_run(run.id, status=RunStatus.failed, error=str(e)[:2000], attempts=attempts)
        return await repo.get_run(run.id)

    snap = await app.graph.aget_state(cfg)
    checkpoint_id = snap.config.get("configurable", {}).get("checkpoint_id")
    if snap.next:  # paused at interrupt()
        await repo.update_run(run.id, status=RunStatus.awaiting_approval, checkpoint_id=checkpoint_id)
    else:
        final = snap.values.get("status") or RunStatus.published.value
        await repo.update_run(run.id, status=RunStatus(final), checkpoint_id=checkpoint_id)
    return await repo.get_run(run.id)


async def worker_loop(app: App, stop: asyncio.Event, concurrency: int = 2, idle_s: float = 2.0) -> None:
    name = f"{socket.gethostname()}:{os.getpid()}"
    sem = asyncio.Semaphore(concurrency)
    tasks: set[asyncio.Task] = set()

    async def one(run: Run) -> None:
        async with sem:
            try:
                await execute(app, run)
            except Exception:  # noqa: BLE001
                log.exception("worker failed on run %s", run.id)

    while not stop.is_set():
        free = concurrency - len(tasks)
        runs = await app.repo.claim_runs(name, limit=max(1, free)) if free > 0 else []
        for r in runs:
            t = asyncio.create_task(one(r))
            tasks.add(t)
            t.add_done_callback(tasks.discard)
        if not runs:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), idle_s)
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def recover(app: App, stale_after: timedelta = timedelta(minutes=30)) -> dict[str, int]:
    """Requeue failed/stale runs that still have attempts left (resume from checkpoint)."""
    requeued = 0
    for r in await app.repo.list_runs(status=RunStatus.failed.value, limit=200):
        if r.attempts < app.settings.max_run_attempts:
            await app.repo.update_run(r.id, status=RunStatus.queued)
            requeued += 1
    for r in await app.repo.stale_runs(utcnow() - stale_after):
        await app.repo.update_run(r.id, status=RunStatus.queued, attempts=r.attempts + 1)
        requeued += 1
    return {"requeued": requeued}
