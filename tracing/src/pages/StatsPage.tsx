import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Activity, AlertTriangle, ArrowDown, ArrowUp, CircleDollarSign, Cpu, Timer, Turtle } from "lucide-react";
import { api } from "../api";
import { dur, isoDay, money, pct } from "../format";
import { useAsync } from "../hooks";
import { KIND_META, kindColor, kindOf, stageColor, stageRank } from "../lib/kinds";
import { isWaitSpan } from "../lib/timeline";
import { useBrandScope } from "../state";
import type { ProviderStat, StageStat, TraceSummary } from "../types";
import { ColumnChart, Sparkline } from "../components/charts";
import { EmptyState, ErrorBox, Loading, Segmented, StatusPill, Tile } from "../components/ui";

const RANGES = ["7", "14", "30"] as const;
type Range = (typeof RANGES)[number];

export function StatsPage() {
  const { brandId, brandName } = useBrandScope();
  const [params, setParams] = useSearchParams();
  const range = (RANGES as readonly string[]).includes(params.get("range") ?? "") ? (params.get("range") as Range) : "14";
  const { from, to } = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - (Number(range) - 1) * 86400_000);
    return { from: isoDay(start), to: isoDay(end) };
  }, [range]);

  const { data, error, loading, reload } = useAsync(() => api.stats({ from, to, brand_id: brandId || undefined }), [from, to, brandId]);

  const totals = useMemo(() => {
    const th = data?.throughput ?? [];
    const runs = th.reduce((a, d) => a + d.runs, 0);
    const errors = th.reduce((a, d) => a + d.errors, 0);
    const cost = th.reduce((a, d) => a + d.cost, 0);
    const calls = (data?.providers ?? []).reduce((a, p) => a + p.calls, 0);
    const callErrors = (data?.providers ?? []).reduce((a, p) => a + p.errors, 0);
    return { runs, errors, cost, calls, callErrors };
  }, [data]);

  const days = useMemo(() => fillDays(data?.throughput ?? [], from, to), [data, from, to]);
  const scope = brandId ? brandName(brandId) ?? "Selected brand" : "All brands";
  const [view, setView] = useState<"chart" | "table">("chart");

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-main">
          <h1>Stats</h1>
          <p className="page-sub">
            {scope} · {from} → {to} (UTC) · provider latency, stage timing and throughput
          </p>
        </div>
        <div className="page-actions">
          <Segmented
            label="Date range"
            value={range}
            onChange={(v) => {
              const n = new URLSearchParams(params);
              n.set("range", v);
              setParams(n, { replace: true });
            }}
            options={RANGES.map((r) => ({ id: r, label: `${r}d` }))}
          />
        </div>
      </div>

      <ErrorBox error={error} onRetry={() => void reload()} />

      {!data && loading ? (
        <Loading label="Crunching stats…" />
      ) : data ? (
        totals.runs === 0 && data.providers.length === 0 ? (
          <EmptyState
            icon={<Activity size={30} />}
            title="No traced runs in this range"
            body="Pick a longer range or another brand. Stats aggregate spans from every run that started in the window."
          />
        ) : (
          <>
            <div className="tiles">
              <Tile icon={<Activity size={14} aria-hidden />} label="Runs" value={totals.runs.toLocaleString()} foot={`${(totals.runs / Number(range)).toFixed(1)} / day`}>
                <Sparkline values={days.map((d) => d.runs)} />
              </Tile>
              <Tile
                icon={<AlertTriangle size={14} aria-hidden />}
                label="Runs with errors"
                value={totals.errors.toLocaleString()}
                tone={totals.errors ? "danger" : undefined}
                foot={`${pct(totals.runs ? totals.errors / totals.runs : 0, 1)} of runs`}
              />
              <Tile icon={<CircleDollarSign size={14} aria-hidden />} label="Spend" value={money(totals.cost)} foot={`${money(totals.runs ? totals.cost / totals.runs : 0)} per run`}>
                <Sparkline values={days.map((d) => d.cost)} />
              </Tile>
              <Tile
                icon={<Cpu size={14} aria-hidden />}
                label="Provider calls"
                value={totals.calls.toLocaleString()}
                foot={`${pct(totals.calls ? totals.callErrors / totals.calls : 0, 1)} error rate`}
              />
            </div>

            <section className="card" aria-labelledby="tp-title">
              <div className="card-head">
                <h2 id="tp-title">
                  Runs &amp; errors per day <span className="sub">UTC days</span>
                </h2>
                <div className="row wrap" style={{ gap: 14 }}>
                  <div className="legend" aria-hidden={view === "table"}>
                    <span>
                      <span className="swatch" style={{ ["--kc" as string]: "var(--seq-strong)" }} /> Runs
                    </span>
                    <span>
                      <span className="swatch" style={{ ["--kc" as string]: "var(--danger)" }} /> Runs with errors
                    </span>
                  </div>
                  <Segmented label="View" value={view} onChange={setView} options={[{ id: "chart", label: "Chart" }, { id: "table", label: "Table" }]} />
                </div>
              </div>
              <div className="card-body">
                {view === "chart" ? (
                  <ColumnChart
                    data={days}
                    x={(d) => d.day}
                    xLabel={(d) => shortDay(d.day)}
                    series={[
                      { key: "runs", label: "Runs", color: "var(--seq-strong)" },
                      { key: "errors", label: "With errors", color: "var(--danger)" },
                    ]}
                    extra={(d) => [{ label: "Spend", value: money(d.cost) }]}
                    ariaLabel={`Runs per day, ${from} to ${to}: ${totals.runs} runs, ${totals.errors} with errors.`}
                  />
                ) : (
                  <div className="table-wrap" style={{ maxHeight: 320 }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Day</th>
                          <th className="num">Runs</th>
                          <th className="num">With errors</th>
                          <th className="num">Spend</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...days].reverse().map((d) => (
                          <tr key={d.day}>
                            <td className="tabular">{d.day}</td>
                            <td className="num">{d.runs}</td>
                            <td className="num">{d.errors}</td>
                            <td className="num">{money(d.cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>

            <ProviderTable providers={data.providers} />

            <div className="stats-grid">
              <StageLatency stages={data.stages} />
              <SlowestTraces items={data.slowest} />
            </div>
          </>
        )
      ) : null}
    </div>
  );
}

function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function fillDays(th: { day: string; runs: number; errors: number; cost: number }[], from: string, to: string) {
  const m = new Map(th.map((d) => [d.day.slice(0, 10), d]));
  const out: { day: string; runs: number; errors: number; cost: number }[] = [];
  for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= new Date(`${to}T00:00:00Z`).getTime(); t += 86400_000) {
    const day = isoDay(new Date(t));
    out.push(m.get(day) ?? { day, runs: 0, errors: 0, cost: 0 });
  }
  return out;
}

// ------------------------------------------------------------------ providers

type SortKey = "name" | "calls" | "errors" | "rate" | "p50_ms" | "p95_ms" | "avg_ms" | "cost";

function ProviderTable({ providers }: { providers: ProviderStat[] }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "calls", desc: true });
  const rows = useMemo(() => {
    const val = (p: ProviderStat): number | string =>
      sort.key === "name" ? p.name : sort.key === "rate" ? (p.calls ? p.errors / p.calls : 0) : (p[sort.key] as number);
    return [...providers].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const c = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sort.desc ? -c : c;
    });
  }, [providers, sort]);
  const maxP95 = Math.max(1, ...providers.map((p) => p.p95_ms));
  const maxCost = Math.max(0.0001, ...providers.map((p) => p.cost));
  const maxRate = Math.max(0.0001, ...providers.map((p) => (p.calls ? p.errors / p.calls : 0)));

  const Th = ({ k, children, num = true }: { k: SortKey; children: React.ReactNode; num?: boolean }) => (
    <th
      className={`sortable ${num ? "num" : ""}`}
      aria-sort={sort.key === k ? (sort.desc ? "descending" : "ascending") : "none"}
      onClick={() => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== "name" }))}
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== "name" })))}
    >
      {children}
      <span className="sort-ind" aria-hidden>
        {sort.key === k ? sort.desc ? <ArrowDown size={10} /> : <ArrowUp size={10} /> : null}
      </span>
    </th>
  );

  return (
    <section className="card" aria-labelledby="prov-stats-title">
      <div className="card-head">
        <h2 id="prov-stats-title">
          Providers <span className="sub">{providers.length} · leaf calls (LLM, video, voice, music, render, publish)</span>
        </h2>
        <div className="legend">
          <span>
            <span className="swatch" style={{ ["--kc" as string]: "var(--seq-strong)" }} /> p50
          </span>
          <span>
            <span className="swatch" style={{ ["--kc" as string]: "var(--seq-soft)" }} /> p95
          </span>
        </div>
      </div>
      {providers.length === 0 ? (
        <div className="card-body small faint">No provider calls in this range.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <Th k="name" num={false}>
                  Provider
                </Th>
                <Th k="calls">Calls</Th>
                <Th k="rate">Errors</Th>
                <Th k="p50_ms">p50</Th>
                <Th k="p95_ms">p95 latency</Th>
                <Th k="avg_ms">Avg</Th>
                <Th k="cost">Cost</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const rate = p.calls ? p.errors / p.calls : 0;
                const k = kindOf(p.kind);
                return (
                  <tr key={p.name}>
                    <td>
                      <span className="prov-name" title={KIND_META[k].hint}>
                        <span className="swatch" style={{ ["--kc" as string]: kindColor(k) }} aria-hidden />
                        {p.name}
                        <span className="faint" style={{ fontFamily: "var(--font)", fontSize: 11 }}>
                          {KIND_META[k].label}
                        </span>
                      </span>
                    </td>
                    <td className="num">{p.calls.toLocaleString()}</td>
                    <td className="num">
                      <div className="bar-cell">
                        {p.errors > 0 && (
                          <span className="inline-bar" aria-hidden style={{ width: 56, minWidth: 56 }}>
                            <span className="err" style={{ width: `${(rate / maxRate) * 100}%` }} />
                          </span>
                        )}
                        <span className={`v ${p.errors ? "tone-text-danger" : "faint"}`} style={{ minWidth: 76 }}>
                          {p.errors ? `${p.errors} · ${pct(rate, 1)}` : "—"}
                        </span>
                      </div>
                    </td>
                    <td className="num">{dur(p.p50_ms)}</td>
                    <td className="num">
                      <div className="bar-cell">
                        <span className="inline-bar" aria-hidden>
                          <span className="p95" style={{ width: `${(p.p95_ms / maxP95) * 100}%` }} />
                          <span style={{ width: `${(p.p50_ms / maxP95) * 100}%` }} />
                        </span>
                        <span className="v">{dur(p.p95_ms)}</span>
                      </div>
                    </td>
                    <td className="num muted">{dur(p.avg_ms)}</td>
                    <td className="num">
                      <div className="bar-cell">
                        {p.cost > 0 && (
                          <span className="inline-bar" aria-hidden style={{ width: 64, minWidth: 64 }}>
                            <span style={{ width: `${(p.cost / maxCost) * 100}%` }} />
                          </span>
                        )}
                        <span className={`v ${p.cost > 0 ? "strong" : "faint"}`}>{p.cost > 0 ? money(p.cost) : "—"}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ stages

function StageLatency({ stages }: { stages: StageStat[] }) {
  const isWait = (s: StageStat) => isWaitSpan({ name: s.name, attributes: {}, events: [], kind: "stage" });
  const work = [...stages].filter((s) => !isWait(s)).sort((a, b) => stageRank(a.name) - stageRank(b.name) || a.name.localeCompare(b.name));
  const waits = stages.filter(isWait);
  const max = Math.max(1, ...work.map((s) => s.p95_ms));
  return (
    <section className="card" aria-labelledby="stage-lat-title">
      <div className="card-head">
        <h2 id="stage-lat-title">
          <Timer size={15} aria-hidden /> Stage latency
        </h2>
        <div className="legend">
          <span>
            <span className="swatch" style={{ ["--kc" as string]: "var(--seq-strong)" }} /> p50
          </span>
          <span>
            <span className="swatch" style={{ ["--kc" as string]: "var(--seq-soft)" }} /> p95
          </span>
        </div>
      </div>
      <div className="card-body">
        {work.length === 0 ? (
          <p className="small faint">No completed stages in this range.</p>
        ) : (
          <ul className="lat-rows">
            {work.map((s) => (
              <li key={s.name} className="lat-row" title={`${s.name}: p50 ${dur(s.p50_ms)}, p95 ${dur(s.p95_ms)} over ${s.runs} runs, ${s.errors} errors`}>
                <span className="name">
                  <span className="swatch" style={{ ["--kc" as string]: stageColor(s.name) }} aria-hidden />
                  <span className="ellipsis">{s.name}</span>
                  {s.errors > 0 && <AlertTriangle size={11} className="tone-text-danger" aria-label={`${s.errors} errors`} />}
                </span>
                <span className="lat-track" aria-hidden>
                  <span className="p95" style={{ width: `${(s.p95_ms / max) * 100}%` }} />
                  <span className="p50" style={{ width: `${(s.p50_ms / max) * 100}%` }} />
                </span>
                <span className="vals">
                  <strong>{dur(s.p50_ms)}</strong> · {dur(s.p95_ms)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {waits.length > 0 && (
          <p className="waiting-note" style={{ marginTop: 16 }}>
            <span className="hatch-swatch" aria-hidden />
            {waits.map((w) => `${w.name} (human gate) p50 ${dur(w.p50_ms)} · p95 ${dur(w.p95_ms)}`).join(" · ")} — not to scale
          </p>
        )}
      </div>
    </section>
  );
}

function SlowestTraces({ items }: { items: TraceSummary[] }) {
  return (
    <section className="card" aria-labelledby="slow-title">
      <div className="card-head">
        <h2 id="slow-title">
          <Turtle size={15} aria-hidden /> Slowest traces
        </h2>
        <span className="sub small">wall time incl. approval waits</span>
      </div>
      {items.length === 0 ? (
        <div className="card-body small faint">Nothing finished in this range.</div>
      ) : (
        <ol className="slow-list">
          {items.map((t, i) => (
            <li key={t.trace_id}>
              <Link to={`/traces/${t.trace_id}`}>
                <span className="slow-rank">{i + 1}</span>
                <span className="slow-main">
                  <div className="t">{t.title || "Untitled run"}</div>
                  <div className="m">
                    <StatusPill status={t.status} size="sm" />
                    <span className="ellipsis">{t.brand_name}</span>
                    {t.error_count > 0 && <span className="err-badge">{t.error_count}</span>}
                  </div>
                </span>
                <span className="slow-dur">
                  {dur(t.duration_ms)}
                  <div className="faint xsmall" style={{ fontWeight: 450 }}>
                    {money(t.cost_total)}
                  </div>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
