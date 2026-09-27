import { getAccessToken } from "./supabase";
import type {
  ApprovalDecision,
  Brand,
  BrandCosts,
  BrandPatch,
  LanguageInfo,
  QueueItem,
  Run,
  RunCreateBody,
  RunDetail,
  RunEvent,
  RunStatus,
} from "./types";

export const API_URL: string = ((import.meta.env.VITE_API_URL as string | undefined) || "/api").replace(/\/+$/, "");

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

async function request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(buildUrl(path, opts.query), {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
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
    } else if (typeof data === "string" && data) {
      msg = data;
    }
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

export const api = {
  queue: (brandId?: string) => request<{ items: QueueItem[] }>("GET", "/queue", { query: { brand_id: brandId } }),

  runs: (params: { brand_id?: string; status?: RunStatus | ""; limit?: number } = {}) =>
    request<{ items: Run[] }>("GET", "/runs", { query: params }),

  run: (id: string) => request<RunDetail>("GET", `/runs/${encodeURIComponent(id)}`),

  createRun: (body: RunCreateBody) => request<{ run_id: string }>("POST", "/runs", { body }),

  decide: (id: string, decision: ApprovalDecision) =>
    request<{ status: string }>("POST", `/runs/${encodeURIComponent(id)}/approve`, { body: decision }),

  retry: (id: string) => request<{ status: string }>("POST", `/runs/${encodeURIComponent(id)}/retry`),

  brands: () => request<{ items: Brand[] }>("GET", "/brands"),

  languages: () => request<{ items: LanguageInfo[] }>("GET", "/languages"),

  brand: (id: string) => request<Brand>("GET", `/brands/${encodeURIComponent(id)}`),

  patchBrand: (id: string, patch: BrandPatch) =>
    request<Brand>("PATCH", `/brands/${encodeURIComponent(id)}`, { body: patch }),

  putCredential: (id: string, provider: Brand["publisher"], token: string) =>
    request<void>("POST", `/brands/${encodeURIComponent(id)}/credentials`, { body: { provider, token } }),

  brandCosts: (id: string, range: { from?: string; to?: string } = {}) =>
    request<BrandCosts>("GET", `/brands/${encodeURIComponent(id)}/costs`, { query: range }),
};

/**
 * Subscribe to a run's SSE stream. EventSource cannot set headers, so the JWT
 * is passed as `?token=`. Returns an unsubscribe function.
 */
export function subscribeRunEvents(
  id: string,
  onEvent: (e: RunEvent) => void,
  onStateChange?: (connected: boolean) => void,
): () => void {
  let es: EventSource | null = null;
  let closed = false;
  void getAccessToken().then((token) => {
    if (closed) return;
    es = new EventSource(buildUrl(`/runs/${encodeURIComponent(id)}/events`, { token: token ?? undefined }));
    es.onopen = () => onStateChange?.(true);
    es.onerror = () => onStateChange?.(false); // EventSource auto-reconnects
    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as RunEvent;
        if (data && typeof data === "object" && "type" in data) onEvent(data);
      } catch {
        /* ignore keep-alives / malformed frames */
      }
    };
  });
  return () => {
    closed = true;
    es?.close();
  };
}
