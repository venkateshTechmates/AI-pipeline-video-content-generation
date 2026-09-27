import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronRight, CornerDownRight, RotateCw, Zap } from "lucide-react";
import { dur, money, tickLabel } from "../format";
import { useWidth } from "../hooks";
import { kindColor } from "../lib/kinds";
import {
  isWaitSpan,
  ms,
  project,
  spanCost,
  ticks as makeTicks,
  type Projection,
  type SpanTree,
  type TimeScale,
  type TSpan,
} from "../lib/timeline";
import type { SpanKind } from "../types";
import { KindIcon } from "./ui";

export interface Row {
  span: TSpan;
  dim: boolean; // kept only as an ancestor of a filtered match
}

/** Depth-first visible rows given collapsed ids and an optional kind filter. */
export function visibleRows(tree: SpanTree, collapsed: Set<string>, kinds: Set<SpanKind> | null): Row[] {
  const keep = new Map<string, boolean>(); // id -> matched itself
  if (kinds && kinds.size) {
    const mark = (s: TSpan): boolean => {
      let any = false;
      for (const c of s.children) any = mark(c) || any;
      const self = kinds.has(s.kind);
      if (self || any) keep.set(s.id, self);
      return self || any;
    };
    tree.roots.forEach(mark);
  }
  const rows: Row[] = [];
  const walk = (s: TSpan) => {
    if (kinds && kinds.size && !keep.has(s.id)) return;
    rows.push({ span: s, dim: !!(kinds && kinds.size && !keep.get(s.id)) });
    if (collapsed.has(s.id)) return;
    s.children.forEach(walk);
  };
  tree.roots.forEach(walk);
  return rows;
}

const MARKER_EVENTS: Record<string, string> = {
  retry: "warn",
  fallback: "warn",
  cache_hit: "success",
  paused: "accent",
};

interface Props {
  tree: SpanTree;
  scale: TimeScale;
  rows: Row[];
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string, open: boolean) => void;
  critical: Set<string> | null;
}

export function Waterfall({ tree, scale, rows, collapsed, onToggle, selectedId, onSelect, critical }: Props) {
  const [axisRef, width] = useWidth<HTMLDivElement>();
  const p = useMemo(() => project(scale, Math.max(width, 120), 64), [scale, width]);
  const tks = useMemo(() => makeTicks(p, scale.t0, 88), [p, scale.t0]);
  const [tip, setTip] = useState<{ span: TSpan; x: number; y: number } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const handleSelect = useCallback((id: string) => {
    setFocusId(id);
    onSelectRef.current(id, true);
  }, []);
  const handleHover = useCallback((s: TSpan | null, x: number, y: number) => setTip(s ? { span: s, x, y } : null), []);
  const register = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const cursorId = focusId && rows.some((r) => r.span.id === focusId) ? focusId : selectedId ?? rows[0]?.span.id ?? null;

  const focusRow = useCallback((id: string) => {
    setFocusId(id);
    const el = rowRefs.current.get(id);
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest" });
    }
  }, []);

  // Keep keyboard cursor in sync with outside selection.
  useEffect(() => {
    if (selectedId) setFocusId(selectedId);
  }, [selectedId]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!rows.length) return;
    const i = Math.max(
      0,
      rows.findIndex((r) => r.span.id === cursorId),
    );
    const cur = rows[i].span;
    const go = (j: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, j))];
      focusRow(r.span.id);
      onSelect(r.span.id, false);
    };
    switch (e.key) {
      case "ArrowDown":
      case "j":
        go(i + 1);
        break;
      case "ArrowUp":
      case "k":
        go(i - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(rows.length - 1);
        break;
      case "ArrowRight":
        if (cur.children.length && collapsed.has(cur.id)) onToggle(cur.id);
        else if (cur.children.length) go(i + 1);
        else return;
        break;
      case "ArrowLeft":
        if (cur.children.length && !collapsed.has(cur.id)) onToggle(cur.id);
        else if (cur.parent) {
          const j = rows.findIndex((r) => r.span.id === cur.parent!.id);
          if (j >= 0) go(j);
        } else return;
        break;
      case "Enter":
      case " ":
        onSelect(cur.id, true);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const gapSegs = p.segments.filter((s) => s.kind === "gap");

  return (
    <div className="wf-scroll">
      <div className={`wf ${critical ? "critical" : ""}`}>
        <div className="wf-head">
          <div className="wf-head-name">
            Span <span className="tabular" style={{ fontWeight: 500 }}>· {rows.length}</span>
          </div>
          <div className="wf-axis" ref={axisRef} aria-hidden>
            {width > 0 &&
              tks.map((t, i) => (
                <span key={`${t.offset}`} className={`wf-tick ${i === 0 ? "first" : ""}`} style={{ left: t.x }}>
                  {tickLabel(t.offset, t.step)}
                </span>
              ))}
            {width > 0 &&
              gapSegs.map((g) => (
                <span key={g.t0} className="wf-gap-label" style={{ left: (g.x0 + g.x1) / 2 }} title="Idle time collapsed">
                  ⋯ {dur(g.t1 - g.t0)} waiting
                </span>
              ))}
          </div>
        </div>

        <div
          className="wf-body"
          role="tree"
          aria-label="Span waterfall"
          aria-multiselectable={false}
          onKeyDown={onKeyDown}
          onMouseLeave={() => setTip(null)}
        >
          {width > 0 && (
            <div className="wf-grid" aria-hidden>
              {tks.map((t) => (
                <span key={t.offset} className="wf-gridline" style={{ left: t.x }} />
              ))}
              {gapSegs.map((g) => (
                <span key={g.t0} className="wf-gap-band" style={{ left: g.x0, width: Math.max(2, g.x1 - g.x0) }} />
              ))}
            </div>
          )}
          {rows.map((r) => (
            <WfRow
              key={r.span.id}
              row={r}
              p={p}
              width={width}
              collapsed={collapsed.has(r.span.id)}
              selected={r.span.id === selectedId}
              tabbable={r.span.id === cursorId}
              crit={!!critical?.has(r.span.id)}
              onToggle={onToggle}
              onSelect={handleSelect}
              onHover={handleHover}
              register={register}
            />
          ))}
          {rows.length === 0 && <div className="wf-empty">No spans match the current filter.</div>}
        </div>
      </div>
      {tip && <SpanTip span={tip.span} x={tip.x} y={tip.y} t0={tree.t0} />}
    </div>
  );
}

interface RowProps {
  row: Row;
  p: Projection;
  width: number;
  collapsed: boolean;
  selected: boolean;
  tabbable: boolean;
  crit: boolean;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onHover: (s: TSpan | null, x: number, y: number) => void;
  register: (id: string, el: HTMLDivElement | null) => void;
}

const WfRow = memo(function WfRow({ row, p, width, collapsed, selected, tabbable, crit, onToggle, onSelect, onHover, register }: RowProps) {
  const s = row.span;
  const hasKids = s.children.length > 0;
  const x0 = p.x(s.t0);
  const x1 = p.x(s.t1);
  const w = Math.max(2, x1 - x0);
  const wait = isWaitSpan(s);
  const container = hasKids && s.kind !== "llm";
  const err = s.status === "error";
  const label = s.open ? `${dur(s.t1 - s.t0)} · running` : dur(s.duration_ms ?? s.t1 - s.t0);
  const labelW = label.length * 6.2 + 8;
  const labelRight = x1 + 6 + labelW <= width;
  const labelLeft = !labelRight && x0 - 6 - labelW >= 0;

  const retries = s.events.filter((e) => e.name === "retry").length;
  const attempt = typeof s.attributes.attempt === "number" ? s.attributes.attempt : 1;
  const fallback = s.events.some((e) => e.name === "fallback") || !!s.attributes.fallback_from;
  const cache = s.events.some((e) => e.name === "cache_hit");
  const shot = s.attributes.shot_index;

  const cls = ["wf-bar", container ? "container" : "", wait ? "wait" : "", err ? "error" : "", s.open ? "open" : "", crit ? "crit" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={(el) => register(s.id, el)}
      id={`span-${s.id}`}
      className={`wf-row ${selected ? "selected" : ""} ${err ? "is-error" : ""} ${row.dim ? "ancestor-only" : ""} ${crit ? "crit-row" : ""}`}
      role="treeitem"
      aria-level={s.depth + 1}
      aria-expanded={hasKids ? !collapsed : undefined}
      aria-selected={selected}
      aria-label={`${s.name}, ${s.kind}, ${label}${err ? ", error" : ""}`}
      tabIndex={tabbable ? 0 : -1}
      onClick={() => onSelect(s.id)}
      onMouseMove={(e) => onHover(s, e.clientX, e.clientY)}
    >
      <div className="wf-name">
        <span className="wf-indent" style={{ width: s.depth * 14 }} aria-hidden />
        {hasKids ? (
          <button
            type="button"
            className={`wf-caret ${collapsed ? "" : "open"}`}
            tabIndex={-1}
            aria-label={collapsed ? "Expand" : "Collapse"}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(s.id);
            }}
          >
            <ChevronRight size={13} />
          </button>
        ) : (
          <span className="wf-caret-spacer" />
        )}
        <KindIcon kind={s.kind} size={11} />
        <span className="wf-name-text" title={s.name}>
          {s.name}
          {shot !== undefined && shot !== null && <span className="dim"> #{String(shot)}</span>}
          {s.orphan && <span className="dim"> (orphan)</span>}
        </span>
        <span className="wf-flags">
          {(retries > 0 || attempt > 1) && (
            <span className="wf-flag tone-warn" title={retries ? `${retries} retr${retries > 1 ? "ies" : "y"}` : `attempt ${attempt}`}>
              <RotateCw size={9} aria-hidden />
              {retries || attempt}
            </span>
          )}
          {fallback && (
            <span className="wf-flag tone-warn" title="Provider fallback">
              <CornerDownRight size={9} aria-hidden />
            </span>
          )}
          {cache && (
            <span className="wf-flag tone-success" title="Cache hit">
              <Zap size={9} aria-hidden />
            </span>
          )}
          {collapsed && s.descErrors > 0 && (
            <span className="wf-flag tone-danger" title={`${s.descErrors} error span(s) inside`}>
              {s.descErrors}
            </span>
          )}
        </span>
      </div>
      <div className="wf-track">
        {width > 0 && (
          <>
            <span className={cls} style={{ left: x0, width: w, ["--kc" as string]: kindColor(s.kind) }} />
            {s.events.map((e, i) => {
              const tone = MARKER_EVENTS[e.name];
              if (!tone) return null;
              const t = ms(e.at);
              if (!isFinite(t)) return null;
              return <span key={i} className={`wf-event tone-${tone}`} style={{ left: p.x(t) }} />;
            })}
            {(labelRight || labelLeft) && (
              <span
                className={`wf-bar-label ${err ? "error" : ""}`}
                style={labelRight ? { left: x1 + 6 } : { left: x0 - 6, transform: "translateX(-100%)" }}
              >
                {label}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
});

function SpanTip({ span: s, x, y, t0 }: { span: TSpan; x: number; y: number; t0: number }) {
  const cost = spanCost(s);
  const provider = (s.attributes.provider ?? s.attributes.renderer) as string | undefined;
  const model = s.attributes.model as string | undefined;
  const W = 300;
  const left = Math.min(x + 14, window.innerWidth - W - 8);
  const top = y + 16 + 160 > window.innerHeight ? y - 12 : y + 16;
  return (
    <div
      className="tip"
      style={{ left: Math.max(8, left), top, transform: top < y ? "translateY(-100%)" : undefined }}
      role="tooltip"
    >
      <div className="tip-title">
        <KindIcon kind={s.kind} size={11} />
        {s.name}
      </div>
      <dl className="tip-grid">
        <dt>Duration</dt>
        <dd>{s.open ? `${dur(s.t1 - s.t0)} (running)` : dur(s.duration_ms ?? s.t1 - s.t0, { precise: true })}</dd>
        <dt>Starts at</dt>
        <dd>+{dur(s.t0 - t0, { precise: true })}</dd>
        {provider && (
          <>
            <dt>Provider</dt>
            <dd className="mono">{provider}</dd>
          </>
        )}
        {model && model !== provider && (
          <>
            <dt>Model</dt>
            <dd className="mono">{model}</dd>
          </>
        )}
        {cost !== null && (
          <>
            <dt>Cost</dt>
            <dd>{money(cost)}</dd>
          </>
        )}
        {s.children.length > 0 && (
          <>
            <dt>Children</dt>
            <dd>{s.children.length}</dd>
          </>
        )}
      </dl>
      {s.error && <div className="tip-err">{s.error.split("\n")[0].slice(0, 200)}</div>}
    </div>
  );
}
