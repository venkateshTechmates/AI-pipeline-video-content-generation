"""OpenTelemetry setup: traces per run/stage -> OTLP (Grafana Tempo) and Langfuse (LLM traces).

Optional: without the `otel` extra or endpoints configured, spans are no-ops.
Pydantic AI agents are instrumented so prompts/outputs/token usage land in Langfuse.
"""

from __future__ import annotations

import base64
import contextlib
import logging
from collections.abc import Iterator
from typing import Any

from .config import Settings

log = logging.getLogger(__name__)
_tracer: Any = None


def setup_telemetry(settings: Settings, service: str = "clipforge") -> None:
    global _tracer
    if not (settings.otel_exporter_otlp_endpoint or settings.langfuse_public_key):
        return
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError:
        log.warning("opentelemetry not installed; `pip install clipforge[otel]` to enable tracing")
        return
    provider = TracerProvider(resource=Resource.create({"service.name": service}))
    if settings.otel_exporter_otlp_endpoint:
        provider.add_span_processor(BatchSpanProcessor(
            OTLPSpanExporter(endpoint=settings.otel_exporter_otlp_endpoint.rstrip("/") + "/v1/traces")))
    if settings.langfuse_public_key and settings.langfuse_secret_key:
        auth = base64.b64encode(f"{settings.langfuse_public_key}:{settings.langfuse_secret_key}".encode()).decode()
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(
            endpoint=settings.langfuse_host.rstrip("/") + "/api/public/otel/v1/traces",
            headers={"Authorization": f"Basic {auth}"})))
    trace.set_tracer_provider(provider)
    _tracer = trace.get_tracer("clipforge")
    try:
        from pydantic_ai import Agent

        Agent.instrument_all()
    except Exception as e:  # noqa: BLE001
        log.warning("pydantic-ai instrumentation unavailable: %s", e)


@contextlib.contextmanager
def span(name: str, **attrs: Any) -> Iterator[Any]:
    if _tracer is None:
        yield None
        return
    with _tracer.start_as_current_span(name) as s:
        for k, v in attrs.items():
            if v is not None:
                s.set_attribute(k, v if isinstance(v, (str, int, float, bool)) else str(v))
        yield s
