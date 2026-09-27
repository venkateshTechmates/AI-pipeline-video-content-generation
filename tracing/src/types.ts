// API contract for the tracing endpoints (FastAPI backend).

export type SpanKind =
  | "run"
  | "stage"
  | "llm"
  | "video"
  | "tts"
  | "music"
  | "render"
  | "publish"
  | "qa"
  | "webhook"
  | "internal";

export type AttrValue = string | number | boolean | null;

export interface SpanEvent {
  name: string;
  at: string;
  attributes: Record<string, unknown>;
}

export interface Span {
  id: string;
  trace_id: string;
  parent_id: string | null;
  name: string;
  kind: SpanKind;
  status: "ok" | "error";
  start_at: string;
  end_at: string | null;
  duration_ms: number | null;
  attributes: Record<string, AttrValue>;
  events: SpanEvent[];
  error: string | null;
}

/** Optional per-stage breakdown (not in the base contract; rendered when present). */
export interface StageSlice {
  name: string;
  duration_ms: number;
  status?: "ok" | "error";
}

export interface TraceSummary {
  trace_id: string;
  run_id: string;
  brand_id: string;
  brand_name: string;
  title: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  span_count: number;
  error_count: number;
  cost_total: number;
  language: string;
  tier: string;
  stages?: StageSlice[];
}

export interface TraceDetail {
  trace: TraceSummary;
  spans: Span[];
}

export interface ProviderStat {
  name: string;
  kind: SpanKind;
  calls: number;
  errors: number;
  p50_ms: number;
  p95_ms: number;
  avg_ms: number;
  cost: number;
}

export interface StageStat {
  name: string;
  runs: number;
  errors: number;
  p50_ms: number;
  p95_ms: number;
}

export interface ThroughputDay {
  day: string;
  runs: number;
  errors: number;
  cost: number;
}

export interface TraceStats {
  providers: ProviderStat[];
  stages: StageStat[];
  throughput: ThroughputDay[];
  slowest: TraceSummary[];
}

export interface Brand {
  id: string;
  name: string;
  [k: string]: unknown;
}

export const RUN_STATUSES = [
  "queued",
  "running",
  "awaiting_approval",
  "resume_requested",
  "scheduled",
  "published",
  "failed",
  "aborted",
  "dead_letter",
] as const;

/** Statuses during which a trace is still growing (poll for new spans). */
export const LIVE_STATUSES = new Set(["queued", "running", "resume_requested"]);
