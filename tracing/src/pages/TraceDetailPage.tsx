import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  ChevronLeft,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleDollarSign,
  Clock,
  ExternalLink,
  FileQuestion,
  GitCommitHorizontal,
  Hourglass,
  Layers,
  Route,
} from "lucide-react";
import { api, ApiError, reviewRunUrl } from "../api";
import { dur, fullDateTime, money, pct, relTime, shortId } from "../format";
import { useAsync, useMediaQuery, useNow, usePoll } from "../hooks";
import { KIND_META, KINDS, kindColor, stageColor } from "../lib/kinds";
import {
  buildScale,
  buildTree,
  criticalPath,
  eventCounts,
  ms,
  providerCosts,
  stageTimes,
} from "../lib/timeline";
import { LIVE_STATUSES, type SpanKind, type TraceDetail } from "../types";
import { SpanPanel } from "../components/SpanPanel";
import { visibleRows, Waterfall } from "../components/Waterfall";
import { CopyButton, EmptyState, ErrorBox, LangBadge, Loading, StatusPill, TierBadge, Tile, Toggle } from "../components/ui";

export function TraceDetailPage() {
  const { id = "" } = useParams();
  const { data, error, loading, reload } = useAsync(() => api.trace(id), [id]);
  const live = !!data && LIVE_STATUSES.has(data.trace.status);
  usePoll(() => void reload(true), live ? 3000 : data?.trace.status === "awaiting_approval" ? 15000 : 0);

  if (!data && loading) return <Loading label="Loading trace…" />;
  if (!data && error)
    return error instanceof ApiError && error.status === 404 ? (
      <EmptyState
        icon={<FileQuestion size={30} />}
        title="Trace not found"
        body={
          <>
            No trace with id <code>{id}</code>. It may belong to another brand or has not started yet.
          </>
        }
        action={
          <Link className="btn" to="/">
            Back to traces
          </Link>
        }
      />
    ) : (
      <div className="page">
        <ErrorBox error={error} onRetry={() => void reload()} />
      </div>
    );
  if (!data) return null;
  return <TraceView key={id} data={data} live={live} error={error} />;
}

function TraceView({ data, live, error }: { data: TraceDetail; live: boolean; error: unknown }) {
  const { trace, spans } = data;
  const now = useNow(live ? 1000 : 0);
  const wide = useMediaQuery("(min-width: 1281px)");

  // Open spans extend to "now" only while the run is live; otherwise to the last known instant.
  const openEnd = useMemo(() => {
    if (live) return now;
    let t = ms(trace.ended_at);
    if (!isFinite(t)) t = -Infinity;
    for (const s of spans) t = Math.max(t, ms(s.end_at ?? s.start_at));
    return isFinite(t) ? t : now;
  }, [live, now, trace.ended_at, spans]);

  const tree = useMemo(() => buildTree(spans, openEnd), [spans, openEnd]);
  const scale = useMemo(() => buildScale(tree), [tree]);
  const crit = useMemo(() => criticalPath(tree), [tree]);
  const stages = useMemo(() => stageTimes(tree), [tree]);
  const providers = useMemo(() => providerCosts(tree), [tree]);
  const evCounts = useMemo(() => eventCounts(spans), [spans]);

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [kinds, setKinds] = useState<Set<SpanKind>>(() => new Set());
  const [showCrit, setShowCrit] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  // Default selection: first error span (deepest cause), else nothing.
  useEffect(() => {
    if (selectedId && tree.byId.has(selectedId)) return;
    const errs = tree.list.filter((s) => s.status === "error");
    const leafErr = errs.find((s) => !s.children.some((c) => c.status === "error")) ?? errs[0];
    setSelectedId(leafErr?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  const rows = useMemo(() => visibleRows(tree, collapsed, kinds.size ? kinds : null), [tree, collapsed, kinds]);
  const selected = selectedId ? tree.byId.get(selectedId) ?? null : null;

  const onToggle = useCallback(
    (id: string) =>
      setCollapsed((c) => {
        const n = new Set(c);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    [],
  );
  const onSelect = useCallback((id: string, open: boolean) => {
    setSelectedId(id);
    if (open) setPanelOpen(true);
  }, []);
  const selectAndReveal = useCallback(
    (id: string) => {
      // expand ancestors so the row is visible
      const s = tree.byId.get(id);
      if (s) {
        setCollapsed((c) => {
          const n = new Set(c);
          for (let p = s.parent; p; p = p.parent) n.delete(p.id);
          return n;
        });
      }
      setSelectedId(id);
      setPanelOpen(true);
      window.setTimeout(() => document.getElementById(`span-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 30);
    },
    [tree],
  );

  // Esc closes the overlay panel
  useEffect(() => {
    if (!panelOpen || wide) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanelOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, wide]);

  const kindCounts = useMemo(() => {
    const m = new Map<SpanKind, number>();
    for (const s of tree.list) m.set(s.kind, (m.get(s.kind) ?? 0) + 1);
    return m;
  }, [tree]);

  const waitMs = scale.gaps.reduce((a, g) => a + (g.t1 - g.t0), 0);
  const durationMs = trace.duration_ms ?? (spans.length ? tree.t1 - tree.t0 : null);
  const retries = evCounts.retry ?? 0;
  const fallbacks = evCounts.fallback ?? 0;
  const leafCalls = tree.list.filter((s) => s.kind !== "run" && s.kind !== "stage").length;
  const stageCount = new Set(tree.list.filter((s) => s.kind === "stage").map((s) => s.name)).size;
  const critMs = useMemo(() => {
    let t = 0;
    for (const id of crit) {
      const s = tree.byId.get(id);
      if (s && s.children.every((c) => !crit.has(c.id))) t += s.t1 - s.t0;
    }
    return t;
  }, [crit, tree]);

  const allCollapsed = rows.length <= tree.roots.length;

  return (
    <div className="page">
      <div className="trace-head">
        <div className="crumbs">
          <Link to="/">
            <ChevronLeft size={14} aria-hidden /> Traces
          </Link>
          <span aria-hidden>/</span>
          <span className="mono">{shortId(trace.run_id)}</span>
        </div>
        <div className="page-head">
          <div className="page-head-main">
            <h1>
              <span className="title-text">{trace.title || "Untitled run"}</span>
              <StatusPill status={trace.status} />
            </h1>
            <div className="meta-row">
              <span>
                <Building2 size={14} aria-hidden /> {trace.brand_name}
              </span>
              <span>
                <LangBadge code={trace.language} /> <TierBadge tier={trace.tier} />
              </span>
              <span title={fullDateTime(trace.started_at)}>
                <CalendarClock size={14} aria-hidden /> {fullDateTime(trace.started_at)} · {relTime(trace.started_at)}
              </span>
              <span className="id-chip" title="Trace id">
                {trace.trace_id}
                <CopyButton text={trace.trace_id} label="Copy trace id" size={12} />
              </span>
            </div>
          </div>
          <div className="page-actions">
            {live && (
              <span className="live-toggle" style={{ cursor: "default" }} title="Refreshing every 3 s while the run is in progress">
                <span className="live-dot on" aria-hidden /> Live
              </span>
            )}
            <a className="btn btn-sm" href={reviewRunUrl(trace.run_id)} target="_blank" rel="noreferrer">
              Open in review UI <ExternalLink size={13} aria-hidden />
            </a>
          </div>
        </div>
      </div>

      <ErrorBox error={error} />

      <div className="tiles">
        <Tile icon={<Clock size={14} aria-hidden />} label="Duration" value={durationMs === null ? "—" : dur(durationMs)} foot={trace.ended_at ? `ended ${relTime(trace.ended_at)}` : live ? "in progress" : "not finished"} />
        <Tile
          icon={<Hourglass size={14} aria-hidden />}
          label="Active time"
          value={spans.length ? dur(scale.activeMs) : "—"}
          foot={waitMs > 0 ? `excl. ${dur(waitMs)} waiting` : "no idle gaps"}
        />
        <Tile icon={<CircleDollarSign size={14} aria-hidden />} label="Cost" value={money(trace.cost_total)} foot={`${leafCalls} provider / LLM calls`} />
        <Tile icon={<Layers size={14} aria-hidden />} label="Spans" value={trace.span_count || spans.length} foot={`${stageCount} stages · ${tree.roots.filter((r) => r.kind === "run").length || tree.roots.length} executions`} />
        <Tile
          icon={<AlertTriangle size={14} aria-hidden />}
          label="Errors"
          value={trace.error_count}
          tone={trace.error_count > 0 ? "danger" : undefined}
          foot={`${retries} retr${retries === 1 ? "y" : "ies"} · ${fallbacks} fallback${fallbacks === 1 ? "" : "s"}`}
        />
      </div>

      {spans.length === 0 ? (
        <EmptyState
          icon={<GitCommitHorizontal size={30} />}
          title={trace.status === "queued" ? "Waiting for a worker" : "No spans recorded"}
          body={
            trace.status === "queued"
              ? "This run is queued. Spans appear as soon as a worker picks it up — this page refreshes automatically."
              : "This run finished without emitting any spans (it may predate tracing)."
          }
        />
      ) : (
        <>
          <div className="summary-grid">
            <StageBreakdown stages={stages} onPick={(name) => {
              const s = tree.list.find((x) => x.kind === "stage" && x.name === name);
              if (s) selectAndReveal(s.id);
            }} />
            <ProviderBreakdown providers={providers} total={trace.cost_total} />
          </div>

          <section className="card wf-card" aria-labelledby="wf-title">
            <div className="card-head">
              <h2 id="wf-title">
                Timeline <span className="sub">{scale.gaps.length ? `idle gaps > 60 s collapsed` : "to scale"}</span>
              </h2>
              <div className="card-actions row wrap">
                <Toggle pressed={showCrit} onChange={setShowCrit} accent title="Highlight the chain of spans that determined the end time">
                  <Route size={14} aria-hidden /> Critical path
                  {showCrit && <span className="faint tabular">· {dur(critMs)}</span>}
                </Toggle>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() =>
                    setCollapsed(allCollapsed ? new Set() : new Set(tree.list.filter((s) => s.children.length).map((s) => s.id)))
                  }
                >
                  {allCollapsed ? <ChevronsUpDown size={14} aria-hidden /> : <ChevronsDownUp size={14} aria-hidden />}
                  {allCollapsed ? "Expand all" : "Collapse all"}
                </button>
              </div>
            </div>
            <div className="wf-toolbar">
              <div className="kind-filter" role="group" aria-label="Filter by span kind">
                {KINDS.filter((k) => kindCounts.has(k)).map((k) => {
                  const M = KIND_META[k];
                  const on = kinds.has(k);
                  return (
                    <button
                      key={k}
                      type="button"
                      className={`kind-chip ${kinds.size && !on ? "off" : ""}`}
                      aria-pressed={on}
                      style={{ "--kc": kindColor(k) } as React.CSSProperties}
                      onClick={() =>
                        setKinds((cur) => {
                          const n = new Set(cur);
                          if (n.has(k)) n.delete(k);
                          else n.add(k);
                          return n;
                        })
                      }
                      title={`${M.hint} — click to filter`}
                    >
                      <span className="swatch" aria-hidden />
                      {M.label}
                      <span className="count">{kindCounts.get(k)}</span>
                    </button>
                  );
                })}
                {kinds.size > 0 && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setKinds(new Set())}>
                    Show all
                  </button>
                )}
              </div>
            </div>
            <div className={`wf-split ${wide ? "" : "no-panel"}`}>
              <Waterfall
                tree={tree}
                scale={scale}
                rows={rows}
                collapsed={collapsed}
                onToggle={onToggle}
                selectedId={selectedId}
                onSelect={onSelect}
                critical={showCrit ? crit : null}
              />
              {wide && (
                <aside className="span-panel" aria-labelledby="span-panel-title" aria-label={selected ? undefined : "Span details"}>
                  <div className="span-panel-inner">
                    <SpanPanel span={selected} traceStart={tree.t0} onSelect={selectAndReveal} onClose={() => setSelectedId(null)} overlay={false} />
                  </div>
                </aside>
              )}
            </div>
            <div className="wf-legend-note" aria-hidden>
              <span>
                <i className="legend-bar" style={{ background: "var(--k-video)" }} /> call
              </span>
              <span>
                <i className="legend-bar" style={{ background: "color-mix(in srgb, var(--k-stage) 55%, transparent)", boxShadow: "inset 0 0 0 1px var(--k-stage)" }} /> stage / run
              </span>
              <span>
                <i className="legend-bar" style={{ background: "repeating-linear-gradient(135deg, rgba(255,255,255,.22) 0 2px, transparent 2px 6px), var(--k-error)" }} /> error
              </span>
              <span>
                <i className="legend-diamond tone-warn" /> retry / fallback
              </span>
              <span>
                <i className="legend-diamond tone-success" /> cache hit
              </span>
              <span>
                <i className="legend-diamond tone-accent" /> paused for approval
              </span>
            </div>
          </section>
        </>
      )}

      {!wide && (
        <>
          <div className={`scrim ${panelOpen && selected ? "open" : ""}`} onClick={() => setPanelOpen(false)} aria-hidden />
          <aside
            className={`span-panel ${panelOpen && selected ? "open" : ""}`}
            aria-labelledby="span-panel-title"
            aria-hidden={!(panelOpen && selected)}
            role="dialog"
            aria-modal={panelOpen && !!selected}
          >
            <div className="span-panel-inner">
              {selected && (
                <SpanPanel span={selected} traceStart={tree.t0} onSelect={selectAndReveal} onClose={() => setPanelOpen(false)} overlay />
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ summary strip

function StageBreakdown({ stages, onPick }: { stages: ReturnType<typeof stageTimes>; onPick: (name: string) => void }) {
  const work = stages.filter((s) => !s.wait && s.ms > 0);
  const waits = stages.filter((s) => s.wait);
  const total = work.reduce((a, s) => a + s.ms, 0);
  const waitMs = waits.reduce((a, s) => a + s.ms, 0);
  return (
    <section className="card" aria-labelledby="stage-title">
      <div className="card-head">
        <h2 id="stage-title">
          Time per stage <span className="sub">wall time · parallel shots merged</span>
        </h2>
        <span className="small muted tabular">{dur(total)}</span>
      </div>
      <div className="card-body">
        {total > 0 ? (
          <>
            <div className="stack-bar" role="img" aria-label={`Stage time: ${work.map((s) => `${s.name} ${dur(s.ms)}`).join(", ")}`}>
              {work.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  style={{ flexGrow: s.ms, flexBasis: 0, ["--kc" as string]: s.errors ? "var(--k-error)" : stageColor(s.name) }}
                  title={`${s.name} — ${dur(s.ms)} (${pct(s.ms / total)})`}
                  aria-label={`${s.name} ${dur(s.ms)}`}
                  onClick={() => onPick(s.name)}
                />
              ))}
            </div>
            <ul className="legend-list">
              {work.map((s) => (
                <li key={s.name} title={`${s.count} span${s.count > 1 ? "s" : ""}`}>
                  <span className="swatch" style={{ ["--kc" as string]: s.errors ? "var(--k-error)" : stageColor(s.name) }} aria-hidden />
                  <span className="name">
                    {s.name}
                    {s.count > 1 && <span className="faint"> ×{s.count}</span>}
                    {s.errors > 0 && <AlertTriangle size={11} className="tone-text-danger" style={{ marginLeft: 4, verticalAlign: -1 }} aria-label="error" />}
                  </span>
                  <span className="val">{dur(s.ms)}</span>
                </li>
              ))}
            </ul>
            {waitMs > 0 && (
              <p className="waiting-note" style={{ marginTop: 12 }}>
                <span className="hatch-swatch" aria-hidden /> approve (human gate) spans {dur(waitMs)} — excluded above
              </p>
            )}
          </>
        ) : (
          <p className="small faint">No completed stages yet.</p>
        )}
      </div>
    </section>
  );
}

function ProviderBreakdown({ providers, total }: { providers: ReturnType<typeof providerCosts>; total: number }) {
  const costed = providers.filter((p) => p.cost > 0);
  const max = Math.max(0, ...costed.map((p) => p.cost));
  const sum = costed.reduce((a, p) => a + p.cost, 0) || total;
  const free = providers.filter((p) => p.cost <= 0);
  return (
    <section className="card" aria-labelledby="prov-title">
      <div className="card-head">
        <h2 id="prov-title">
          Cost by provider <span className="sub">{providers.length} providers</span>
        </h2>
        <span className="small muted tabular">{money(total)}</span>
      </div>
      <div className="card-body">
        {costed.length ? (
          <ul className="hbars">
            {costed.slice(0, 6).map((p) => (
              <li key={p.provider}>
                <div className="hbar-head">
                  <span className="swatch" style={{ ["--kc" as string]: kindColor(p.kind) }} aria-hidden />
                  <span className="name" title={p.provider}>
                    {p.provider}
                  </span>
                  <span className="faint small tabular">{p.calls ? `${p.calls} call${p.calls > 1 ? "s" : ""}` : ""}</span>
                  <span className="val">{money(p.cost)}</span>
                  <span className="share">{pct(sum ? p.cost / sum : 0)}</span>
                </div>
                <div className="hbar-track">
                  <div className="hbar-fill" style={{ width: `${max ? (p.cost / max) * 100 : 0}%`, ["--kc" as string]: kindColor(p.kind) }} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small faint">No billed provider calls in this trace.</p>
        )}
        {free.length > 0 && (
          <p className="small faint" style={{ marginTop: 12 }}>
            Unbilled: {free.map((p) => p.provider).join(", ")}
          </p>
        )}
      </div>
    </section>
  );
}

