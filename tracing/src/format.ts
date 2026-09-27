const NNBSP = " "; // narrow no-break space between number and unit

export function money(n: number | null | undefined, digits = 2): string {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  if (v !== 0 && Math.abs(v) < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function pct(n: number, digits = 0): string {
  if (!isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function compact(n: number): string {
  if (!isFinite(n)) return "—";
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(0)}K`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

/** Human duration: 842 ms · 4.2 s · 1 m 12 s · 2 h 14 m · 3 d 4 h */
export function dur(ms: number | null | undefined, opts: { precise?: boolean } = {}): string {
  if (ms === null || ms === undefined || !isFinite(ms)) return "—";
  const u = (v: string | number, unit: string) => `${v}${NNBSP}${unit}`;
  const a = Math.abs(ms);
  if (a < 1) return u(ms.toFixed(opts.precise ? 2 : 1).replace(/\.0+$/, ""), "ms");
  if (a < 1000) return u(Math.round(ms), "ms");
  const s = ms / 1000;
  if (s < 10) return u(s.toFixed(opts.precise ? 2 : 1), "s");
  if (s < 60) return u(opts.precise ? s.toFixed(1) : Math.round(s), "s");
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rs = Math.round(s - m * 60);
    return rs ? `${u(m, "m")} ${u(rs, "s")}` : u(m, "m");
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rm = m - h * 60;
    return rm ? `${u(h, "h")} ${u(rm, "m")}` : u(h, "h");
  }
  const d = Math.floor(h / 24);
  const rh = h - d * 24;
  return rh ? `${u(d, "d")} ${u(rh, "h")}` : u(d, "d");
}

/** Compact axis label for an offset from trace start. */
export function tickLabel(ms: number, step: number): string {
  if (ms === 0) return "0";
  if (step < 1000) return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(step < 100 ? 2 : 1)}s`;
  const s = ms / 1000;
  if (s < 60) return `${+s.toFixed(step < 1000 ? 1 : 0)}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s - h * 3600) / 60);
  const rs = Math.round(s - h * 3600 - m * 60);
  if (h) return `${h}h${m ? ` ${m}m` : ""}`;
  return rs ? `${m}m ${rs}s` : `${m}m`;
}

export function dateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fullDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function timeOnly(s: string | null | undefined, ms = false): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const t = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return ms ? `${t}.${String(d.getMilliseconds()).padStart(3, "0")}` : t;
}

export function relTime(s: string | null | undefined, now = Date.now()): string {
  if (!s) return "—";
  const t = new Date(s).getTime();
  if (isNaN(t)) return s;
  const diff = (now - t) / 1000;
  const abs = Math.abs(diff);
  const fmt = (v: number, unit: string) => (diff >= 0 ? `${Math.round(v)}${unit} ago` : `in ${Math.round(v)}${unit}`);
  if (abs < 45) return diff >= 0 ? "just now" : "in <1m";
  if (abs < 3600) return fmt(Math.max(1, abs / 60), "m");
  if (abs < 86400) return fmt(abs / 3600, "h");
  return fmt(abs / 86400, "d");
}

export function shortId(id: string, n = 8): string {
  return id.length > n ? id.slice(0, n) : id;
}

export function humanize(s: string): string {
  return s.replace(/[_.]/g, " ");
}

/** UTC calendar day. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function fmtAttr(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-US", { useGrouping: false }) : String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return JSON.stringify(v);
}

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  pt: "Portuguese",
  fr: "French",
  de: "German",
  it: "Italian",
  hi: "Hindi",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  ar: "Arabic",
  id: "Indonesian",
  nl: "Dutch",
  tr: "Turkish",
  pl: "Polish",
  ru: "Russian",
};
