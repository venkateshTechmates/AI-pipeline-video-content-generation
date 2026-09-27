"""Cost ledger, budget enforcement and tier downgrade (PRD §7 cross-cutting, §11 cost).

Every provider call records a ledger row. Before an expensive call the node asks
`ensure_budget` with an estimate: if the run would exceed its budget it is
downgraded (premium -> economy) when that fits, else aborted with
`BudgetExceeded`. The brand's daily cap is enforced the same way, and an alert
fires when spend crosses 80 %.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx

from .config import Settings
from .db import Repo, day_bounds
from .models import LedgerEntry, Tier
from .retry import BudgetExceeded

log = logging.getLogger(__name__)

# USD. Units: seconds of video / characters / tokens (per 1M) / per-call. Keep in sync with provider pricing.
PRICES: dict[str, float] = {
    # video (per generated second)
    "fal:kling-3.0": 0.084,
    "fal:seedance": 0.06,
    "fal:hailuo": 0.045,
    "replicate:kling-3.0": 0.09,
    "vertex:veo-3.1": 0.40,
    "vertex:veo-3.1-fast": 0.15,
    "vertex:veo-3.1-lite": 0.05,
    "runway:gen-4.5": 0.25,
    # tts (per 1k characters)
    "elevenlabs:tts": 0.18,
    "openai:tts": 0.015,
    # llm (per 1M tokens, blended in+out)
    "anthropic:llm": 6.0,
    "openai:llm": 5.0,
    "openai:embedding": 0.02,
    # music (per licensed track; subscription amortised)
    "music:track": 0.0,
    # render / publish
    "ffmpeg:render": 0.0,
    "remotion:render": 0.0,
    "creatomate:render": 0.25,  # per render
    "upload_post:post": 0.0,
    "ayrshare:post": 0.0,
    # offline fakes bill like the real thing so demos show realistic cost ledgers
    "fake:kling": 0.084,
    "fake:seedance": 0.06,
    "fake:veo": 0.40,
    "fake:tts": 0.18,
    "fake:music": 0.0,
    "fake:publish": 0.0,
    "fake": 0.0,
}


def price(key: str) -> float:
    if key in PRICES:
        return PRICES[key]
    prefix = key.split(":")[0]
    return PRICES.get(prefix, 0.0)


@dataclass
class BudgetDecision:
    tier: Tier
    downgraded: bool = False


class CostLedger:
    def __init__(self, repo: Repo, settings: Settings):
        self.repo = repo
        self.settings = settings
        self._alerted: set[tuple[str, str]] = set()

    async def charge(
        self, *, run_id: str, brand_id: str, stage: str, provider: str, units: float, unit_cost: float | None = None
    ) -> LedgerEntry:
        uc = price(provider) if unit_cost is None else unit_cost
        entry = LedgerEntry(
            run_id=run_id, brand_id=brand_id, stage=stage, provider=provider,
            units=round(units, 4), unit_cost=uc, total=round(units * uc, 4),
        )
        await self.repo.add_ledger(entry)
        await self._maybe_alert(run_id, brand_id)
        return entry

    async def brand_spend_today(self, brand_id: str) -> float:
        start, end = day_bounds(datetime.now(UTC).date())
        return sum(e.total for e in await self.repo.brand_ledger(brand_id, start, end))

    async def ensure_budget(
        self, *, run_id: str, brand_id: str, tier: Tier, estimate: float, economy_estimate: float | None = None
    ) -> BudgetDecision:
        """Raise BudgetExceeded or return the tier to use for the next call."""
        run = await self.repo.get_run(run_id)
        brand = await self.repo.get_brand(brand_id)
        spent_today = await self.brand_spend_today(brand_id)

        def fits(cost: float) -> bool:
            return run.cost_total + cost <= run.budget and spent_today + cost <= brand.daily_budget

        if fits(estimate):
            return BudgetDecision(tier)
        if tier == Tier.premium and economy_estimate is not None and fits(economy_estimate):
            log.warning("run %s downgraded premium -> economy (est %.2f)", run_id, estimate)
            await self.repo.update_run(run_id, tier=Tier.economy)
            return BudgetDecision(Tier.economy, downgraded=True)
        raise BudgetExceeded(
            f"budget exceeded: run {run.cost_total:.2f}+{estimate:.2f} > {run.budget:.2f} "
            f"or brand daily {spent_today:.2f} > {brand.daily_budget:.2f}"
        )

    async def _maybe_alert(self, run_id: str, brand_id: str) -> None:
        run = await self.repo.get_run(run_id)
        ratio = self.settings.budget_alert_ratio
        if run.budget and run.cost_total >= ratio * run.budget and (run_id, "run") not in self._alerted:
            self._alerted.add((run_id, "run"))
            await alert(self.settings, f"Run {run_id} at {run.cost_total:.2f}/{run.budget:.2f} USD")
        brand = await self.repo.get_brand(brand_id)
        day = datetime.now(UTC).date().isoformat()
        spent = await self.brand_spend_today(brand_id)
        if brand.daily_budget and spent >= ratio * brand.daily_budget and (brand_id, day) not in self._alerted:
            self._alerted.add((brand_id, day))
            await alert(self.settings, f"Brand {brand.name} daily spend {spent:.2f}/{brand.daily_budget:.2f} USD")


async def alert(settings: Settings, text: str) -> None:
    log.warning("ALERT: %s", text)
    if not settings.alert_webhook_url:
        return
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            await c.post(settings.alert_webhook_url, json={"text": f"[ClipForge] {text}"})
    except httpx.HTTPError as e:
        log.error("alert webhook failed: %s", e)
