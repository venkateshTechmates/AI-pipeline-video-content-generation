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
 * Live refresh: Supabase Realtime postgres_changes on `runs`
 * (status=awaiting_approval) when configured, else poll every `pollMs`.
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
      // Safety-net slow poll in case the socket drops.
      const t = window.setInterval(() => cb.current(), pollMs * 6);
      return () => {
        window.clearInterval(t);
        void client.removeChannel(channel);
      };
    }
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") cb.current();
    }, pollMs);
    return () => window.clearInterval(t);
  }, [pollMs]);

  return mode;
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
