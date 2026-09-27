import { Link, useNavigate, useParams } from "react-router-dom";
import { Ban, Bot, Building2, CalendarDays, ChartColumn, Check, Mic, Palette, Plus, ShieldCheck, Type } from "lucide-react";
import { api } from "../api";
import { PLATFORM_LABEL, PlatformIcon } from "../components/icons";
import { Card, EmptyState, ErrorBox, PageHeader, Progress, Skeleton, TierBadge } from "../components/ui";
import { WEEKDAYS, money } from "../format";
import { useAsync } from "../hooks";
import { useBrandScope } from "../state";
import { ALL_PLATFORMS, type Brand } from "../types";
import { PlatformSettings } from "./brand/PlatformSettings";

export function BrandsPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { brands, brandsLoading, brandsError, brandId: scopeId } = useBrandScope();
  const selected = id ?? (scopeId || brands[0]?.id);

  return (
    <div className="page">
      <PageHeader title="Brands" subtitle="Brand kits drive ideation, voice, captions, compliance and the posting calendar." />
      <ErrorBox error={brandsError} />
      {brandsLoading && !brands.length ? (
        <Skeleton h={400} r={12} />
      ) : !brands.length ? (
        <EmptyState icon={<Building2 size={28} />} title="No brands yet" body="Upsert one via POST /brands or `clipforge seed`." />
      ) : (
        <div className="brands-layout">
          <nav className="brand-list" aria-label="Brands">
            {brands.map((b) => (
              <button
                key={b.id}
                className={`brand-item ${b.id === selected ? "active" : ""}`}
                onClick={() => nav(`/brands/${b.id}`)}
                aria-current={b.id === selected ? "page" : undefined}
              >
                <span className="brand-avatar" style={{ background: b.kit?.colors?.accent ?? "var(--accent)" }} aria-hidden>
                  {b.name.slice(0, 1)}
                </span>
                <span className="grow">
                  <span className="strong">{b.name}</span>
                  <span className="muted small">{b.kit?.niche}</span>
                </span>
                <TierBadge tier={b.tier} />
              </button>
            ))}
          </nav>
          {selected && <BrandDetail id={selected} />}
        </div>
      )}
    </div>
  );
}

function BrandDetail({ id }: { id: string }) {
  const b = useAsync(() => api.brand(id), [id]);
  const { brandId, setBrandId } = useBrandScope();
  if (b.error) return <ErrorBox error={b.error} onRetry={() => void b.reload()} />;
  if (!b.data) return <Skeleton h={500} r={12} />;
  const brand: Brand = b.data;
  const k = brand.kit;
  const trustRatio = brand.auto_approve_after ? brand.trust_score / brand.auto_approve_after : 0;

  return (
    <div className="brand-detail">
      <div className="brand-hero card card-body">
        <span className="brand-avatar brand-avatar-lg" style={{ background: k.colors.accent ?? "var(--accent)" }} aria-hidden>
          {brand.name.slice(0, 1)}
        </span>
        <div className="grow">
          <h2 className="h2">{brand.name}</h2>
          <div className="muted small">
            {k.niche} · for {k.audience} · publisher <code>{brand.publisher}</code>
          </div>
        </div>
        <div className="row gap-sm wrap">
          {brandId !== brand.id && (
            <button className="btn btn-ghost" onClick={() => setBrandId(brand.id)}>
              <Check size={15} /> Make active
            </button>
          )}
          <Link className="btn btn-ghost" to={`/brands/${brand.id}/costs`}>
            <ChartColumn size={15} /> Costs
          </Link>
          <Link className="btn btn-primary" to="/runs/new">
            <Plus size={15} /> New run
          </Link>
        </div>
      </div>

      <div className="brand-grid">
        <Card title={<span className="inline-icon"><ShieldCheck size={15} aria-hidden /> Trust & budgets</span>}>
          <div className="trust">
            <div className="row between">
              <span className="strong tabular">
                {brand.trust_score} / {brand.auto_approve_after}
              </span>
              <span className={`small ${trustRatio >= 1 ? "tone-text-success" : "muted"}`}>
                {trustRatio >= 1 ? "Auto-approve active" : `${brand.auto_approve_after - brand.trust_score} more approvals to auto-approve`}
              </span>
            </div>
            <Progress value={brand.trust_score} max={brand.auto_approve_after} tone={trustRatio >= 1 ? "success" : "accent"} />
            <p className="muted small">Consecutive human approvals. At the threshold, runs that pass QA skip the review queue.</p>
          </div>
          <dl className="kv">
            <dt>Default tier</dt>
            <dd>
              <TierBadge tier={brand.tier} />
            </dd>
            <dt>Budget / run</dt>
            <dd className="tabular">{money(brand.budget_per_run)}</dd>
            <dt>Daily budget</dt>
            <dd className="tabular">{money(brand.daily_budget)}</dd>
          </dl>
        </Card>

        <Card title={<span className="inline-icon"><Palette size={15} aria-hidden /> Colours & type</span>}>
          <div className="swatches">
            {Object.entries(k.colors).map(([name, hex]) => (
              <div key={name} className="swatch-card">
                <span className="swatch-lg" style={{ background: hex }} aria-hidden />
                <span className="small strong">{name}</span>
                <code className="small muted">{hex}</code>
              </div>
            ))}
          </div>
          <div className="muted small">Fonts: {k.fonts.join(", ")} · template <code>{k.template}</code></div>
        </Card>

        <Card title={<span className="inline-icon"><Type size={15} aria-hidden /> Caption style</span>}>
          <div
            className={`caption-demo pos-${k.caption_style.position}`}
            style={{ background: `linear-gradient(160deg, ${k.colors.primary ?? "#111"}, ${k.colors.background ?? "#000"})` }}
          >
            <div
              className="caption-line"
              style={{
                color: k.caption_style.color,
                textTransform: k.caption_style.uppercase ? "uppercase" : "none",
                fontFamily: `${k.caption_style.font}, Inter, system-ui, sans-serif`,
                WebkitTextStroke: `${Math.min(3, k.caption_style.stroke_width / 3)}px ${k.caption_style.stroke_color}`,
              }}
            >
              {sampleWords(k.caption_style.words_per_line).map((w, i) => (
                <span key={i} style={i === 1 ? { color: k.caption_style.highlight_color } : undefined}>
                  {w}{" "}
                </span>
              ))}
            </div>
          </div>
          <div className="muted small">
            {k.caption_style.font} {k.caption_style.font_size}px · {k.caption_style.words_per_line} words/line ·{" "}
            {k.caption_style.position} · highlight <code>{k.caption_style.highlight_color}</code>
          </div>
        </Card>

        <Card title={<span className="inline-icon"><Mic size={15} aria-hidden /> Voice & tone</span>}>
          <dl className="kv">
            <dt>Tone</dt>
            <dd>{k.tone}</dd>
            <dt>Voice</dt>
            <dd>
              <code>{k.voice_id}</code>
            </dd>
            <dt>Music</dt>
            <dd>{k.music_moods.join(", ")}</dd>
            <dt>Consistency</dt>
            <dd>{k.consistency.replace("_", " ")}</dd>
            <dt>Hashtags</dt>
            <dd>
              {k.hashtags.length ? k.hashtags.map((h) => <span key={h} className="hashtag">#{h.replace(/^#/, "")}</span>) : "—"}
            </dd>
          </dl>
        </Card>

        <Card title={<span className="inline-icon"><Ban size={15} aria-hidden /> Guardrails</span>}>
          <div className="eyebrow">Banned topics</div>
          <div className="chips">
            {k.banned_topics.length ? k.banned_topics.map((t) => <span key={t} className="chip tone-danger">{t}</span>) : <span className="muted small">none</span>}
          </div>
          <div className="eyebrow mt">Negative prompts</div>
          <div className="chips">
            {k.negative_prompts.map((t) => (
              <span key={t} className="chip">
                {t}
              </span>
            ))}
          </div>
          <div className="eyebrow mt">AI disclosure</div>
          <ul className="disclosure">
            {ALL_PLATFORMS.map((p) => {
              const on = k.disclosure.per_platform[p] ?? k.disclosure.default;
              return (
                <li key={p} title={PLATFORM_LABEL[p]}>
                  <PlatformIcon platform={p} size={14} />
                  <span className={on ? "tone-text-success" : "muted"}>
                    {on ? <Bot size={13} aria-label="labelled" /> : "off"}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title={<span className="inline-icon"><CalendarDays size={15} aria-hidden /> Posting calendar</span>} actions={<span className="muted small">{brand.calendar.timezone}</span>}>
          <div className="week">
            {WEEKDAYS.map((d, i) => {
              const slots = brand.calendar.slots.filter((s) => s.weekday === i);
              return (
                <div key={d} className={`week-day ${slots.length ? "has" : ""}`}>
                  <div className="week-name">{d}</div>
                  {slots.map((s, j) => (
                    <div key={j} className="week-slot" title={s.platforms.map((p) => PLATFORM_LABEL[p]).join(", ")}>
                      <span className="tabular">{s.time}</span>
                      <span className="week-pf">
                        {s.platforms.length === ALL_PLATFORMS.length ? "all" : s.platforms.map((p) => <PlatformIcon key={p} platform={p} size={10} />)}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <PlatformSettings brand={brand} onSaved={(saved) => b.setData(saved)} />
    </div>
  );
}

function sampleWords(n: number): string[] {
  const words = ["small", "habits", "compound", "every", "single", "day"];
  return words.slice(0, Math.max(1, Math.min(words.length, n)));
}
