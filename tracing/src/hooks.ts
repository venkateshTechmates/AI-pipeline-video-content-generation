import { useCallback, useEffect, useRef, useState } from "react";

/** Generic async loader with reload(silent). Keeps last data while reloading. */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const ctrl = useRef<AbortController | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fn, deps);

  const reload = useCallback(
    async (silent = false) => {
      const my = ++seq.current;
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      if (!silent) setLoading(true);
      try {
        const v = await load(c.signal);
        if (my === seq.current) {
          setData(v);
          setError(null);
        }
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        if (my === seq.current) setError(e);
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    void reload();
    return () => ctrl.current?.abort();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/** setInterval that skips ticks while the tab is hidden; fires on becoming visible. */
export function usePoll(fn: () => void, ms: number) {
  const cb = useRef(fn);
  cb.current = fn;
  useEffect(() => {
    if (!ms) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") cb.current();
    }, ms);
    const onVis = () => document.visibilityState === "visible" && cb.current();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ms]);
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
    const v = readStored("cft.theme");
    return v === "light" || v === "dark" ? v : "system";
  });
  useEffect(() => {
    const root = document.documentElement;
    if (pref === "system") delete root.dataset.theme;
    else root.dataset.theme = pref;
    writeStored("cft.theme", pref === "system" ? null : pref);
  }, [pref]);
  return [pref, setPref];
}

/** Current time, refreshed every `ms` (0 = frozen). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!ms) return;
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
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

/** Element width via ResizeObserver. */
export function useWidth<T extends HTMLElement>(): [React.RefCallback<T>, number] {
  const [w, setW] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    ro.current?.disconnect();
    if (!el) return;
    setW(el.clientWidth);
    ro.current = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.current.observe(el);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
  return [ref, w];
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
