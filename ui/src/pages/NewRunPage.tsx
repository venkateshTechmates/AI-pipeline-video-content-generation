import { useEffect, useState } from "react";
import { LanguagePicker, languageLabel, useLanguages } from "../components/LanguagePicker";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarClock, Crown, Rocket, Zap } from "lucide-react";
import { api } from "../api";
import { PLATFORM_LABEL, PlatformIcon } from "../components/icons";
import { ErrorBox, PageHeader, Spinner } from "../components/ui";
import { WEEKDAYS, localInputToIso, money } from "../format";
import { useBrandScope, useToast } from "../state";
import { ALL_PLATFORMS, type Brand, type Platform, type Tier } from "../types";

/** Per-second list prices (see clipforge/ledger.py PRICES). */
const TIERS: Record<Tier, { name: string; model: string; perSec: number; icon: typeof Zap; blurb: string }> = {
  economy: {
    name: "Economy",
    model: "Kling 3.0 via fal",
    perSec: 0.084,
    icon: Zap,
    blurb: "Fast, good-looking b-roll. The default for daily posting.",
  },
  premium: {
    name: "Premium",
    model: "Veo 3.1",
    perSec: 0.4,
    icon: Crown,
    blurb: "Highest fidelity and motion. For hero content.",
  },
};
const EST_SECONDS = 40;
const VO_EST = 0.1; // ~550 chars of TTS

function slotSummary(b: Brand): string {
  const slots = b.calendar?.slots ?? [];
  if (!slots.length) return "No calendar slots — publishes right after approval";
  const days = [...new Set(slots.map((s) => s.weekday))].sort();
  const times = [...new Set(slots.map((s) => s.time))];
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const dayStr =
    contiguous && days.length > 2 ? `${WEEKDAYS[days[0]]}–${WEEKDAYS[days[days.length - 1]]}` : days.map((d) => WEEKDAYS[d]).join(", ");
  return `${dayStr} at ${times.join(", ")} (${b.calendar.timezone})`;
}

export function NewRunPage() {
  const nav = useNavigate();
  const toast = useToast();
  const { brands, brandId: scopeId, brandsError } = useBrandScope();
  const [brandId, setBrandId] = useState("");
  const [brief, setBrief] = useState("");
  const [tier, setTier] = useState<Tier>("economy");
  const [when, setWhen] = useState<"calendar" | "custom">("calendar");
  const [schedule, setSchedule] = useState("");
  const [budget, setBudget] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>([...ALL_PLATFORMS]);
  const [language, setLanguage] = useState("en");
  const [subtitles, setSubtitles] = useState<string[]>([]);
  const langs = useLanguages();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const brand = brands.find((b) => b.id === brandId);

  useEffect(() => {
    if (!brandId && brands.length) setBrandId(scopeId || brands[0].id);
  }, [brands, brandId, scopeId]);

  // Adopt brand defaults when the brand changes.
  useEffect(() => {
    if (!brand) return;
    setTier(brand.tier);
    setPlatforms(brand.kit?.platforms?.length ? [...brand.kit.platforms] : [...ALL_PLATFORMS]);
    setLanguage(brand.kit?.language ?? "en");
    setSubtitles([...(brand.kit?.subtitle_languages ?? [])]);
    setBudget(String(brand.budget_per_run));
  }, [brand?.id]);

  const toggle = (p: Platform) => setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const budgetNum = Number(budget) || brand?.budget_per_run || 0;
  const est = (t: Tier) => TIERS[t].perSec * EST_SECONDS + VO_EST;
  const estNow = est(tier);
  const over = budgetNum > 0 && estNow > budgetNum;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brandId || platforms.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const { run_id } = await api.createRun({
        brand_id: brandId,
        brief: brief.trim() || undefined,
        tier,
        schedule: when === "custom" ? localInputToIso(schedule) : undefined,
        platforms,
        language,
        subtitle_languages: subtitles,
        budget: budget && Number(budget) !== brand?.budget_per_run ? Number(budget) : undefined,
      });
      toast({ tone: "success", title: "Run started", body: "Follow it live on the run page." });
      nav(`/runs/${run_id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="New run" subtitle="Brief the pipeline. It ideates, scripts, voices, generates, renders and QA-checks — then waits for your review." />
      <ErrorBox error={brandsError} />
      <form className="newrun" onSubmit={submit}>
        <div className="newrun-main">
          <section className="card card-body form">
            <h2 className="section-title">
              <span className="step">1</span> Brand & brief
            </h2>
            <label className="field">
              <span className="field-label">Brand</span>
              <select value={brandId} onChange={(e) => setBrandId(e.target.value)} required>
                {!brands.length && <option value="">No brands</option>}
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            {brand && (
              <div className="brand-strip">
                <span>
                  <span className="eyebrow">Default tier</span> {brand.tier}
                </span>
                <span>
                  <span className="eyebrow">Budget / run</span> {money(brand.budget_per_run)}
                </span>
                <span>
                  <span className="eyebrow">Daily</span> {money(brand.daily_budget)}
                </span>
                <span>
                  <span className="eyebrow">Niche</span> {brand.kit?.niche}
                </span>
              </div>
            )}
            <label className="field">
              <span className="field-label">
                Brief <span className="field-hint">optional — leave empty and the ideate agent picks a topic</span>
              </span>
              <textarea
                rows={4}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="e.g. 3 habits that make mornings easier for remote workers"
                maxLength={500}
              />
              <span className="field-foot muted small tabular">{brief.length}/500</span>
            </label>
          </section>

          <section className="card card-body form">
            <h2 className="section-title">
              <span className="step">2</span> Quality tier
            </h2>
            <div className="tier-cards" role="radiogroup" aria-label="Tier">
              {(Object.keys(TIERS) as Tier[]).map((t) => {
                const m = TIERS[t];
                const e = est(t);
                return (
                  <label key={t} className={`tier-card ${tier === t ? "selected" : ""}`}>
                    <input type="radio" name="tier" value={t} checked={tier === t} onChange={() => setTier(t)} className="sr-only" />
                    <div className="tier-card-head">
                      <span className={`tier-icon tier-${t}`}>
                        <m.icon size={16} aria-hidden />
                      </span>
                      <div className="grow">
                        <div className="strong">
                          {m.name} {brand?.tier === t && <span className="muted small">· brand default</span>}
                        </div>
                        <div className="muted small">{m.model}</div>
                      </div>
                      <span className="radio-dot" aria-hidden />
                    </div>
                    <p className="small muted">{m.blurb}</p>
                    <div className="tier-price">
                      <span className="tabular">
                        <strong>${m.perSec.toFixed(2)}</strong>
                        <span className="muted">/s</span>
                      </span>
                      <span className={`tabular ${budgetNum && e > budgetNum ? "tone-text-warn" : ""}`}>
                        ≈ <strong>{money(e)}</strong> <span className="muted">for {EST_SECONDS}s</span>
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
            <label className="field field-inline">
              <span className="field-label">Run budget</span>
              <span className="input-affix">
                <span>$</span>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  aria-label="Run budget in USD"
                />
              </span>
            </label>
            {over && (
              <div className="alert tone-warn">
                <AlertTriangle size={16} aria-hidden />
                <span>
                  A {EST_SECONDS}s {TIERS[tier].name.toLowerCase()} video is estimated at {money(estNow)}, above the {money(budgetNum)} budget.
                  {tier === "premium"
                    ? " The pipeline will downgrade to economy if that fits, otherwise stop before generating shots."
                    : " Shorter scripts may fit; otherwise the run stops before generating shots."}
                </span>
              </div>
            )}
          </section>

          <section className="card card-body form">
            <h2 className="section-title">
              <span className="step">3</span> Distribution
            </h2>
            <fieldset className="field">
              <legend className="field-label">Platforms</legend>
              <div className="platform-toggles">
                {ALL_PLATFORMS.map((p) => (
                  <button
                    type="button"
                    key={p}
                    className={`platform-toggle pf-${p} ${platforms.includes(p) ? "on" : ""}`}
                    aria-pressed={platforms.includes(p)}
                    onClick={() => toggle(p)}
                  >
                    <PlatformIcon platform={p} size={18} />
                    <span>{PLATFORM_LABEL[p]}</span>
                  </button>
                ))}
              </div>
              {platforms.length === 0 && <span className="tone-text-danger small">Pick at least one platform.</span>}
            </fieldset>
            <LanguagePicker
              language={language}
              subtitles={subtitles}
              onChange={(l, s) => {
                setLanguage(l);
                setSubtitles(s);
              }}
            />
            <fieldset className="field">
              <legend className="field-label">Schedule</legend>
              <div className="sched-options">
                <label className={`sched-option ${when === "calendar" ? "selected" : ""}`}>
                  <input type="radio" name="when" checked={when === "calendar"} onChange={() => setWhen("calendar")} />
                  <div>
                    <div className="strong">Next calendar slot</div>
                    <div className="muted small">{brand ? slotSummary(brand) : "—"}</div>
                  </div>
                </label>
                <label className={`sched-option ${when === "custom" ? "selected" : ""}`}>
                  <input type="radio" name="when" checked={when === "custom"} onChange={() => setWhen("custom")} />
                  <div className="grow">
                    <div className="strong">Specific time</div>
                    <input
                      type="datetime-local"
                      value={schedule}
                      onChange={(e) => {
                        setSchedule(e.target.value);
                        setWhen("custom");
                      }}
                      aria-label="Publish at"
                    />
                  </div>
                </label>
              </div>
            </fieldset>
          </section>
        </div>

        <aside className="newrun-side">
          <div className="card card-body summary-card">
            <h2 className="eyebrow">Summary</h2>
            <dl className="kv">
              <dt>Brand</dt>
              <dd>{brand?.name ?? "—"}</dd>
              <dt>Tier</dt>
              <dd>
                {TIERS[tier].name} · {TIERS[tier].model}
              </dd>
              <dt>Platforms</dt>
              <dd className="platform-row">
                {platforms.length ? platforms.map((p) => <PlatformIcon key={p} platform={p} size={15} />) : "—"}
              </dd>
              <dt>Language</dt>
              <dd>
                {languageLabel(langs, language)}
                {subtitles.length > 0 && <span className="muted small"> · subtitles {subtitles.join(", ")}</span>}
              </dd>
              <dt>Publish</dt>
              <dd className="inline-icon">
                <CalendarClock size={13} aria-hidden />
                {when === "custom" && schedule ? new Date(schedule).toLocaleString() : "Next slot"}
              </dd>
            </dl>
            <div className="est">
              <div className="eyebrow">Estimated cost</div>
              <div className={`est-value tabular ${over ? "tone-text-warn" : ""}`}>{money(estNow)}</div>
              <div className="muted small">
                {EST_SECONDS}s video + voice-over · budget {money(budgetNum)}
              </div>
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-lg btn-block"
              disabled={busy || !brandId || platforms.length === 0 || (when === "custom" && !schedule)}
            >
              {busy ? <Spinner size={16} /> : <Rocket size={16} aria-hidden />} Start run
            </button>
            <ErrorBox error={error} />
          </div>
        </aside>
      </form>
    </div>
  );
}
