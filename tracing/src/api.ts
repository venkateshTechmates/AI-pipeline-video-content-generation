import { getAccessToken } from "./supabase";
import type { Brand, TraceDetail, TraceStats, TraceSummary } from "./types";

export const API_URL: string = ((import.meta.env.VITE_API_URL as string | undefined) || "/api").replace(/\/+$/, "");
export const MOCK = import.meta.env.VITE_MOCK === "1" || import.meta.env.VITE_MOCK === "true";

const REVIEW_UI = ((import.meta.env.VITE_REVIEW_UI_URL as string | undefined) || "http://localhost:5173").replace(
  /\/+$/,
  "",
);

/** Link to the run page in the review UI. Accepts a base URL or a template with ":id". */
export function reviewRunUrl(runId: string): string {
  const id = encodeURIComponent(runId);
  return REVIEW_UI.includes(":id") ? REVIEW_UI.replace(":id", id) : `${REVIEW_UI}/runs/${id}`;
}

/** Review UI home (runs list). */
export function reviewUiHome(): string {
  if (!REVIEW_UI.includes(":id")) return `${REVIEW_UI}/runs`;
  try {
    return new URL(REVIEW_UI.replace(":id", "x")).origin + "/runs";
  } catch {
    return REVIEW_UI.split("/runs")[0] + "/runs";
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function buildUrl(path: string, query?: Query): string {
  const qs = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
  }
  const s = qs.toString();
  return `${API_URL}${path}${s ? `?${s}` : ""}`;
}

// ---- connection health (shown in the sidebar) --------------------------------

type Health = { ok: boolean | null; at: number; message?: string };
let health: Health = { ok: null, at: 0 };
const listeners = new Set<(h: Health) => void>();
function setHealth(h: Health) {
  health = h;
  listeners.forEach((l) => l(h));
}
export function getHealth(): Health {
  return health;
}
export function onHealth(fn: (h: Health) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function request<T>(method: string, path: string, opts: { query?: Query; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), { method, headers, signal: opts.signal });
  } catch (e) {
    if ((e as Error).name !== "AbortError") setHealth({ ok: false, at: Date.now(), message: "Network error" });
    throw e;
  }
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    if (data && typeof data === "object" && "detail" in data) {
      const d = (data as { detail: unknown }).detail;
      msg = typeof d === "string" ? d : JSON.stringify(d);
    } else if (typeof data === "string" && data && data.length < 300) {
      msg = data;
    }
    setHealth({ ok: res.status < 500, at: Date.now(), message: msg });
    throw new ApiError(res.status, msg, data);
  }
  setHealth({ ok: true, at: Date.now() });
  return data as T;
}

export interface TraceQuery {
  brand_id?: string;
  status?: string;
  q?: string;
  limit?: number;
}

export interface StatsQuery {
  from: string;
  to: string;
  brand_id?: string;
}

interface Api {
  traces(q: TraceQuery): Promise<{ items: TraceSummary[] }>;
  trace(id: string): Promise<TraceDetail>;
  stats(q: StatsQuery): Promise<TraceStats>;
  brands(): Promise<{ items: Brand[] }>;
}

const http: Api = {
  traces: (q) => request("GET", "/traces", { query: { limit: 50, ...q } }),
  trace: (id) => request("GET", `/traces/${encodeURIComponent(id)}`),
  stats: (q) => request("GET", "/traces/stats", { query: { ...q } }),
  brands: () => request("GET", "/brands"),
};

// Fixture mode: lazily import the mock so it is not in production bundles.
let mockApi: Promise<Api> | null = null;
function viaMock<K extends keyof Api>(k: K): Api[K] {
  return ((...args: unknown[]) => {
    mockApi ??= import("./mock").then((m) => m.mockApi as Api);
    return mockApi.then((m) => {
      setHealth({ ok: true, at: Date.now() });
      return (m[k] as (...a: unknown[]) => unknown)(...args);
    });
  }) as Api[K];
}

export const api: Api = MOCK
  ? { traces: viaMock("traces"), trace: viaMock("trace"), stats: viaMock("stats"), brands: viaMock("brands") }
  : http;
