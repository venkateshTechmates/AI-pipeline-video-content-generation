import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Coins, Gauge, ListVideo, Table2, Target } from "lucide-react";
import { api } from "../api";
import { STAGE_META } from "../components/icons";
import { Card, EmptyState, ErrorBox, PageHeader, Segmented, Skeleton, StatTile } from "../components/ui";
import { isoDay, money } from "../format";
import { useAsync } from "../hooks";
import { useBrandScope } from "../state";
import type { BrandCosts } from "../types";

const TARGET_PER_RUN = 3;
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)"];

export function CostsPage() {
  const { id: routeBrand } = useParams();
  const [params, setParams] = useSearchParams();
  const { brands, brandId: scopeId, brandName } = useBrandScope();
  const today = new Date();
  const from = params.get("from") ?? isoDay(new Date(today.getTime() - 13 * 86400_000));
  const to = params.get("to") ?? isoDay(today);
  const scopeIds = routeBrand ? [routeBrand] : scopeId ? [scopeId] : brands.map((b) => b.id);
  const key = scopeIds.join(",");
  const costs = useAsync(
    () => Promise.all(scopeIds.map((id) => api.brandCosts(id, { from, to }))),
    [key, from, to],
  );
  const scopeBrands = brands.filter((b) => scopeIds.includes(b.id));
  const dailyBudget = scopeBrands.reduce((s, b) => s + b.daily_budget, 0);

  const agg = useMemo(() => aggregate(costs.data ?? []), [costs.data]);
  const days = useMemo(() => dayRange(from, to), [from, to]);
  const preset = (n: number) =>
    setParams({ from: isoDay(new Date(today.getTime() - (n - 1) * 86400_000)), to: isoDay(today) }, { replace: true });
  const span = days.length;
  const presetId = [7, 14, 30, 90].includes(span) && to === isoDay(today) ? String(span) : "";

  const perRun = agg.runs ? agg.total / agg.runs : 0;
  const perRunTone = !agg.runs ? undefined : perRun > TARGET_PER_RUN ? "danger" : perRun > TARGET_PER_RUN * 0.85 ? "warn" : "success";
  const title = routeBrand ? brandName(routeBrand) : scopeId ? brandName(scopeId) : "All brands";

  return (
    <div className="page">
      <PageHeader
        title="Costs"
        subtitle={`${title} · ${from} → ${to} (UTC)`}
        actions={
          <div className="range">
            <Segmented
              label="Range"
              value={presetId}
              onChange={(v) => preset(Number(v))}
              options={["7", "14", "30", "90"].map((d) => ({ id: d, label: `${d}d` }))}
            />
            <input
              type="date"
              value={from}
              max={to}
              aria-label="From"
              onChange={(e) => setParams({ from: e.target.value, to }, { replace: true })}
            />
            <span className="muted">→</span>
            <input
              type="date"
              value={to}
              min={from}
              aria-label="To"
              onChange={(e) => setParams({ from, to: e.target.value }, { replace: true })}
            />
          </div>
        }
      />
      <ErrorBox error={costs.error} onRetry={() => void costs.reload()} />
      {costs.loading && !costs.data ? (
        <>
          <div className="stats">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} h={96} r={12} />
            ))}
          </div>
          <Skeleton h={300} r={12} />
        </>
      ) : !scopeIds.length ? (
        <EmptyState title="No brands" body="Create a brand to start tracking spend." />
      ) : (
        <>
          <div className="stats">
            <StatTile icon={<Coins size={14} aria-hidden />} label="Total spend" value={money(agg.total)} sub={`${span} days`} />
            <StatTile icon={<ListVideo size={14} aria-hidden />} label="Runs billed" value={String(agg.runs)} sub={`${(agg.runs / Math.max(1, span)).toFixed(1)} / day`} />
            <StatTile
              icon={<Target size={14} aria-hidden />}
              label="Avg per run"
              value={agg.runs ? money(perRun) : "—"}
              tone={perRunTone}
              sub={
                agg.runs ? (
                  <>
                    target {money(TARGET_PER_RUN)} ·{" "}
                    <span className={`tone-text-${perRunTone}`}>
                      {perRun > TARGET_PER_RUN ? "+" : "−"}
                      {money(Math.abs(perRun - TARGET_PER_RUN))}
                    </span>
                  </>
                ) : (
                  `target ${money(TARGET_PER_RUN)}`
                )
              }
            />
            <StatTile
              icon={<Gauge size={14} aria-hidden />}
              label="Avg per day"
              value={money(agg.total / Math.max(1, span))}
              sub={dailyBudget ? `daily budget ${money(dailyBudget, 0)}` : undefined}
            />
          </div>

          <DayChartCard data={costs.data ?? []} days={days} dailyBudget={dailyBudget} brandName={brandName} />

          <div className="grid-2">
            <Breakdown title="By provider" data={agg.by_provider} total={agg.total} />
            <Breakdown title="By stage" data={agg.by_stage} total={agg.total} label={(k) => STAGE_META[k]?.label ?? k} />
          </div>
        </>
      )}
    </div>
  );
}

function aggregate(list: BrandCosts[]) {
  const by_provider: Record<string, number> = {};
  const by_stage: Record<string, number> = {};
  let total = 0;
  let runs = 0;
  for (const c of list) {
    total += c.total;
    runs += c.runs;
    for (const [k, v] of Object.entries(c.by_provider)) by_provider[k] = (by_provider[k] ?? 0) + v;
    for (const [k, v] of Object.entries(c.by_stage)) by_stage[k] = (by_stage[k] ?? 0) + v;
  }
  return { total, runs, by_provider, by_stage };
}

function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  if (isNaN(a) || isNaN(b) || b < a) return out;
  for (let t = a; t <= b && out.length < 400; t += 86400_000) out.push(isoDay(new Date(t)));
  return out;
}

function Breakdown({
  title,
  data,
  total,
  label = (k) => k,
}: {
  title: string;
  data: Record<string, number>;
  total: number;
  label?: (k: string) => string;
}) {
  const rows = Object.entries(data)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] ?? 0;
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="muted small">No spend in range.</p>
      ) : (
        <ul className="hbars">
          {rows.map(([k, v]) => (
            <li key={k}>
              <div className="hbar-head">
                <span className="hbar-label">{label(k)}</span>
                <span className="tabular strong">{money(v)}</span>
                <span className="muted small tabular hbar-pct">{total ? `${((v / total) * 100).toFixed(0)}%` : ""}</span>
              </div>
              <div className="hbar-track" aria-hidden>
                <span style={{ width: `${max ? (v / max) * 100 : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(800);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

/** Stacked daily spend (one series per brand in scope), with hover tooltip and a table view. */
function DayChartCard({
  data,
  days,
  dailyBudget,
  brandName,
}: {
  data: BrandCosts[];
  days: string[];
  dailyBudget: number;
  brandName: (id: string) => string;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");
  const series = data.map((c, i) => ({
    id: c.brand_id,
    name: brandName(c.brand_id),
    color: SERIES[i % SERIES.length],
    byDay: new Map(c.by_day.map((d) => [d.day, d.total])),
  }));
  const totals = days.map((d) => series.reduce((s, x) => s + (x.byDay.get(d) ?? 0), 0));
  const H = 260;
  const pad = { l: 48, r: 12, t: 16, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = niceMax(Math.max(...totals, dailyBudget > 0 && Math.max(...totals) > dailyBudget * 0.5 ? dailyBudget : 0, 0.01) * 1.05);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const bw = iw / Math.max(1, days.length);
  const barW = Math.max(2, Math.min(36, bw * 0.64));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.ceil(days.length / Math.max(2, Math.floor(iw / 64)));
  const hasData = totals.some((t) => t > 0);

  return (
    <Card
      title="Spend by day"
      actions={
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            { id: "chart", label: "Chart" },
            { id: "table", label: <Table2 size={14} aria-label="Table" /> },
          ]}
        />
      }
    >
      {series.length > 1 && (
        <ul className="legend legend-inline">
          {series.map((s) => (
            <li key={s.id}>
              <span className="swatch" style={{ background: s.color }} aria-hidden /> {s.name}
            </li>
          ))}
        </ul>
      )}
      <div ref={ref}>
      {view === "table" ? (
        <div className="table-wrap chart-table">
          <table className="table">
            <thead>
              <tr>
                <th>Day</th>
                {series.map((s) => (
                  <th key={s.id} className="num">
                    {s.name}
                  </th>
                ))}
                {series.length > 1 && <th className="num">Total</th>}
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={d}>
                  <td className="tabular">{d}</td>
                  {series.map((s) => (
                    <td key={s.id} className="num">
                      {money(s.byDay.get(d) ?? 0)}
                    </td>
                  ))}
                  {series.length > 1 && <td className="num strong">{money(totals[i])}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart" onMouseLeave={() => setHover(null)}>
          {!hasData && <div className="chart-empty muted small">No spend in this range</div>}
          <svg
            width={W}
            height={H}
            role="img"
            aria-label={`Daily spend from ${days[0]} to ${days[days.length - 1]}, total ${money(totals.reduce((a, b) => a + b, 0))}`}
          >
            {ticks.map((t, i) => (
              <g key={i}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
                <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="axis">
                  {money(t, t < 10 ? 2 : 0).replace(".00", "")}
                </text>
              </g>
            ))}
            {days.map((d, i) => {
              const cx = pad.l + i * bw + bw / 2;
              let acc = 0;
              const segs = series
                .map((s) => ({ s, v: s.byDay.get(d) ?? 0 }))
                .filter((x) => x.v > 0)
                .map((x, j, arr) => {
                  const y0 = y(acc);
                  acc += x.v;
                  const y1 = y(acc);
                  const top = j === arr.length - 1;
                  const h = Math.max(1, y0 - y1 - (top ? 0 : 2));
                  return (
                    <path
                      key={x.s.id}
                      d={roundedTop(cx - barW / 2, y0 - h, barW, h, top ? Math.min(4, barW / 2, h) : 0)}
                      fill={x.s.color}
                    />
                  );
                });
              return (
                <g key={d} className={hover !== null && hover !== i ? "dim" : ""}>
                  {segs}
                  {i % labelEvery === 0 && (
                    <text x={cx} y={H - 8} textAnchor="middle" className="axis">
                      {new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}
                    </text>
                  )}
                  <rect
                    x={pad.l + i * bw}
                    y={pad.t}
                    width={bw}
                    height={ih}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    tabIndex={totals[i] > 0 ? 0 : -1}
                    aria-label={`${d}: ${money(totals[i])}`}
                  />
                </g>
              );
            })}
            <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="baseline" />
            {dailyBudget > 0 && dailyBudget <= max && (
              <g>
                <line x1={pad.l} x2={W - pad.r} y1={y(dailyBudget)} y2={y(dailyBudget)} className="budget-line" />
                <text x={W - pad.r} y={y(dailyBudget) - 6} textAnchor="end" className="axis budget-label">
                  daily budget {money(dailyBudget, 0)}
                </text>
              </g>
            )}
          </svg>
          {hover !== null && (
            <div
              className="tooltip"
              style={{
                left: Math.min(W - 180, Math.max(0, pad.l + hover * bw + bw / 2 - 90)),
                top: Math.max(0, y(totals[hover]) - 16),
              }}
            >
              <div className="tooltip-title">
                {new Date(`${days[hover]}T00:00:00Z`).toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })}
              </div>
              {series.map((s) => (
                <div key={s.id} className="tooltip-row">
                  <span className="swatch" style={{ background: s.color }} aria-hidden />
                  <span className="grow">{s.name}</span>
                  <span className="tabular strong">{money(s.byDay.get(days[hover]) ?? 0)}</span>
                </div>
              ))}
              {dailyBudget > 0 && (
                <div className="tooltip-foot tabular">
                  {Math.round((totals[hover] / dailyBudget) * 100)}% of daily budget
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </div>
    </Card>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}z`;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}z`;
}
