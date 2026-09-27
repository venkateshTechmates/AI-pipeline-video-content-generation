"""Retries with jittered exponential backoff and provider fallback chains (PRD §11)."""

from __future__ import annotations

import asyncio
import logging
import random
from collections.abc import Awaitable, Callable, Sequence
from typing import TypeVar

T = TypeVar("T")
P = TypeVar("P")
log = logging.getLogger(__name__)


class PermanentError(Exception):
    """Do not retry (bad input, policy violation, auth)."""


class BudgetExceeded(PermanentError):
    pass


class AllProvidersFailed(Exception):
    def __init__(self, errors: list[tuple[str, BaseException]]):
        self.errors = errors
        super().__init__("; ".join(f"{n}: {e}" for n, e in errors))


def backoff_delay(attempt: int, base: float = 1.0, cap: float = 30.0) -> float:
    """Full-jitter exponential backoff."""
    return random.uniform(0, min(cap, base * (2**attempt)))


async def retry_async(
    fn: Callable[[], Awaitable[T]],
    *,
    attempts: int = 3,
    base: float = 1.0,
    cap: float = 30.0,
    on_retry: Callable[[int, BaseException], None] | None = None,
) -> T:
    last: BaseException | None = None
    for i in range(attempts):
        try:
            return await fn()
        except PermanentError:
            raise
        except Exception as e:  # noqa: BLE001
            last = e
            if i == attempts - 1:
                break
            if on_retry:
                on_retry(i + 1, e)
            await asyncio.sleep(backoff_delay(i, base, cap))
    assert last is not None
    raise last


async def with_fallback(
    providers: Sequence[P],
    call: Callable[[P], Awaitable[T]],
    *,
    name: Callable[[P], str] = lambda p: getattr(p, "name", type(p).__name__),
    attempts_each: int = 3,  # 1 try + 2 retries (PRD: per-shot retry x2 then fallback)
    base: float = 1.0,
    kind: str | None = None,  # trace span kind (video/tts/music/...): one span per attempt
) -> tuple[T, P]:
    from . import tracing

    errors: list[tuple[str, BaseException]] = []
    for i, p in enumerate(providers):
        attempt = 0

        async def traced(p: P = p) -> T:
            nonlocal attempt
            attempt += 1
            if attempt > 1:
                tracing.event("retry", provider=name(p), attempt=attempt)
            if kind is None:
                return await call(p)
            fallback_from = errors[-1][0] if errors and attempt == 1 else None
            async with tracing.span(f"{kind}:{name(p)}", kind=kind, provider=name(p),  # type: ignore[arg-type]
                                    attempt=attempt, fallback_from=fallback_from):
                return await call(p)

        try:
            result = await retry_async(traced, attempts=attempts_each, base=base)
            return result, p
        except BudgetExceeded:
            raise
        except Exception as e:  # noqa: BLE001
            log.warning("provider %s failed: %s", name(p), e)
            errors.append((name(p), e))
            if i + 1 < len(providers):
                tracing.event("fallback", from_provider=name(p), to_provider=name(providers[i + 1]),
                              error=str(e)[:300])
    raise AllProvidersFailed(errors)
