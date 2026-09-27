import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { supabase } from "./supabase";
import type { Brand } from "./types";

/** Generic async loader with reload(). */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fn, deps);

  const reload = useCallback(
    async (silent = false) => {
      const my = ++seq.current;
      if (!silent) setLoading(true);
      try {
        const v = await load();
        if (my === seq.current) {
          setData(v);
          setError(null);
        }
      } catch (e) {
        if (my === seq.current) setError(e);
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/**
 * Live refresh: Supabase Realtime postgres_changes on `runs` when configured,
 * else poll every `pollMs` while the tab is visible.
 */
export function useLiveRefresh(onChange: () => void, pollMs = 10_000): "realtime" | "polling" {
  const cb = useRef(onChange);
  cb.current = onChange;
  const mode = supabase ? "realtime" : "polling";

  useEffect(() => {
    if (supabase) {
      const client = supabase;
      const channel = client
        .channel("runs-awaiting-approval")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "runs", filter: "status=eq.awaiting_approval" },
          () => cb.current(),
        )
        // Runs leaving the queue (approved/rejected elsewhere) don't match the
        // filter anymore, so also listen for any UPDATE to catch removals.
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "runs" }, () => cb.current())
        .subscribe();
      const t = window.setInterval(() => cb.current(), pollMs * 6);
      return () => {
        window.clearInterval(t);
        void client.removeChannel(channel);
      };
    }
    return visibleInterval(() => cb.current(), pollMs);
  }, [pollMs]);

  return mode;
}

/** setInterval that skips ticks while the tab is hidden. Returns a disposer. */
function visibleInterval(fn: () => void, ms: number): () => void {
  const t = window.setInterval(() => {
    if (document.visibilityState === "visible") fn();
  }, ms);
  const onVis = () => document.visibilityState === "visible" && fn();
  document.addEventListener("visibilitychange", onVis);
  return () => {
    window.clearInterval(t);
    document.removeEventListener("visibilitychange", onVis);
  };
}

/** Poll `fn` every `ms` while visible (no-op when ms is 0). */
export function usePoll(fn: () => void, ms: number) {
  const cb = useRef(fn);
  cb.current = fn;
  useEffect(() => {
    if (!ms) return;
    return visibleInterval(() => cb.current(), ms);
  }, [ms]);
}

let brandsCache: Promise<Brand[]> | null = null;
export function useBrands() {
  return useAsync(() => {
    if (!brandsCache) {
      brandsCache = api
        .brands()
        .then((r) => r.items)
        .catch((e) => {
          brandsCache = null;
          throw e;
        });
    }
    return brandsCache;
  }, []);
}

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

export type ThemePref = "system" | "light" | "dark";

export function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(() => {
    const v = readStored("cf.theme");
    return v === "light" || v === "dark" ? v : "system";
  });
  useEffect(() => {
    const root = document.documentElement;
    if (pref === "system") delete root.dataset.theme;
    else root.dataset.theme = pref;
    writeStored("cf.theme", pref === "system" ? null : pref);
  }, [pref]);
  return [pref, setPref];
}

/** Current time, refreshed every `ms` so relative times/durations tick. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

/** True when the event target is a text field (so global shortcuts should not fire). */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable;
}
