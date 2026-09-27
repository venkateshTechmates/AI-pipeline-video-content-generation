import type { Span, SpanKind } from "../types";

// ------------------------------------------------------------------ time helpers

export const ms = (s: string | null | undefined): number => (s ? new Date(s).getTime() : NaN);

export interface TSpan extends Span {
  t0: number; // start epoch ms
  t1: number; // end epoch ms (now for open spans)
  open: boolean; // still running (no end_at)
  depth: number;
  children: TSpan[];
  parent: TSpan | null;
  orphan: boolean; // parent_id set but parent not in the trace
  descErrors: number; // errors in the subtree (excluding self)
}

export interface SpanTree {
  roots: TSpan[];
  byId: Map<string, TSpan>;
  list: TSpan[]; // depth-first order
  t0: number;
  t1: number;
}

/**
 * Build the span tree. Spans whose parent is missing become roots. Children are
 * ordered by start time (then name). Open spans extend to `now`.
 */
export function buildTree(spans: Span[], now: number): SpanTree {
  const byId = new Map<string, TSpan>();
  for (const s of spans) {
    const t0 = ms(s.start_at);
    let t1 = ms(s.end_at);
    const open = !s.end_at;
    if (open) t1 = Math.max(t0, now);
    if (!isFinite(t1) && s.duration_ms != null) t1 = t0 + s.duration_ms;
    byId.set(s.id, {
      ...s,
      t0,
      t1: isFinite(t1) ? t1 : t0,
      open,
      depth: 0,
      children: [],
      parent: null,
      orphan: false,
      descErrors: 0,
    });
  }
  const roots: TSpan[] = [];
  for (const s of byId.values()) {
    const p = s.parent_id ? byId.get(s.parent_id) : undefined;
    if (p && p !== s) {
      s.parent = p;
      p.children.push(s);
    } else {
      s.orphan = !!s.parent_id;
      roots.push(s);
    }
  }
  const order = (a: TSpan, b: TSpan) => a.t0 - b.t0 || a.name.localeCompare(b.name);
  const list: TSpan[] = [];
  let t0 = Infinity;
  let t1 = -Infinity;
  // Iterative DFS (guards against cycles in malformed data).
  const seen = new Set<string>();
  const visit = (s: TSpan, depth: number): number => {
    if (seen.has(s.id)) return 0;
    seen.add(s.id);
    s.depth = depth;
    list.push(s);
    t0 = Math.min(t0, s.t0);
    t1 = Math.max(t1, s.t1);
    s.children.sort(order);
    let errs = 0;
    for (const c of s.children) errs += visit(c, depth + 1) + (c.status === "error" ? 1 : 0);
    s.descErrors = errs;
    return errs;
  };
  roots.sort(order);
  for (const r of roots) visit(r, 0);
  // Anything unreachable (cycle) becomes a root.
  for (const s of byId.values()) if (!seen.has(s.id)) {
    roots.push(s);
    visit(s, 0);
  }
  if (!isFinite(t0)) t0 = t1 = now;
  return { roots, byId, list, t0, t1 };
}

// ------------------------------------------------------------------ gap compression

/** Spans that represent waiting (human approval, scheduling), not work. */
export function isWaitSpan(s: Pick<Span, "name" | "attributes" | "events" | "kind">): boolean {
  if (s.kind === "run") return false;
  if (s.name === "approve" || /(^|[._-])(wait|approval|sleep|schedule)/i.test(s.name)) return true;
  if (s.attributes?.waiting === true) return true;
  return s.events?.some((e) => e.name === "paused") ?? false;
}

export interface Segment {
  kind: "active" | "gap";
  t0: number;
  t1: number;
}

export interface TimeScale {
  t0: number;
  t1: number;
  segments: Segment[];
  gaps: Segment[];
  activeMs: number;
}

/**
 * Split [t0, t1] into active segments and idle gaps. A gap is a stretch
 * longer than `threshold` between span boundaries during which no *working*
 * span (a leaf that is not a wait span) is open — e.g. the hours a run spends
 * awaiting human approval. Container spans (run, stage with children) and wait
 * spans may cross a gap; their bars are drawn with a break.
 */
export function buildScale(tree: SpanTree, threshold = 60_000): TimeScale {
  const { t0, t1 } = tree;
  const working = tree.list.filter((s) => s.children.length === 0 && !isWaitSpan(s));
  const bounds = new Set<number>([t0, t1]);
  for (const s of tree.list) {
    bounds.add(s.t0);
    bounds.add(s.t1);
    for (const e of s.events ?? []) {
      const t = ms(e.at);
      if (isFinite(t) && t >= t0 && t <= t1 && e.name !== "paused") bounds.add(t);
    }
  }
  const pts = [...bounds].filter((t) => isFinite(t)).sort((a, b) => a - b);
  const gaps: Segment[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (b - a <= threshold) continue;
    const busy = working.some((s) => s.t0 <= a && s.t1 >= b);
    if (!busy) gaps.push({ kind: "gap", t0: a, t1: b });
  }
  const segments: Segment[] = [];
  let cur = t0;
  for (const g of gaps) {
    if (g.t0 > cur) segments.push({ kind: "active", t0: cur, t1: g.t0 });
    segments.push(g);
    cur = g.t1;
  }
  if (t1 > cur || segments.length === 0) segments.push({ kind: "active", t0: cur, t1: Math.max(t1, cur) });
  const activeMs = segments.filter((s) => s.kind === "active").reduce((a, s) => a + (s.t1 - s.t0), 0);
  return { t0, t1, segments, gaps, activeMs };
}

export interface ProjSegment extends Segment {
  x0: number;
  x1: number;
  pxPerMs: number;
  index: number; // index among active segments
}

export interface Projection {
  x: (t: number) => number;
  width: number;
  gapPx: number;
  segments: ProjSegment[];
}

/**
 * Piecewise-linear projection: gaps are fixed-width breaks; active segments
 * share the rest in proportion to their duration, but each gets at least a
 * minimum share so a short burst after a long approval wait stays legible
 * (the break marker already signals the change of scale).
 */
export function project(scale: TimeScale, width: number, gapPx = 44): Projection {
  const nGaps = scale.gaps.length;
  const g = nGaps ? Math.min(gapPx, (width * 0.18) / nGaps) : 0;
  const usable = Math.max(1, width - g * nGaps);
  const active = scale.segments.filter((s) => s.kind === "active");
  const durs = active.map((s) => Math.max(0, s.t1 - s.t0));
  const total = durs.reduce((a, b) => a + b, 0);
  let shares = durs.map((d) => (total > 0 ? d / total : 1 / Math.max(1, active.length)));
  if (active.length > 1 && total > 0) {
    const m = Math.min(0.2, 0.5 / active.length);
    const fixed = new Set<number>();
    for (let iter = 0; iter < active.length; iter++) {
      const freeTotal = durs.reduce((a, d, i) => (fixed.has(i) ? a : a + d), 0);
      const freeShare = 1 - fixed.size * m;
      let changed = false;
      durs.forEach((d, i) => {
        if (!fixed.has(i) && (freeTotal <= 0 || (d / freeTotal) * freeShare < m)) {
          fixed.add(i);
          changed = true;
        }
      });
      if (!changed) break;
    }
    const freeTotal = durs.reduce((a, d, i) => (fixed.has(i) ? a : a + d), 0);
    const freeShare = 1 - fixed.size * m;
    shares = durs.map((d, i) => (fixed.has(i) || freeTotal <= 0 ? m : (d / freeTotal) * freeShare));
  }
  let x = 0;
  let ai = 0;
  const segments: ProjSegment[] = scale.segments.map((s) => {
    if (s.kind === "gap") {
      const seg = { ...s, x0: x, x1: x + g, pxPerMs: 0, index: -1 };
      x += g;
      return seg;
    }
    const w = shares[ai] * usable;
    const d = Math.max(0, s.t1 - s.t0);
    const seg = { ...s, x0: x, x1: x + w, pxPerMs: d > 0 ? w / d : 0, index: ai };
    ai++;
    x += w;
    return seg;
  });
  const fx = (t: number): number => {
    if (t <= scale.t0) return 0;
    for (const s of segments) {
      if (t <= s.t1) {
        const span = s.t1 - s.t0;
        return span > 0 ? s.x0 + ((t - s.t0) / span) * (s.x1 - s.x0) : s.x1;
      }
    }
    return width;
  };
  return { x: fx, width, gapPx: g, segments };
}

const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 21_600_000, 43_200_000, 86_400_000];

export function niceStep(pxPerMs: number, minPx = 84): number {
  if (pxPerMs <= 0) return 1000;
  for (const s of NICE) if (s * pxPerMs >= minPx) return s;
  return NICE[NICE.length - 1];
}

export interface Tick {
  x: number;
  offset: number; // ms since the segment's origin
  step: number;
  after: boolean; // in a segment after a break (label as "+offset")
}

/**
 * Axis ticks per active segment, each on its own nice step. The first segment
 * counts from trace start; segments after a break count from the break.
 */
export function ticks(p: Projection, t0: number, minPx = 84, gapClear = 72): Tick[] {
  const out: Tick[] = [];
  const gaps = p.segments.filter((g) => g.kind === "gap");
  for (const s of p.segments) {
    if (s.kind !== "active" || s.pxPerMs <= 0) continue;
    const origin = s.index === 0 ? t0 : s.t0;
    const step = niceStep(s.pxPerMs, minPx);
    const first = Math.ceil((s.t0 - origin) / step) * step;
    for (let off = first; origin + off <= s.t1 + 0.5; off += step) {
      const x = p.x(origin + off);
      if (gaps.some((g) => Math.abs(x - (g.x0 + g.x1) / 2) < gapClear)) continue;
      if (out.length && x - out[out.length - 1].x < minPx * 0.6) continue;
      if (x > p.width - 14) continue;
      out.push({ x, offset: off, step, after: s.index > 0 });
    }
  }
  return out;
}

// ------------------------------------------------------------------ critical path

/**
 * Critical path: walking back from the end of each span, the chain of children
 * that finished last (and, before them, the ones that finished before those
 * started). Multiple roots behave as children of a virtual trace root.
 */
export function criticalPath(tree: SpanTree): Set<string> {
  const out = new Set<string>();
  const walk = (children: TSpan[], until: number) => {
    let cursor = until;
    let first = true;
    const byEnd = [...children].sort((a, b) => b.t1 - a.t1 || a.t0 - b.t0);
    for (const c of byEnd) {
      if (c.t0 >= cursor) continue;
      // After the last finisher, only spans that ended before the cursor can
      // have gated it; overlapping siblings ran in parallel and are off-path.
      if (!first && c.t1 > cursor + 5) continue;
      out.add(c.id);
      walk(c.children, Math.min(c.t1, cursor));
      cursor = c.t0;
      first = false;
    }
  };
  walk(tree.roots, tree.t1 + 1);
  return out;
}

// ------------------------------------------------------------------ summaries

function unionMs(intervals: [number, number][]): number {
  if (!intervals.length) return 0;
  const iv = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [s, e] = iv[0];
  for (let i = 1; i < iv.length; i++) {
    const [a, b] = iv[i];
    if (a > e) {
      total += e - s;
      s = a;
      e = b;
    } else e = Math.max(e, b);
  }
  return total + (e - s);
}

export interface StageTime {
  name: string;
  ms: number; // wall time (parallel spans merged)
  count: number;
  errors: number;
  wait: boolean;
  first: number;
}

/** Wall time per stage name; waiting (approval) time is split out. */
export function stageTimes(tree: SpanTree): StageTime[] {
  const groups = new Map<string, TSpan[]>();
  for (const s of tree.list) {
    if (s.kind !== "stage") continue;
    const arr = groups.get(s.name) ?? [];
    arr.push(s);
    groups.set(s.name, arr);
  }
  const out: StageTime[] = [];
  for (const [name, arr] of groups) {
    // If this stage is nested under another stage (e.g. gen_shot under gen_shots), skip it:
    // its time is already inside the parent's bar.
    if (arr.every((s) => hasStageAncestor(s))) continue;
    const wait = arr.some(isWaitSpan);
    out.push({
      name,
      ms: unionMs(arr.map((s) => [s.t0, s.t1])),
      count: arr.length,
      errors: arr.filter((s) => s.status === "error").length,
      wait,
      first: Math.min(...arr.map((s) => s.t0)),
    });
  }
  return out.sort((a, b) => a.first - b.first);
}

function hasStageAncestor(s: TSpan): boolean {
  for (let p = s.parent; p; p = p.parent) if (p.kind === "stage") return true;
  return false;
}

export interface ProviderCost {
  provider: string;
  kind: SpanKind;
  cost: number;
  calls: number;
  errors: number;
  ms: number;
}

export function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return isFinite(n) ? n : 0;
}

function costEvents(s: Span): { provider: string | null; usd: number }[] {
  return (s.events ?? [])
    .filter((e) => e.name === "cost")
    .map((e) => ({
      provider: typeof e.attributes?.provider === "string" ? (e.attributes.provider as string) : null,
      usd: num(e.attributes?.usd ?? e.attributes?.cost_usd),
    }));
}

/** The provider a leaf span called: provider attr, else renderer, else (LLM) model. */
export function spanProvider(s: Span): string | null {
  const a = s.attributes ?? {};
  const p = a.provider ?? a.renderer ?? (s.kind === "llm" ? a.model : undefined);
  return typeof p === "string" && p ? p : null;
}

/**
 * Cost/calls per provider. Cost comes from `cost` events ({provider, usd}) when
 * the trace has them (the backend attaches them to stage spans), else from
 * `cost_usd` on spans that name a provider. Calls/errors/latency come from the
 * provider leaf spans.
 */
export function providerCosts(tree: SpanTree): ProviderCost[] {
  const m = new Map<string, ProviderCost>();
  const get = (p: string, kind: SpanKind) => {
    let cur = m.get(p);
    if (!cur) {
      cur = { provider: p, kind, cost: 0, calls: 0, errors: 0, ms: 0 };
      m.set(p, cur);
    }
    return cur;
  };
  const hasCostEvents = tree.list.some((s) => s.events?.some((e) => e.name === "cost"));
  for (const s of tree.list) {
    const p = spanProvider(s);
    if (p && s.kind !== "stage" && s.kind !== "run") {
      const cur = get(p, s.kind);
      cur.calls += 1;
      cur.errors += s.status === "error" ? 1 : 0;
      cur.ms += s.t1 - s.t0;
      if (!hasCostEvents) cur.cost += num(s.attributes.cost_usd);
    }
    if (hasCostEvents)
      for (const e of costEvents(s)) {
        const leafKind = s.children.find((c) => spanProvider(c) === e.provider)?.kind ?? s.kind;
        get(e.provider ?? "unattributed", leafKind === "stage" ? "internal" : leafKind).cost += e.usd;
      }
  }
  return [...m.values()].sort((a, b) => b.cost - a.cost || b.calls - a.calls);
}

/** Cost recorded on a span: cost_usd attribute, else the sum of its `cost` events. */
export function spanCost(s: Span): number | null {
  const v = s.attributes?.cost_usd;
  if (v !== undefined && v !== null) return num(v);
  const ev = costEvents(s);
  return ev.length ? ev.reduce((a, e) => a + e.usd, 0) : null;
}

export function subtreeCost(s: TSpan): number {
  let c = spanCost(s) ?? 0;
  for (const ch of s.children) c += subtreeCost(ch);
  return c;
}

export function eventCounts(spans: Span[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of spans) for (const e of s.events ?? []) out[e.name] = (out[e.name] ?? 0) + 1;
  return out;
}
