"""Waiting on long-running provider jobs (PRD §8 "Long-running gen").

A provider submits a job with a webhook URL and then calls `waiter.wait(...)`.
The FastAPI webhook handler (`/webhooks/fal`, `/webhooks/replicate`) calls
`waiter.resolve(request_id, payload)`, which wakes the waiting coroutine
immediately. If the webhook never arrives (different process, network issue)
the waiter polls the provider every `poll_interval` seconds, and gives up after
`timeout` (defaults: 20 s / 10 min).

Webhook payloads are also persisted via the repo so a separate worker process
picks them up on its next poll tick.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any


class ProviderTimeout(TimeoutError):
    pass


class JobWaiter:
    def __init__(self, poll_interval: float = 20.0, timeout: float = 600.0):
        self.poll_interval = poll_interval
        self.timeout = timeout
        self._futures: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._early: dict[str, dict[str, Any]] = {}  # webhook arrived before wait() registered

    def resolve(self, request_id: str, payload: dict[str, Any]) -> bool:
        fut = self._futures.get(request_id)
        if fut and not fut.done():
            fut.get_loop().call_soon_threadsafe(fut.set_result, payload)
            return True
        self._early[request_id] = payload
        return False

    async def wait(
        self,
        request_id: str,
        poll: Callable[[], Awaitable[dict[str, Any] | None]],
        *,
        poll_interval: float | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        """Return the finished payload from the webhook or from `poll()` (None = still running)."""
        if request_id in self._early:
            return self._early.pop(request_id)
        interval = self.poll_interval if poll_interval is None else poll_interval
        deadline = time.monotonic() + (self.timeout if timeout is None else timeout)
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[dict[str, Any]] = loop.create_future()
        self._futures[request_id] = fut
        try:
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ProviderTimeout(f"job {request_id} timed out")
                try:
                    return await asyncio.wait_for(asyncio.shield(fut), min(interval, remaining))
                except TimeoutError:
                    pass
                result = await poll()
                if result is not None:
                    return result
        finally:
            self._futures.pop(request_id, None)


_waiter: JobWaiter | None = None


def get_waiter() -> JobWaiter:
    global _waiter
    if _waiter is None:
        from ..config import get_settings

        s = get_settings()
        _waiter = JobWaiter(s.provider_poll_interval_s, s.provider_timeout_s)
    return _waiter
