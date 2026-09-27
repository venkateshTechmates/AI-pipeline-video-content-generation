"""`clipforge` command line.

  clipforge api                 FastAPI (+ embedded worker unless EMBEDDED_WORKER=false)
  clipforge worker              graph worker only (claims runs from Postgres)
  clipforge dev [--runs N]      fake providers + demo brand + N demo runs (no API keys needed)
  clipforge run --brand ID --brief "..." [--approve]   one run in-process, prints the mp4 paths (M1)
  clipforge seed                upsert the demo brand
  clipforge cron <job>          calendar | metrics | refresh-tokens | recover
  clipforge migrate [--core-only]  apply supabase/migrations/*.sql to DATABASE_URL
  clipforge mcp                 MCP server (stdio) exposing create_run/get_run/approve_run/list_queue
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import signal
import sys
from pathlib import Path


def _logging() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")


async def _worker() -> None:
    from .orchestrator import create_app_state, worker_loop

    app = await create_app_state()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    try:
        await worker_loop(app, stop, app.settings.worker_concurrency)
    finally:
        await app.aclose()


async def _run_once(brand_id: str | None, brief: str | None, approve: bool, language: str | None = None,
                    subtitles: list[str] | None = None) -> None:
    from .models import ApprovalDecision, Decision, Run, RunStatus
    from .orchestrator import create_app_state, execute
    from .seed import demo_brand

    app = await create_app_state()
    try:
        if brand_id is None:
            brand = demo_brand()
            await app.repo.upsert_brand(brand)
            brand_id = brand.id
        brand = await app.repo.get_brand(brand_id)
        run = Run(brand_id=brand.id, brief=brief, tier=brand.tier, budget=brand.budget_per_run,
                  platforms=brand.kit.platforms, language=language or brand.kit.language,
                  subtitle_languages=subtitles if subtitles is not None else brand.kit.subtitle_languages)
        await app.repo.create_run(run)
        run = await execute(app, run)
        if run.status == RunStatus.awaiting_approval and approve:
            await app.repo.update_run(run.id, pending_decision=ApprovalDecision(
                decision=Decision.approve, reviewer="cli").model_dump(mode="json"))
            run = await execute(app, await app.repo.get_run(run.id))
        state = await app.repo.get_run_state(run.id)
        out = {
            "run_id": run.id, "status": run.status, "cost_total": run.cost_total, "error": run.error,
            "renders": [str(app.deps.store.local_path(r["path"])) for r in state.get("renders") or []],
            "qa_score": (state.get("qa_report") or {}).get("score"),
            "posts": [p.model_dump(mode="json") for p in await app.repo.list_posts(run.id)],
        }
        print(json.dumps(out, indent=2, default=str))
    finally:
        await app.aclose()


async def _seed() -> None:
    from .orchestrator import create_app_state
    from .seed import demo_brand

    app = await create_app_state()
    try:
        b = demo_brand()
        await app.repo.upsert_brand(b)
        print(b.id)
    finally:
        await app.aclose()


async def _cron(job: str) -> None:
    from .ops import run_job
    from .orchestrator import create_app_state

    app = await create_app_state()
    try:
        print(json.dumps(await run_job(app, job)))
    finally:
        await app.aclose()


async def _migrate(core_only: bool) -> None:
    import psycopg

    from .config import get_settings

    dsn = get_settings().database_url
    if not dsn:
        sys.exit("DATABASE_URL is not set")
    root = Path(__file__).resolve().parent.parent / "supabase" / "migrations"
    async with await psycopg.AsyncConnection.connect(dsn, autocommit=True) as conn:
        for f in sorted(root.glob("*.sql")):
            if core_only and "supabase" in f.name:
                continue
            print(f"applying {f.name}")
            await conn.execute(f.read_text())


def _serve(host: str, port: int, dev_runs: int | None = None) -> None:
    import uvicorn

    from .api.app import create_app
    from .config import get_settings

    settings = get_settings()
    if dev_runs is not None:
        settings = settings.model_copy(update={"provider_mode": "fake"})
    seed = None
    if dev_runs is not None:
        from .models import Run
        from .seed import demo_brand

        async def seed(cf) -> None:
            b = demo_brand()
            await cf.repo.upsert_brand(b)
            if not await cf.repo.list_runs([b.id], limit=1):
                briefs = ["morning routines that stick", "deep work in a noisy office", "sleep better tonight",
                          "the 2-minute rule", "phone-free evenings"]
                for i in range(dev_runs):
                    await cf.repo.create_run(Run(brand_id=b.id, brief=briefs[i % len(briefs)],
                                                 budget=b.budget_per_run, platforms=b.kit.platforms))

    api = create_app(settings, on_startup=seed)
    uvicorn.run(api, host=host, port=port, log_level="info")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="clipforge")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("api")
    a.add_argument("--host", default="0.0.0.0")
    a.add_argument("--port", type=int, default=8000)
    d = sub.add_parser("dev")
    d.add_argument("--host", default="127.0.0.1")
    d.add_argument("--port", type=int, default=8000)
    d.add_argument("--runs", type=int, default=3)
    sub.add_parser("worker")
    r = sub.add_parser("run")
    r.add_argument("--brand")
    r.add_argument("--brief")
    r.add_argument("--approve", action="store_true", help="approve at the review gate and publish")
    r.add_argument("--language", help="voice + caption language, e.g. es, hi, ja (default: brand kit)")
    r.add_argument("--subtitles", help="comma-separated extra subtitle languages, e.g. en,es,fr")
    sub.add_parser("seed")
    c = sub.add_parser("cron")
    c.add_argument("job", choices=["calendar", "metrics", "refresh-tokens", "recover"])
    m = sub.add_parser("migrate")
    m.add_argument("--core-only", action="store_true", help="plain Postgres: skip the Supabase layer")
    sub.add_parser("mcp")
    args = ap.parse_args(argv)
    _logging()

    match args.cmd:
        case "api":
            _serve(args.host, args.port)
        case "dev":
            _serve(args.host, args.port, dev_runs=args.runs)
        case "worker":
            asyncio.run(_worker())
        case "run":
            subs = [s.strip() for s in args.subtitles.split(",") if s.strip()] if args.subtitles else None
            asyncio.run(_run_once(args.brand, args.brief, args.approve, args.language, subs))
        case "seed":
            asyncio.run(_seed())
        case "cron":
            asyncio.run(_cron(args.job))
        case "migrate":
            asyncio.run(_migrate(args.core_only))
        case "mcp":
            from .mcp_server import main as mcp_main

            mcp_main()


if __name__ == "__main__":
    main()
