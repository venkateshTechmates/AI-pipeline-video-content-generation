"""Scheduled jobs triggered by Supabase pg_cron (via /cron/*) or `clipforge cron <job>`."""

from __future__ import annotations

import logging
from datetime import timedelta

from .ledger import alert
from .models import Run, utcnow
from .orchestrator import App, recover
from .schedule import slots_between

log = logging.getLogger(__name__)


async def schedule_calendar_runs(app: App, window: timedelta = timedelta(minutes=15)) -> dict[str, int]:
    """Create one run per upcoming calendar slot, `calendar_lead_hours` before it (enough to generate + approve)."""
    lead = timedelta(hours=app.settings.calendar_lead_hours)
    now = utcnow()
    created = 0
    for brand in await app.repo.list_brands():
        if not brand.calendar.slots:
            continue
        existing = {r.schedule for r in await app.repo.list_runs([brand.id], limit=500) if r.schedule}
        for at, platforms in slots_between(brand.calendar, now + lead, now + lead + window):
            if at in existing:
                continue
            run = Run(brand_id=brand.id, tier=brand.tier, budget=brand.budget_per_run, schedule=at,
                      platforms=[p for p in platforms if p in brand.kit.platforms] or platforms)
            await app.repo.create_run(run)
            created += 1
    return {"created": created}


async def collect_due_metrics(app: App) -> dict[str, int]:
    """Stage 11: pull views/likes/retention for posts at +24 h and +7 d."""
    n, failed = 0, 0
    for post, brand_id in await app.repo.posts_due_metrics(utcnow()):
        brand = await app.repo.get_brand(brand_id)
        source = app.deps.providers.metrics_for(brand)
        try:
            key = await app.repo.get_credential(brand.id, brand.publisher)
            m = await source.fetch(post, key)
            await app.repo.add_metrics(m)
            n += 1
        except Exception as e:  # noqa: BLE001
            failed += 1
            log.warning("metrics for post %s failed: %s", post.id, e)
    return {"collected": n, "failed": failed}


async def refresh_tokens(app: App, horizon: timedelta = timedelta(days=3)) -> dict[str, int]:
    """Platform OAuth is held by the publisher aggregator; we track expiry of per-brand profile keys and
    alert operators to re-link before they lapse."""
    expiring = await app.repo.expiring_credentials(utcnow() + horizon)
    for brand_id, provider in expiring:
        brand = await app.repo.get_brand(brand_id)
        await alert(app.settings, f"{provider} credential for brand {brand.name} expires within {horizon.days} days;"
                                  " re-link the social accounts in the publisher dashboard")
    return {"expiring": len(expiring)}


async def run_job(app: App, job: str) -> dict[str, int]:
    match job:
        case "calendar":
            return await schedule_calendar_runs(app)
        case "metrics":
            return await collect_due_metrics(app)
        case "refresh-tokens":
            return await refresh_tokens(app)
        case "recover":
            return await recover(app)
    raise ValueError(f"unknown job {job}")

