import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, GanttChart, RefreshCw, Search, SearchX, X } from "lucide-react";
import { api } from "../api";
import { dateTime, dur, fullDateTime, money, relTime, shortId } from "../format";
import { isTypingTarget, readStored, useAsync, useDebounced, useNow, usePoll, writeStored } from "../hooks";
import { stageColor } from "../lib/kinds";
import { useBrandScope } from "../state";
import { LIVE_STATUSES, RUN_STATUSES, type TraceSummary } from "../types";
import { EmptyState, ErrorBox, Kbd, LangBadge, statusLabel, StatusPill, TierBadge, Toggle } from "../components/ui";

const REFRESH_MS = 10_000;

export function TracesPage() {
  const { brandId, brandName } = useBrandScope();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const errorsOnly = params.get("errors") === "1";
  const [q, setQ] = useState(params.get("q") ?? "");
  const dq = useDebounced(q.trim(), 250);
  const [live, setLive] = useState(() => readStored("cft.live") !== "0");
  const searchRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const now = useNow(15_000);

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if ((params.get("q") ?? "") !== dq) setParam("q", dq || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  const { data, error, loading, reload } = useAsync(
    async () => {
      const r = await api.traces({
        brand_id: brandId || undefined,
        status: errorsOnly ? "error" : status || undefined,
        q: dq || undefined,
        limit: 50,
      });
      // `status=error` can't be combined server-side with a run status: narrow here.
      return errorsOnly && status ? r.items.filter((t) => t.status === status) : r.items;
    },
    [brandId, status, errorsOnly, dq],
  );
  usePoll(() => void reload(true), live ? REFRESH_MS : 0);

  // "/" focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !isTypingTarget(e.target) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const items = data ?? [];
  const filtered = !!(status || errorsOnly || dq);
  const summary = useMemo(() => {
    const running = items.filter((t) => LIVE_STATUSES.has(t.status)).length;
    const withErrors = items.filter((t) => t.error_count > 0).length;
    const cost = items.reduce((a, t) => a + (t.cost_total || 0), 0);
    return { running, withErrors, cost };
  }, [items]);
  const hasStages = items.some((t) => t.stages && t.stages.length);

  const scope = brandId ? brandName(brandId) ?? "Selected brand" : "All brands";

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-main">
          <h1>
            Traces {data && <span className="count-badge">{items.length}</span>}
          </h1>
          <p className="page-sub">
            {scope} · every pipeline run, span by span
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="live-toggle"
            onClick={() => {
              setLive(!live);
              writeStored("cft.live", live ? "0" : "1");
            }}
            aria-pressed={live}
            title={live ? "Auto-refresh every 10 s — click to pause" : "Auto-refresh paused — click to resume"}
          >
            <span className={`live-dot ${live ? "on" : ""}`} aria-hidden />
            {live ? "Live · 10 s" : "Paused"}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void reload()} disabled={loading}>
            <RefreshCw size={14} className={loading ? "spin" : ""} aria-hidden /> Refresh
          </button>
        </div>
      </div>

      <div className="toolbar" role="search">
        <label className="search">
          <Search size={15} aria-hidden />
          <span className="sr-only">Search traces</span>
          <input
            ref={searchRef}
            type="search"
            placeholder="Search title, brief or run id"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (setQ(""), (e.target as HTMLInputElement).blur())}
          />
          {!q && <Kbd>/</Kbd>}
        </label>
        <select
          className="status-select"
          value={status}
          onChange={(e) => setParam("status", e.target.value || null)}
          aria-label="Run status"
        >
          <option value="">All statuses</option>
          {RUN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s).replace(/^./, (c) => c.toUpperCase())}
            </option>
          ))}
        </select>
        <Toggle pressed={errorsOnly} onChange={(v) => setParam("errors", v ? "1" : null)} title="Only traces with error spans">
          Errors only
        </Toggle>
        {filtered && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setQ("");
              setParams(new URLSearchParams(), { replace: true });
            }}
          >
            <X size={14} aria-hidden /> Clear
          </button>
        )}
        {data && items.length > 0 && (
          <div className="toolbar-summary" aria-live="polite">
            <span>
              <strong>{summary.running}</strong> live
            </span>
            <span>
              <strong className={summary.withErrors ? "tone-text-danger" : ""}>{summary.withErrors}</strong> with errors
            </span>
            <span>
              <strong>{money(summary.cost)}</strong> total
            </span>
          </div>
        )}
      </div>

      <ErrorBox error={error} onRetry={() => void reload()} />

      {!data && loading ? (
        <TableSkeleton />
      ) : items.length === 0 && !error ? (
        filtered ? (
          <EmptyState
            icon={<SearchX size={30} />}
            title="No traces match"
            body="Nothing matches these filters. Try a different status, turn off “Errors only”, or clear the search."
            action={
              <button
                className="btn"
                onClick={() => {
                  setQ("");
                  setParams(new URLSearchParams(), { replace: true });
                }}
              >
                Clear filters
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={<GanttChart size={30} />}
            title="No traces yet"
            body={
              <>
                A trace appears as soon as a run starts — every stage, provider call, retry and cost lands here. Start a run
                from the review UI, or locally with <code>clipforge dev --runs 3</code>.
              </>
            }
          />
        )
      ) : items.length > 0 ? (
        <div className="card">
          <div className="table-wrap">
            <table className="table table-rows traces-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Trace</th>
                  <th className="hide-md">Brand</th>
                  <th>Lang</th>
                  <th className="hide-md">Tier</th>
                  <th>Started</th>
                  <th className="num">Duration</th>
                  <th className="num">Spans</th>
                  <th className="num">Errors</th>
                  <th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <TraceRow key={t.trace_id} t={t} now={now} showStages={hasStages} onOpen={() => nav(`/traces/${t.trace_id}`)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TraceRow({ t, now, showStages, onOpen }: { t: TraceSummary; now: number; showStages: boolean; onOpen: () => void }) {
  const live = LIVE_STATUSES.has(t.status);
  const d = t.duration_ms ?? (live ? now - new Date(t.started_at).getTime() : null);
  return (
    <tr
      className={`clickable ${t.error_count > 0 ? "row-error" : live ? "row-live" : ""}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) return;
        onOpen();
      }}
    >
      <td className="hide-mobile">
        <StatusPill status={t.status} size="sm" />
      </td>
      <td className="c-title">
        <div className="trace-title">
          <Link to={`/traces/${t.trace_id}`} title={t.title ?? t.run_id}>
            {t.title || <span className="faint">Untitled run</span>}
          </Link>
          <span className="mono">{shortId(t.run_id)}</span>
        </div>
      </td>
      <td className="c-meta">
        <StatusPill status={t.status} size="sm" />
        <span className="faint small">{t.brand_name}</span>
        <span className="faint small">· {relTime(t.started_at, now)}</span>
        {t.error_count > 0 && (
          <span className="err-badge" aria-label={`${t.error_count} errors`}>
            <AlertTriangle size={10} aria-hidden />
            {t.error_count}
          </span>
        )}
      </td>
      <td className="cell-brand hide-md">{t.brand_name}</td>
      <td>
        <LangBadge code={t.language} />
      </td>
      <td className="hide-md">
        <TierBadge tier={t.tier} />
      </td>
      <td className="small muted" title={fullDateTime(t.started_at)} style={{ whiteSpace: "nowrap" }}>
        {relTime(t.started_at, now)}
        <div className="faint xsmall">{dateTime(t.started_at)}</div>
      </td>
      <td className="num c-dur">
        <div className="dur-cell">
          <span>{d === null ? <span className="cell-dash">—</span> : dur(d)}</span>
          {showStages && <StageSpark t={t} />}
        </div>
      </td>
      <td className="num">{t.span_count || <span className="cell-dash">0</span>}</td>
      <td className="num">
        {t.error_count > 0 ? (
          <span className="err-badge" aria-label={`${t.error_count} errors`}>
            {t.error_count}
          </span>
        ) : (
          <span className="cell-dash">—</span>
        )}
      </td>
      <td className="num c-cost cost-cell">{t.cost_total > 0 ? money(t.cost_total) : <span className="cell-dash">$0</span>}</td>
    </tr>
  );
}

/** Mini stacked bar of stage wall time (only when the API sends `stages`). */
function StageSpark({ t }: { t: TraceSummary }) {
  const st = (t.stages ?? []).filter((s) => s.name !== "approve" && s.duration_ms > 0);
  const total = st.reduce((a, s) => a + s.duration_ms, 0);
  if (!total) return <span className="spark-stages" aria-hidden />;
  return (
    <span
      className="spark-stages"
      role="img"
      aria-label={`Stage time: ${st.map((s) => `${s.name} ${dur(s.duration_ms)}`).join(", ")}`}
      title={st.map((s) => `${s.name}  ${dur(s.duration_ms)}`).join("\n")}
    >
      {st.map((s, i) => (
        <span
          key={i}
          style={{
            flexGrow: s.duration_ms,
            flexBasis: 0,
            ["--kc" as string]: s.status === "error" ? "var(--k-error)" : stageColor(s.name),
          }}
        />
      ))}
    </span>
  );
}

function TableSkeleton() {
  return (
    <div className="card" aria-busy="true" aria-label="Loading traces">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="row" style={{ padding: "14px 16px", gap: 16, borderBottom: "1px solid var(--border)" }}>
          <div className="skeleton" style={{ width: 84, height: 18, borderRadius: 999 }} />
          <div className="skeleton" style={{ flex: 1, height: 14, maxWidth: 340 }} />
          <div className="skeleton hide-mobile" style={{ width: 110, height: 14 }} />
          <div className="skeleton" style={{ width: 60, height: 14, marginLeft: "auto" }} />
          <div className="skeleton" style={{ width: 54, height: 14 }} />
        </div>
      ))}
    </div>
  );
}
