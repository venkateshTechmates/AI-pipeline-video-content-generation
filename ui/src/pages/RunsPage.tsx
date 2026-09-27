import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { ErrorBox, Loading, StatusPill } from "../components/ui";
import { money, relTime } from "../format";
import { useAsync, useBrands } from "../hooks";
import { RUN_STATUSES, type RunStatus } from "../types";

export function RunsPage() {
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") ?? "") as RunStatus | "";
  const brandId = params.get("brand_id") ?? "";
  const limit = Number(params.get("limit") ?? 50);
  const brands = useBrands();
  const runs = useAsync(
    () => api.runs({ status, brand_id: brandId || undefined, limit }).then((r) => r.items),
    [status, brandId, limit],
  );
  const brandName = (id: string) => brands.data?.find((b) => b.id === id)?.name ?? id.slice(0, 8);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Runs</h1>
        <div className="row gap">
          <select value={status} onChange={(e) => setParam("status", e.target.value)} aria-label="Status filter">
            <option value="">All statuses</option>
            {RUN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <select value={brandId} onChange={(e) => setParam("brand_id", e.target.value)} aria-label="Brand filter">
            <option value="">All brands</option>
            {(brands.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select value={limit} onChange={(e) => setParam("limit", e.target.value)} aria-label="Limit">
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => void runs.reload()}>
            Refresh
          </button>
          <Link className="btn btn-primary" to="/runs/new">
            + New run
          </Link>
        </div>
      </div>
      <ErrorBox error={runs.error} />
      {runs.loading && !runs.data ? (
        <Loading />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Brand</th>
              <th>Status</th>
              <th>Tier</th>
              <th>Brief</th>
              <th className="num">Cost / budget</th>
              <th>Platforms</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {(runs.data ?? []).map((r) => (
              <tr key={r.id} className={r.status === "awaiting_approval" ? "row-hl" : ""}>
                <td>
                  <Link to={`/runs/${r.id}`} className="mono">
                    {r.id.slice(0, 8)}
                  </Link>
                </td>
                <td>{brandName(r.brand_id)}</td>
                <td>
                  <StatusPill status={r.status} />
                </td>
                <td>{r.tier}</td>
                <td className="truncate" title={r.brief ?? ""}>
                  {r.brief ?? <span className="muted">—</span>}
                </td>
                <td className={`num ${r.cost_total > r.budget ? "bad" : ""}`}>
                  <strong>{money(r.cost_total)}</strong> <span className="muted">/ {money(r.budget)}</span>
                </td>
                <td className="small">{r.platforms.join(", ")}</td>
                <td className="small" title={r.created_at}>
                  {relTime(r.created_at)}
                </td>
              </tr>
            ))}
            {runs.data?.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No runs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
