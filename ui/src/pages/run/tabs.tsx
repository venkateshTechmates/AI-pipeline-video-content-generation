import { useMemo, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  Clapperboard,
  ExternalLink,
  FileText,
  Film,
  Lightbulb,
  Minus,
  Send,
  X,
} from "lucide-react";
import { PLATFORM_LABEL, PLATFORM_LIMITS, PlatformIcon, STAGE_META } from "../../components/icons";
import { Card, EmptyState, ScoreRing, StatusPill } from "../../components/ui";
import { dateTime, fmtValue, humanize, money, seconds, timeOnly } from "../../format";
import { STAGES, type Brand, type PlatformMetadata, type PostRecord, type RunDetail } from "../../types";
import { CaptionPreview } from "./PreviewTab";

// ------------------------------------------------------------------ Script

export function ScriptTab({ d, brand }: { d: RunDetail; brand: Brand | null }) {
  const { script, shot_list, hooks, hook, vo } = d.state;
  if (!script)
    return <EmptyState icon={<FileText size={28} />} title="No script yet" body="The script stage hasn't run." />;
  const words = script.vo_text.split(/\s+/).filter(Boolean).length;
  const clips = d.state.clips ?? [];
  const shots = shot_list?.shots ?? [];
  const totalShot = shots.reduce((s, x) => s + x.duration, 0);
  const sortedHooks = [...(hooks ?? [])].sort((a, b) => b.score - a.score);

  return (
    <div className="stack">
      <div className="script-top">
        <Card title="Beats">
          <div className="script-facts">
            <Fact label="Mood" value={script.mood} />
            <Fact label="Target" value={`${script.target_seconds}s`} />
            <Fact label="VO words" value={String(words)} />
            {vo && <Fact label="VO length" value={seconds(vo.duration)} />}
          </div>
          <ol className="beats">
            {script.beats.map((b, i) => (
              <li key={i} className={`beat purpose-${b.purpose}`}>
                <span className="beat-rail" aria-hidden />
                <span className={`purpose-tag purpose-${b.purpose}`}>{b.purpose}</span>
                <span className="beat-text">{b.text}</span>
              </li>
            ))}
          </ol>
          <div className="cta-line">
            <span className="eyebrow">CTA</span> {script.cta}
          </div>
        </Card>
        <div className="stack">
          <Card title="Caption style preview">
            <div className="caption-sample">
              {vo?.words?.length ? (
                <CaptionPreview words={vo.words} t={vo.words[Math.min(4, vo.words.length - 1)].start} style={brand?.kit.caption_style} />
              ) : (
                <div className="caption-stage">
                  <div className="caption-line">{script.hook}</div>
                </div>
              )}
            </div>
            {brand && (
              <p className="muted small">
                {brand.kit.caption_style.font} · {brand.kit.caption_style.words_per_line} words/line ·{" "}
                {brand.kit.caption_style.position}
              </p>
            )}
          </Card>
          <Card title="Voice-over text">
            <p className="prose">{script.vo_text}</p>
          </Card>
          {script.caption_text !== script.vo_text && (
            <Card title="Caption text">
              <p className="prose">{script.caption_text}</p>
            </Card>
          )}
        </div>
      </div>

      {sortedHooks.length > 0 && (
        <Card title={`Hook candidates (${sortedHooks.length})`}>
          <ul className="hooks">
            {sortedHooks.map((h, i) => {
              const chosen = hook ? h.text === hook.text : i === 0;
              return (
                <li key={i} className={`hook-row ${chosen ? "chosen" : ""}`}>
                  <div className="hook-score tabular" title="Ideation score">
                    <span className="hook-score-bar" style={{ width: `${h.score * 100}%` }} aria-hidden />
                    <span>{h.score.toFixed(2)}</span>
                  </div>
                  <div className="hook-text">
                    {h.text}
                    <div className="muted small">
                      {h.angle && <span className="tag">{h.angle}</span>}
                      {typeof h.similarity === "number" && (
                        <span
                          className={`tag ${h.similarity > 0.8 ? "tone-danger" : h.similarity > 0.5 ? "tone-warn" : ""}`}
                          title="Similarity to this brand's recent hooks (dedupe)"
                        >
                          similarity {h.similarity.toFixed(2)}
                        </span>
                      )}
                      {h.rationale && h.rationale !== "fake" && <span> {h.rationale}</span>}
                    </div>
                  </div>
                  {chosen && <span className="chip tone-accent">chosen</span>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {shots.length > 0 && (
        <Card title={`Shot list · ${shots.length} shots · ${seconds(totalShot)}`}>
          <div className="shot-timeline" aria-hidden>
            {shots.map((s) => (
              <span key={s.index} style={{ flexGrow: s.duration }} className="shot-seg">
                {s.index + 1}
              </span>
            ))}
          </div>
          <ol className="shots">
            {shots.map((s) => {
              const clip = clips.find((c) => c.shot_index === s.index);
              return (
                <li key={s.index} className="shot">
                  <div className="shot-thumb">
                    {clip?.url ? (
                      <video src={`${clip.url}#t=0.5`} muted playsInline preload="metadata" aria-label={`Shot ${s.index + 1} clip`} />
                    ) : (
                      <Film size={18} aria-hidden />
                    )}
                  </div>
                  <div className="shot-body">
                    <div className="row gap-sm small">
                      <strong>Shot {s.index + 1}</strong>
                      <span className="muted tabular">{seconds(s.duration)}</span>
                      {s.ref_image && <span className="tag">ref image</span>}
                      {clip && <span className="muted">{clip.provider}</span>}
                    </div>
                    <p className="shot-prompt">{s.prompt}</p>
                    {s.negative_prompt && <p className="shot-neg">Negative: {s.negative_prompt}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <span className="eyebrow">{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}

// ------------------------------------------------------------------ QA

export function QATab({ d }: { d: RunDetail }) {
  const qa = d.state.qa_report;
  if (!qa) return <EmptyState icon={<Check size={28} />} title="QA hasn't run" body="Checks appear after render." />;
  const failedReq = qa.checks.filter((c) => !c.passed && c.weight >= 1).length;
  const failedSoft = qa.checks.filter((c) => !c.passed && c.weight < 1).length;
  return (
    <div className="qa-layout">
      <Card className="qa-summary">
        <div className="qa-summary-inner">
          <ScoreRing score={qa.score} passed={qa.passed} size={96} />
          <div>
            <div className="h3">{qa.passed ? "Passed" : "Failed"}</div>
            <p className="muted small">
              {qa.checks.length - failedReq - failedSoft} of {qa.checks.length} checks passed
              {failedReq ? ` · ${failedReq} required failing` : ""}
              {failedSoft ? ` · ${failedSoft} soft failing` : ""}. Score is weight-averaged; any failing required check
              fails QA.
            </p>
            {d.state.auto_approved && <span className="chip tone-accent">auto-approved by trust score</span>}
          </div>
        </div>
      </Card>
      <Card title="Checks" pad={false}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Check</th>
                <th>Result</th>
                <th>Measured</th>
                <th>Threshold</th>
                <th>Weight</th>
              </tr>
            </thead>
            <tbody>
              {qa.checks.map((c) => (
                <tr key={c.name} className={c.passed ? "" : c.weight >= 1 ? "row-danger" : "row-warn"}>
                  <td className="strong">{humanize(c.name)}</td>
                  <td>
                    {c.passed ? (
                      <span className="result tone-text-success">
                        <Check size={14} aria-hidden /> pass
                      </span>
                    ) : c.weight >= 1 ? (
                      <span className="result tone-text-danger">
                        <X size={14} aria-hidden /> fail
                      </span>
                    ) : (
                      <span className="result tone-text-warn">
                        <AlertTriangle size={14} aria-hidden /> warn
                      </span>
                    )}
                  </td>
                  <td className="mono small">{fmtValue(c.value)}</td>
                  <td className="muted small">{c.detail || "—"}</td>
                  <td>
                    <span className={`tag ${c.weight >= 1 ? "" : "tag-soft"}`}>{c.weight >= 1 ? "required" : `soft ${c.weight}`}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Publish

export function PublishTab({ d }: { d: RunDetail }) {
  const meta = d.state.metadata ?? [];
  const posts = d.posts;
  const platforms = d.run.platforms;
  if (!meta.length && !posts.length)
    return (
      <EmptyState
        icon={<Send size={28} />}
        title="Not published yet"
        body={
          d.run.status === "awaiting_approval"
            ? "Per-platform titles, descriptions and hashtags are written after you approve."
            : "Platform metadata appears after the metadata stage."
        }
      />
    );
  return (
    <div className="meta-grid">
      {platforms.map((p) => {
        const m = meta.find((x) => x.platform === p);
        const post = posts.find((x) => x.platform === p);
        return <PlatformCard key={p} platform={p} meta={m} post={post} />;
      })}
    </div>
  );
}

function CharCount({ n, limit }: { n: number; limit: number | null }) {
  if (!limit) return <span className="muted small tabular">{n}</span>;
  const tone = n > limit ? "danger" : n > limit * 0.9 ? "warn" : "muted";
  return (
    <span className={`small tabular ${tone === "muted" ? "muted" : `tone-text-${tone}`}`}>
      {n}/{limit}
    </span>
  );
}

function PlatformCard({ platform, meta, post }: { platform: PlatformMetadata["platform"]; meta?: PlatformMetadata; post?: PostRecord }) {
  const lim = PLATFORM_LIMITS[platform];
  const desc = meta ? [meta.description, meta.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")].filter(Boolean).join("\n\n") : "";
  return (
    <article className={`meta-card pf-${platform}`}>
      <header className="meta-head">
        <span className={`pf-badge pf-${platform}`}>
          <PlatformIcon platform={platform} size={16} />
        </span>
        <div className="grow">
          <div className="strong">{PLATFORM_LABEL[platform]}</div>
          {meta && <div className="muted small">{meta.aspect}</div>}
        </div>
        {meta?.ai_disclosure ? (
          <span className="chip tone-accent" title="Post will be labelled as AI-generated">
            <Bot size={12} aria-hidden /> AI disclosed
          </span>
        ) : meta ? (
          <span className="chip" title="No AI label on this platform">
            no AI label
          </span>
        ) : null}
      </header>
      {meta ? (
        <>
          {meta.title && (
            <div className="meta-field">
              <div className="row between">
                <span className="eyebrow">Title</span>
                <CharCount n={meta.title.length} limit={lim.title} />
              </div>
              <div className="meta-title">{meta.title}</div>
            </div>
          )}
          <div className="meta-field">
            <div className="row between">
              <span className="eyebrow">Description + tags</span>
              <CharCount n={desc.length} limit={lim.description} />
            </div>
            <p className="meta-desc">{meta.description}</p>
            <div className="hashtags">
              {meta.hashtags.map((h) => (
                <span key={h} className="hashtag">
                  {h.startsWith("#") ? h : `#${h}`}
                </span>
              ))}
            </div>
          </div>
        </>
      ) : (
        <p className="muted small">No metadata for this platform yet.</p>
      )}
      <footer className="meta-foot">
        {post ? (
          <>
            <StatusPill status={post.status} size="sm" />
            <span className="muted small">
              {post.published_at
                ? `Published ${dateTime(post.published_at)}`
                : post.scheduled_at
                  ? `Scheduled ${dateTime(post.scheduled_at)}`
                  : ""}
            </span>
            {post.url && (
              <a href={post.url} target="_blank" rel="noreferrer" className="inline-icon small">
                View post <ExternalLink size={12} aria-hidden />
              </a>
            )}
            {typeof post.metadata?.error === "string" && <span className="tone-text-danger small">{post.metadata.error}</span>}
          </>
        ) : (
          <span className="muted small">Not posted</span>
        )}
      </footer>
    </article>
  );
}

// ------------------------------------------------------------------ Costs

export function CostsTab({ d }: { d: RunDetail }) {
  const byStage = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of d.ledger) m.set(l.stage, (m.get(l.stage) ?? 0) + l.total);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [d.ledger]);
  const total = d.ledger.reduce((s, l) => s + l.total, 0);
  const palette = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)"];
  const colorFor = (stage: string) => palette[Math.max(0, STAGES.indexOf(stage as (typeof STAGES)[number])) % palette.length];
  if (!d.ledger.length) return <EmptyState title="No spend yet" body="Ledger entries appear as providers bill." />;
  return (
    <div className="stack">
      <Card title="By stage" actions={<strong className="tabular">{money(total)}</strong>}>
        <div className="stackbar" role="img" aria-label={`Spend by stage: ${byStage.map(([s, v]) => `${s} ${money(v)}`).join(", ")}`}>
          {byStage.map(([s, v]) => (
            <span key={s} style={{ flexGrow: v, background: colorFor(s) }} title={`${s}: ${money(v)}`} />
          ))}
        </div>
        <ul className="legend">
          {byStage.map(([s, v]) => (
            <li key={s}>
              <span className="swatch" style={{ background: colorFor(s) }} aria-hidden />
              <span>{STAGE_META[s]?.label ?? s}</span>
              <span className="tabular strong">{money(v)}</span>
              <span className="muted tabular small">{total ? `${Math.round((v / total) * 100)}%` : ""}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">
          Budget {money(d.run.budget)} · {d.run.cost_total > d.run.budget ? "over by " : "headroom "}
          {money(Math.abs(d.run.budget - d.run.cost_total))}
        </p>
      </Card>
      <Card title={`Ledger (${d.ledger.length})`} pad={false}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Stage</th>
                <th>Provider</th>
                <th className="num">Units</th>
                <th className="num">Unit cost</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {d.ledger.map((l) => (
                <tr key={l.id}>
                  <td className="tabular small">{timeOnly(l.at)}</td>
                  <td>{STAGE_META[l.stage]?.label ?? l.stage}</td>
                  <td className="mono small">{l.provider}</td>
                  <td className="num">{l.units}</td>
                  <td className="num">{money(l.unit_cost, 3)}</td>
                  <td className="num strong">{money(l.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>Total</td>
                <td className="num strong">{money(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ Lineage

interface LNode {
  key: string;
  title: ReactNode;
  sub?: ReactNode;
  href?: string | null;
}

export function LineageTab({ d }: { d: RunDetail }) {
  const { state, assets, posts, run } = d;
  const clips = [...(state.clips ?? [])].sort((a, b) => a.shot_index - b.shot_index);
  const cols: { title: string; icon: ReactNode; nodes: LNode[] }[] = [
    {
      title: "Brief",
      icon: <FileText size={14} />,
      nodes: [{ key: "brief", title: run.brief ?? <span className="muted">Auto (ideate picked a topic)</span> }],
    },
    {
      title: "Hook",
      icon: <Lightbulb size={14} />,
      nodes: state.hook
        ? [
            {
              key: "hook",
              title: state.hook.text,
              sub: `score ${state.hook.score.toFixed(2)} · ${state.hooks?.length ?? 1} candidates`,
            },
          ]
        : [],
    },
    {
      title: "Prompts",
      icon: <Clapperboard size={14} />,
      nodes: (state.shot_list?.shots ?? []).map((s) => ({
        key: `p${s.index}`,
        title: `Shot ${s.index + 1} · ${seconds(s.duration)}`,
        sub: s.prompt,
      })),
    },
    {
      title: "Assets",
      icon: <Film size={14} />,
      nodes: [
        ...assets
          .filter((a) => a.type === "voiceover")
          .map((a) => ({ key: a.id, title: "Voice-over", sub: shortPath(a.storage_path), href: a.url })),
        ...clips.map((c) => ({ key: c.path, title: `Clip ${c.shot_index + 1}`, sub: `${c.provider} · ${seconds(c.duration)}`, href: c.url })),
        ...(state.music
          ? [
              {
                key: "music",
                title: state.music.title,
                sub: `license ${state.music.license_id}`,
                href: assets.find((a) => a.type === "music")?.url,
              },
            ]
          : []),
        ...assets
          .filter((a) => !["voiceover", "clip", "music", "render"].includes(a.type))
          .map((a) => ({ key: a.id, title: humanize(a.type), sub: shortPath(a.storage_path), href: a.url })),
      ],
    },
    {
      title: "Renders",
      icon: <Clapperboard size={14} />,
      nodes: (state.renders ?? []).map((r) => ({
        key: r.path,
        title: r.aspect,
        sub: `${r.width}×${r.height} · ${seconds(r.duration)}`,
        href: r.url,
      })),
    },
    {
      title: "Posts",
      icon: <Send size={14} />,
      nodes: posts.map((p) => ({
        key: p.id,
        title: (
          <span className="inline-icon">
            <PlatformIcon platform={p.platform} size={13} /> {PLATFORM_LABEL[p.platform]}
          </span>
        ),
        sub: p.status,
        href: p.url,
      })),
    },
  ];
  return (
    <div className="lineage">
      {cols.map((c, i) => (
        <div key={c.title} className="lineage-col">
          <div className="lineage-head">
            <span className="lineage-icon">{c.icon}</span>
            {c.title}
            <span className="muted small tabular">{c.nodes.length || ""}</span>
            {i < cols.length - 1 && <ArrowRight size={14} className="lineage-arrow" aria-hidden />}
          </div>
          <div className="lineage-nodes">
            {c.nodes.length === 0 ? (
              <div className="lnode lnode-empty">
                <Minus size={14} aria-hidden /> none yet
              </div>
            ) : (
              c.nodes.map((n) =>
                n.href ? (
                  <a key={n.key} className="lnode" href={n.href} target="_blank" rel="noreferrer">
                    <div className="lnode-title">
                      {n.title} <ExternalLink size={11} aria-hidden className="muted" />
                    </div>
                    {n.sub && <div className="lnode-sub">{n.sub}</div>}
                  </a>
                ) : (
                  <div key={n.key} className="lnode">
                    <div className="lnode-title">{n.title}</div>
                    {n.sub && <div className="lnode-sub">{n.sub}</div>}
                  </div>
                ),
              )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function shortPath(p: string): string {
  const parts = p.split("/");
  return parts.slice(-2).join("/");
}
