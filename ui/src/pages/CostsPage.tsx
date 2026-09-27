import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { ErrorBox, Loading } from "../components/ui";
import { isoDay, money } from "../format";
import { useAsync, useBrands } from "../hooks";

/** /costs -> first brand's cost page. */
export function CostsIndex() {
  const brands = useBrands();
  if (brands.error) return <ErrorBox error={brands.error} />;
  if (!brands.data) return <Loading />;
  if (!brands.data.length) return <div className="empty">No brands yet.</div>;
  return <Navigate to={`/brands/${brands.data[0].id}/costs`} replace />;
}

export function CostsPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const today = new Date();
  const from = params.get("from") ?? isoDay(new Date(today.getTime() - 29 * 86400_000));
  const to = params.get("to") ?? isoDay(today);
  const brands = useBrands();
  const costs = useAsync(() => api.brandCosts(id, { from, to }), [id, from, to]);
  const brand = brands.data?.find((b) => b.id === id);

  const setRange = (f: string, t: string) => setParams({ from: f, to: t });
  const preset = (days: number) => setRange(isoDay(new Date(today.getTime() - (days - 1) * 86400_000)), isoDay(today));

  const c = costs.data;
  const perRun = c && c.runs ? c.total / c.runs : 0;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Costs {brand ? <span className="muted">· {brand.name}</span> : null}</h1>
        <div className="row gap wrap">
          <select
            value={id}
            onChange={(e) => nav(`/brands/${e.target.value}/costs?${params.toString()}`)}
            aria-label="Brand"
          >
            {(brands.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
            {!brand && <option value={id}>{id}</option>}
          </select>
          <label className="inline">
            From <input type="date" value={from} max={to} onChange={(e) => setRange(e.target.value, to)} />
          </label>
          <label className="inline">
            To <input type="date" value={to} min={from} onChange={(e) => setRange(from, e.target.value)} />
          </label>
          {[7, 30, 90].map((d) => (
            <button key={d} className="btn btn-ghost" onClick={() => preset(d)}>
              {d}d
            </button>
          ))}
        </div>
      </div>
      <ErrorBox error={costs.error} />
      {costs.loading && !c ? (
        <Loading />
      ) : c ? (
        <>
          <div className="stats">
            <Stat label="Total spend" value={money(c.total)} big />
            <Stat label="Runs" value={String(c.runs)} />
            <Stat label="Avg / run" value={money(perRun)} />
            {brand && <Stat label="Budget / run" value={money(brand.budget_per_run)} />}
            {brand && <Stat label="Daily budget" value={money(brand.daily_budget)} />}
          </div>

          <section className="panel">
            <h2>Spend by day</h2>
            <DayChart data={c.by_day} dailyBudget={brand?.daily_budget} />
          </section>

          <div className="grid-2">
            <Breakdown title="By provider" data={c.by_provider} total={c.total} />
            <Breakdown title="By stage" data={c.by_stage} total={c.total} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className={`stat panel ${big ? "stat-big" : ""}`}>
      <div className="muted small">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function Breakdown({ title, data, total }: { title: string; data: Record<string, number>; total: number }) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <section className="panel">
      <h2>{title}</h2>
      <table className="table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td>{k}</td>
              <td className="bar-cell">
                <div className="mini-bar" style={{ width: `${total ? (v / total) * 100 : 0}%` }} />
              </td>
              <td className="num">{total ? `${((v / total) * 100).toFixed(1)}%` : "—"}</td>
              <td className="num">
                <strong>{money(v)}</strong>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="muted">No spend in range.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

/** Minimal inline SVG bar chart; scales to container width via viewBox. */
function DayChart({ data, dailyBudget }: { data: { day: string; total: number }[]; dailyBudget?: number }) {
  if (!data.length) return <div className="muted small">No data.</div>;
  const W = 800;
  const H = 220;
  const pad = { l: 48, r: 8, t: 10, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = Math.max(...data.map((d) => d.total), dailyBudget ?? 0, 0.01) * 1.1;
  const bw = iw / data.length;
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.ceil(data.length / 10);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Spend by day">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">
            {money(t)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = pad.l + i * bw;
        const h = pad.t + ih - y(d.total);
        const over = dailyBudget !== undefined && d.total > dailyBudget;
        return (
          <g key={d.day}>
            <rect
              x={x + bw * 0.12}
              y={y(d.total)}
              width={Math.max(1, bw * 0.76)}
              height={Math.max(0, h)}
              rx={2}
              className={over ? "bar bar-over" : "bar"}
            >
              <title>
                {d.day}: {money(d.total)}
              </title>
            </rect>
            {i % labelEvery === 0 && (
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="axis">
                {d.day.slice(5)}
              </text>
            )}
          </g>
        );
      })}
      {dailyBudget !== undefined && dailyBudget > 0 && (
        <g>
          <line x1={pad.l} x2={W - pad.r} y1={y(dailyBudget)} y2={y(dailyBudget)} className="budget-line" />
          <text x={W - pad.r - 4} y={y(dailyBudget) - 4} textAnchor="end" className="axis budget-label">
            daily budget {money(dailyBudget)}
          </text>
        </g>
      )}
    </svg>
  );
}
