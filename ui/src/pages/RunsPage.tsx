import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ListVideo, Plus, RefreshCw, Search } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorBox, PageHeader, PlatformStack, Skeleton, StatusPill, TierBadge } from "../components/ui";
import { dateTime, money, relTime, shortId } from "../format";
import { useAsync, usePoll } from "../hooks";
import { useBrandScope } from "../state";
import { ACTIVE_STATUSES, type Run, type RunStatus } from "../types";

const GROUPS: { id: string; label: string; match: (s: RunStatus) => boolean }[] = [
  { id: "", label: "All", match: () => true },
  { id: "review", label: "Needs review", match: (s) => s === "awaiting_approval" },
  { id: "active", label: "In progress", match: (s) => ACTIVE_STATUSES.includes(s) },
  { id: "scheduled", label: "Scheduled", match: (s) => s === "scheduled" },
  { id: "published", label: "Published", match: (s) => s === "published" },
  { id: "failed", label: "Failed", match: (s) => ["failed", "dead_letter", "aborted"].includes(s) },
];

export function RunsPage() {
  const [params, setParams] = useSearchParams();
  const group = params.get("status") ?? "";
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const { brands, brandId, setBrandId, brandName } = useBrandScope();
  const runs = useAsync(() => api.runs({ brand_id: brandId || undefined, limit: 200 }).then((r) => r.items), [brandId]);
  const anyActive = (runs.data ?? []).some((r) => ACTIVE_STATUSES.includes(r.status));
  usePoll(() => void runs.reload(true), anyActive ? 4000 : 15000);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const g of GROUPS) c[g.id] = (runs.data ?? []).filter((r) => g.match(r.status)).length;
    return c;
  }, [runs.data]);

  const g = GROUPS.find((x) => x.id === group) ?? GROUPS[0];
  const needle = q.trim().toLowerCase();
  const rows = (runs.data ?? []).filter(
    (r) =>
      g.match(r.status) &&
      (!needle || r.id.startsWith(needle) || (r.brief ?? "").toLowerCase().includes(needle) || brandName(r.brand_id).toLowerCase().includes(needle)),
  );

  const setGroup = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("status", id);
    else next.delete("status");
    setParams(next, { replace: true });
  };

  return (
    <div className="page">
      <PageHeader
        title="Runs"
        subtitle={`${runs.data?.length ?? "…"} most recent runs · auto-refreshing`}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => void runs.reload()} aria-label="Refresh">
              <RefreshCw size={15} /> <span className="hide-mobile">Refresh</span>
            </button>
            <Link className="btn btn-primary" to="/runs/new">
              <Plus size={15} /> New run
            </Link>
          </>
        }
      />

      <div className="filters">
        <div className="chip-tabs" role="tablist" aria-label="Status filter">
          {GROUPS.map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={g.id === x.id}
              className={`chip-tab ${g.id === x.id ? "active" : ""}`}
              onClick={() => setGroup(x.id)}
            >
              {x.label}
              <span className="chip-tab-count tabular">{counts[x.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="filters-right">
          <label className="search">
            <Search size={15} aria-hidden />
            <input
              type="search"
              placeholder="Search brief, brand, id…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search runs"
            />
          </label>
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)} aria-label="Brand filter">
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ErrorBox error={runs.error} onRetry={() => void runs.reload()} />
      {runs.loading && !runs.data ? (
        <div className="card">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton-row">
              <Skeleton h={14} w="30%" />
              <Skeleton h={14} w="15%" />
              <Skeleton h={14} w="20%" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ListVideo size={28} />}
          title={runs.data?.length ? "No runs match" : "No runs yet"}
          body={runs.data?.length ? "Try another status or clear the search." : "Kick off the first video."}
          action={
            <Link className="btn btn-primary" to="/runs/new">
              <Plus size={15} /> New run
            </Link>
          }
        />
      ) : (
        <div className="card">
          <table className="table table-rows runs-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Status</th>
                <th className="hide-md">Tier</th>
                <th className="num">Cost</th>
                <th className="hide-md">Platforms</th>
                <th className="num">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <RunRow key={r.id} r={r} brand={brandName(r.brand_id)} onOpen={() => nav(`/runs/${r.id}`)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RunRow({ r, brand, onOpen }: { r: Run; brand: string; onOpen: () => void }) {
  const ratio = r.budget > 0 ? r.cost_total / r.budget : 0;
  const tone = ratio > 1 ? "danger" : ratio > 0.8 ? "warn" : "success";
  return (
    <tr className={`clickable ${r.status === "awaiting_approval" ? "row-attention" : ""}`} onClick={onOpen}>
      <td className="run-cell">
        <Link to={`/runs/${r.id}`} className="run-link" onClick={(e) => e.stopPropagation()}>
          {r.brief ?? <span className="muted">Auto topic</span>}
        </Link>
        <div className="muted small">
          <code>{shortId(r.id)}</code> · {brand}
          {r.error && <span className="tone-text-danger" title={r.error}> · {r.error.slice(0, 60)}</span>}
        </div>
      </td>
      <td data-label="Status">
        <StatusPill status={r.status} />
      </td>
      <td className="hide-md">
        <TierBadge tier={r.tier} />
      </td>
      <td className="num" data-label="Cost">
        <div className="cost-cell">
          <span className="tabular strong">{money(r.cost_total)}</span>
          <span className="mini-track" aria-hidden>
            <span className={`tone-bg-${tone}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </span>
        </div>
      </td>
      <td className="hide-md">
        <PlatformStack platforms={r.platforms} />
      </td>
      <td className="num muted small" title={dateTime(r.created_at)}>
        {relTime(r.created_at)}
      </td>
    </tr>
  );
}
