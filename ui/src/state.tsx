import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { isoDay } from "./format";
import { readStored, useAsync, useBrands, useLiveRefresh, usePoll, writeStored } from "./hooks";
import type { Brand, QueueItem } from "./types";

// ------------------------------------------------------------------ brand scope

interface BrandScope {
  brands: Brand[];
  brandsLoading: boolean;
  brandsError: unknown;
  /** "" = all brands */
  brandId: string;
  brand: Brand | null;
  setBrandId: (id: string) => void;
  brandName: (id: string) => string;
}

const BrandCtx = createContext<BrandScope | null>(null);

export function BrandScopeProvider({ children }: { children: ReactNode }) {
  const b = useBrands();
  const [brandId, setId] = useState(() => readStored("cf.brand") ?? "");
  const brands = b.data ?? [];
  // Drop a stale stored brand that no longer exists.
  const valid = !brandId || !b.data || brands.some((x) => x.id === brandId);
  const effective = valid ? brandId : "";
  const setBrandId = useCallback((id: string) => {
    setId(id);
    writeStored("cf.brand", id || null);
  }, []);
  const value = useMemo<BrandScope>(
    () => ({
      brands,
      brandsLoading: b.loading,
      brandsError: b.error,
      brandId: effective,
      brand: brands.find((x) => x.id === effective) ?? null,
      setBrandId,
      brandName: (id) => brands.find((x) => x.id === id)?.name ?? id.slice(0, 8),
    }),
    [brands, b.loading, b.error, effective, setBrandId],
  );
  return <BrandCtx.Provider value={value}>{children}</BrandCtx.Provider>;
}

export function useBrandScope(): BrandScope {
  const v = useContext(BrandCtx);
  if (!v) throw new Error("BrandScopeProvider missing");
  return v;
}

// ------------------------------------------------------------------ queue

interface QueueState {
  items: QueueItem[];
  loading: boolean;
  error: unknown;
  live: "realtime" | "polling";
  reload: () => void;
  /** Optimistically drop a run (after a decision); the next refresh reconciles. */
  remove: (runId: string) => void;
  restore: (item: QueueItem) => void;
}

const QueueCtx = createContext<QueueState | null>(null);

export function QueueProvider({ children }: { children: ReactNode }) {
  const { brandId } = useBrandScope();
  const q = useAsync(() => api.queue(brandId || undefined).then((r) => r.items), [brandId]);
  // Runs decided in this tab stay hidden until the server stops listing them
  // (approve -> resume_requested is immediate, but avoid flicker on a racing poll).
  const hidden = useRef(new Map<string, number>());
  const reload = useCallback(() => void q.reload(true), [q.reload]);
  const live = useLiveRefresh(reload, 10_000);

  const now = Date.now();
  for (const [id, t] of hidden.current) if (now - t > 30_000) hidden.current.delete(id);
  const items = (q.data ?? []).filter((i) => !hidden.current.has(i.run.id));

  const value: QueueState = {
    items,
    loading: q.loading && !q.data,
    error: q.error,
    live,
    reload,
    remove: (id) => {
      hidden.current.set(id, Date.now());
      q.setData((cur) => (cur ? [...cur] : cur));
    },
    restore: (item) => {
      hidden.current.delete(item.run.id);
      q.setData((cur) => (cur ? [...cur] : cur));
    },
  };
  return <QueueCtx.Provider value={value}>{children}</QueueCtx.Provider>;
}

export function useQueue(): QueueState {
  const v = useContext(QueueCtx);
  if (!v) throw new Error("QueueProvider missing");
  return v;
}

// ------------------------------------------------------------------ spend today

/** Today's (UTC) spend across the brands in scope, vs their summed daily budgets. */
export function useSpendToday() {
  const { brands, brandId } = useBrandScope();
  const scope = brandId ? brands.filter((b) => b.id === brandId) : brands;
  const key = scope.map((b) => b.id).join(",");
  const s = useAsync(async () => {
    const today = isoDay(new Date());
    const res = await Promise.all(scope.map((b) => api.brandCosts(b.id, { from: today, to: today })));
    return res.reduce((sum, r) => sum + r.total, 0);
  }, [key]);
  usePoll(() => void s.reload(true), 30_000);
  const budget = scope.reduce((sum, b) => sum + b.daily_budget, 0);
  return { spent: s.data, budget, ready: s.data !== null };
}

// ------------------------------------------------------------------ toasts

export type ToastTone = "success" | "info" | "warn" | "error";
interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}

const ToastCtx = createContext<((t: Omit<Toast, "id">) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = ++seq.current;
    setToasts((cur) => [...cur.slice(-3), { ...t, id }]);
    window.setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), t.tone === "error" ? 7000 : 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span className="toast-dot" aria-hidden />
            <div>
              <div className="toast-title">{t.title}</div>
              {t.body && <div className="toast-body">{t.body}</div>}
            </div>
            <button
              className="icon-btn toast-close"
              aria-label="Dismiss"
              onClick={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const v = useContext(ToastCtx);
  if (!v) throw new Error("ToastProvider missing");
  return v;
}
