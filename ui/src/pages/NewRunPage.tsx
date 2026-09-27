import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { ErrorBox } from "../components/ui";
import { localInputToIso, money } from "../format";
import { useBrands } from "../hooks";
import { ALL_PLATFORMS, type Platform, type Tier } from "../types";

export function NewRunPage() {
  const nav = useNavigate();
  const brands = useBrands();
  const [brandId, setBrandId] = useState("");
  const [brief, setBrief] = useState("");
  const [tier, setTier] = useState<Tier | "">("");
  const [schedule, setSchedule] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>([...ALL_PLATFORMS]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!brandId && brands.data?.length) setBrandId(brands.data[0].id);
  }, [brands.data, brandId]);

  const brand = brands.data?.find((b) => b.id === brandId);

  const toggle = (p: Platform) =>
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brandId || platforms.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const { run_id } = await api.createRun({
        brand_id: brandId,
        brief: brief.trim() || undefined,
        tier: tier || undefined,
        schedule: localInputToIso(schedule),
        platforms,
      });
      nav(`/runs/${run_id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <h1>New run</h1>
      <ErrorBox error={brands.error} />
      <form className="panel form" onSubmit={submit}>
        <label>
          Brand
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)} required>
            {!brands.data?.length && <option value="">No brands</option>}
            {(brands.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        {brand && (
          <div className="muted small">
            Default tier <strong>{brand.tier}</strong> · budget/run <strong>{money(brand.budget_per_run)}</strong> ·
            daily <strong>{money(brand.daily_budget)}</strong> · trust {brand.trust_score}/{brand.auto_approve_after}
          </div>
        )}
        <label>
          Brief <span className="muted small">(optional — otherwise the ideate agent picks a topic)</span>
          <textarea rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} />
        </label>
        <fieldset>
          <legend>Tier</legend>
          <div className="row gap">
            {(["", "economy", "premium"] as const).map((t) => (
              <label key={t || "default"} className="inline">
                <input type="radio" name="tier" checked={tier === t} onChange={() => setTier(t)} />
                {t || `brand default${brand ? ` (${brand.tier})` : ""}`}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          Schedule <span className="muted small">(optional — otherwise the brand calendar)</span>
          <input type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} />
        </label>
        <fieldset>
          <legend>Platforms</legend>
          <div className="row gap wrap">
            {ALL_PLATFORMS.map((p) => (
              <label key={p} className="inline">
                <input type="checkbox" checked={platforms.includes(p)} onChange={() => toggle(p)} />
                {p}
              </label>
            ))}
          </div>
        </fieldset>
        <ErrorBox error={error} />
        <div className="row gap">
          <button type="submit" className="btn btn-primary" disabled={busy || !brandId || platforms.length === 0}>
            {busy ? "Starting…" : "Start run"}
          </button>
        </div>
      </form>
    </div>
  );
}
