export function money(n: number | null | undefined, digits = 2): string {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return `$${v.toFixed(v !== 0 && Math.abs(v) < 0.01 ? 4 : digits)}`;
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function dateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function relTime(s: string | null | undefined): string {
  if (!s) return "—";
  const t = new Date(s).getTime();
  if (isNaN(t)) return s;
  const diff = (Date.now() - t) / 1000;
  const abs = Math.abs(diff);
  const fmt = (v: number, u: string) => `${Math.round(v)}${u} ${diff >= 0 ? "ago" : "from now"}`;
  if (abs < 60) return diff >= 0 ? "just now" : "in <1m";
  if (abs < 3600) return fmt(abs / 60, "m");
  if (abs < 86400) return fmt(abs / 3600, "h");
  return fmt(abs / 86400, "d");
}

export function duration(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return "—";
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  if (isNaN(a) || isNaN(b)) return "—";
  const s = Math.max(0, (b - a) / 1000);
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "yes" : "no";
  return JSON.stringify(v);
}

/** Convert a <input type="datetime-local"> value to an ISO string with offset. */
export function localInputToIso(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
