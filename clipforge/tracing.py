"""Run tracing: nested spans (run → stage → provider/LLM call) persisted to `trace_spans` for the
tracing app (`tracing/`), plus OpenTelemetry export when configured (see telemetry.py).

trace_id == run_id. The current span travels in a ContextVar, so spans opened inside LangGraph nodes and
their parallel shot tasks nest correctly. Spans are written when they start (so in-progress work is
visible) and again when they end.
"""

from __future__ import annotations

import contextlib
import logging
from collections.abc import AsyncIterator
from contextvars import ContextVar
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from .models import new_id, utcnow
from .telemetry import span as otel_span

log = logging.getLogger(__name__)

SpanKind = Literal["run", "stage", "llm", "video", "tts", "music", "render", "publish", "qa", "webhook", "internal"]
MAX_ATTR = 500  # truncate long attribute strings (prompts)


class SpanEvent(BaseModel):
    name: str
    at: datetime = Field(default_factory=utcnow)
    attributes: dict[str, Any] = Field(default_factory=dict)


class Span(BaseModel):
    id: str = Field(default_factory=new_id)
    trace_id: str
    parent_id: str | None = None
    name: str
    kind: SpanKind = "internal"
    status: Literal["ok", "error"] = "ok"
    start_at: datetime = Field(default_factory=utcnow)
    end_at: datetime | None = None
    duration_ms: float | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)
    events: list[SpanEvent] = Field(default_factory=list)
    error: str | None = None

    def set(self, **attrs: Any) -> None:
        for k, v in attrs.items():
            if v is None:
                continue
            if not isinstance(v, (str, int, float, bool)):
                v = str(v)
            if isinstance(v, str) and len(v) > MAX_ATTR:
                v = v[:MAX_ATTR] + "…"
            self.attributes[k] = v

    def add(self, key: str, amount: float) -> None:
        self.attributes[key] = round(float(self.attributes.get(key, 0) or 0) + amount, 6)

    def event(self, name: str, **attrs: Any) -> None:
        self.events.append(SpanEvent(name=name, attributes={k: v for k, v in attrs.items() if v is not None}))


_current: ContextVar[Span | None] = ContextVar("clipforge_span", default=None)


def current_span() -> Span | None:
    return _current.get()


class Tracer:
    def __init__(self, repo: Any | None):
        self.repo = repo

    async def _write(self, s: Span) -> None:
        if self.repo is None:
            return
        try:
            await self.repo.upsert_span(s)
        except Exception as e:  # tracing must never break a run
            log.warning("span write failed (%s): %s", s.name, e)

    @contextlib.asynccontextmanager
    async def span(self, name: str, kind: SpanKind = "internal", trace_id: str | None = None,
                   **attrs: Any) -> AsyncIterator[Span | None]:
        parent = _current.get()
        tid = trace_id or (parent.trace_id if parent else None)
        if tid is None:  # outside any run: nothing to attach to
            yield None
            return
        s = Span(trace_id=tid, parent_id=parent.id if parent and parent.trace_id == tid else None,
                 name=name, kind=kind)
        s.set(**attrs)
        token = _current.set(s)
        await self._write(s)
        try:
            with otel_span(name, kind=kind, trace_id=tid, **{k: v for k, v in s.attributes.items()}):
                yield s
        except BaseException as e:
            if type(e).__name__ in ("GraphInterrupt", "GraphBubbleUp", "NodeInterrupt"):
                s.event("paused", reason="waiting for approval")  # not an error: human-in-the-loop
            elif isinstance(e, Exception):
                s.status = "error"
                s.error = f"{type(e).__name__}: {e}"[:4000]
            else:
                s.event("cancelled")
            raise
        finally:
            _current.reset(token)
            s.end_at = utcnow()
            s.duration_ms = round((s.end_at - s.start_at).total_seconds() * 1000, 1)
            await self._write(s)


_tracer = Tracer(None)


def set_tracer(t: Tracer) -> None:
    global _tracer
    _tracer = t


def tracer() -> Tracer:
    return _tracer


def span(name: str, kind: SpanKind = "internal", **attrs: Any):
    """`async with span("tts:elevenlabs", kind="tts", provider=...) as s:` under the current trace."""
    return _tracer.span(name, kind, **attrs)


def event(name: str, **attrs: Any) -> None:
    s = _current.get()
    if s is not None:
        s.event(name, **attrs)


def add_cost(total: float, provider: str) -> None:
    """Called by the cost ledger: attribute spend to the current span."""
    s = _current.get()
    if s is not None and total:
        s.add("cost_usd", total)
        s.event("cost", provider=provider, usd=round(total, 4))


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    v = sorted(values)
    k = (len(v) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(v) - 1)
    return round(v[lo] + (v[hi] - v[lo]) * (k - lo), 1)


class TracingLLM:
    """Wraps an LLM backend so every call becomes an `llm` span with model, tokens and language."""

    _METHODS = ("ideate", "script", "metadata", "moderate_text", "moderate_frames", "translate", "embed")

    def __init__(self, inner: Any, model: str):
        self._inner = inner
        self._model = model

    def __getattr__(self, item: str) -> Any:
        target = getattr(self._inner, item)
        if item not in self._METHODS:
            return target

        async def traced(*args: Any, **kwargs: Any) -> Any:
            async with span(f"llm.{item}", kind="llm", model=self._model, method=item,
                            provider=f"{self._model.split(':')[0]}:llm", language=kwargs.get("language")) as s:
                out = await target(*args, **kwargs)
                if s is not None and isinstance(out, tuple) and len(out) == 2 and isinstance(out[1], int):
                    s.set(tokens=out[1])
                    verdict = getattr(out[0], "safe", None)
                    if verdict is not None:
                        s.set(safe=verdict, categories=",".join(getattr(out[0], "categories", []) or []))
                return out

        return traced
