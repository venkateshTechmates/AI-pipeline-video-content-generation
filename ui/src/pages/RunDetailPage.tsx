import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, subscribeRunEvents } from "../api";
import { DecisionBar } from "../components/DecisionBar";
import { CostBar, ErrorBox, Loading, QaBadge, Section, StatusPill, VideoPlayer } from "../components/ui";
import { dateTime, duration, fmtValue, money } from "../format";
import { useAsync } from "../hooks";
import { STAGES, type RunDetail, type RunEvent, type StageRecord } from "../types";

export function RunDetailPage() {
  const { id = "" } = useParams();
  const detail = useAsync(() => api.run(id), [id]);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<RunEvent[]>([]);

  // Live updates via SSE: patch stages/status/cost in place, then refetch full detail.
  useEffect(() => {
    if (!id) return;
    let refetch: number | undefined;
    const unsub = subscribeRunEvents(
      id,
      (ev) => {
        setEvents((cur) => [ev, ...cur].slice(0, 50));
        detail.setData((cur) => (cur ? applyEvent(cur, ev) : cur));
        window.clearTimeout(refetch);
        refetch = window.setTimeout(() => void detail.reload(true), 1500);
      },
      setConnected,
    );
    return () => {
      window.clearTimeout(refetch);
      unsub();
    };
  }, [id]);

  if (detail.loading && !detail.data) return <Loading />;
  if (!detail.data) return <ErrorBox error={detail.error ?? "Run not found"} />;

  const d = detail.data;
  const { run, state } = d;
  const script = state.script ?? null;
  const qa = state.qa_report;
  const awaiting = run.status === "awaiting_approval";

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="muted small">
            <Link to="/runs">Runs</Link> / <code>{run.id.slice(0, 8)}</code>
          </div>
          <h1>
            {script?.title || run.brief || "Run"} <StatusPill status={run.status} />
          </h1>
        </div>
        <div className="row gap">
          <span className={`sse-dot ${connected ? "on" : ""}`} title="Live event stream">
            {connected ? "● live" : "○ offline"}
          </span>
          <button className="btn" onClick={() => void detail.reload()}>
            Refresh
          </button>
        </div>
      </div>
      <ErrorBox error={detail.error} />
      {run.error && <div className="error-box">Run error: {run.error}</div>}

      <div className="detail-top">
        <div className="panel">
          <CostBar cost={run.cost_total} budget={run.budget} large />
          <dl className="kv">
            <dt>Tier</dt>
            <dd>{run.tier}</dd>
            <dt>Brand</dt>
            <dd>
              <Link to={`/brands/${run.brand_id}/costs`}>{run.brand_id.slice(0, 8)}</Link>
            </dd>
            <dt>Platforms</dt>
            <dd>{run.platforms.join(", ")}</dd>
            <dt>Schedule</dt>
            <dd>{dateTime(run.schedule)}</dd>
            <dt>Attempts</dt>
            <dd>{run.attempts}</dd>
            <dt>Created</dt>
            <dd>{dateTime(run.created_at)}</dd>
            {run.brief && (
              <>
                <dt>Brief</dt>
                <dd>{run.brief}</dd>
              </>
            )}
          </dl>
          {qa && (
            <div className="row gap">
              <QaBadge score={qa.score} passed={qa.passed} />
            </div>
          )}
        </div>
        {awaiting && (
          <div className="panel">
            <h2>Decision</h2>
            <DecisionBar runId={run.id} script={script} onDone={() => void detail.reload(true)} />
          </div>
        )}
      </div>

      <Section title="Stage timeline">
        <StageTimeline stages={d.stages} />
      </Section>

      {state.renders && state.renders.length > 0 && (
        <Section title="Renders">
          <div className="renders">
            {state.renders.map((r) => (
              <figure key={r.aspect + r.path}>
                <VideoPlayer src={r.url} aspect={r.aspect} />
                <figcaption className="muted small">
                  {r.aspect} · {r.width}×{r.height} · {r.duration.toFixed(1)}s ·{" "}
                  <a href={r.url} target="_blank" rel="noreferrer">
                    open
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
        </Section>
      )}

      {script && (
        <Section title="Script">
          <dl className="kv">
            <dt>Hook</dt>
            <dd>
              <strong>{script.hook}</strong>
            </dd>
            <dt>CTA</dt>
            <dd>{script.cta}</dd>
            <dt>Mood</dt>
            <dd>
              {script.mood} · target {script.target_seconds}s · {script.vo_text.split(/\s+/).filter(Boolean).length}{" "}
              words
            </dd>
          </dl>
          <ol className="beats">
            {script.beats.map((b, i) => (
              <li key={i}>
                <span className={`beat-tag beat-${b.purpose}`}>{b.purpose}</span> {b.text}
              </li>
            ))}
          </ol>
          <h3>VO text</h3>
          <p className="vo">{script.vo_text}</p>
          <h3>Caption text</h3>
          <p className="vo">{script.caption_text}</p>
        </Section>
      )}

      {state.hooks && state.hooks.length > 0 && (
        <Section title="Hook candidates">
          <table className="table">
            <thead>
              <tr>
                <th>Score</th>
                <th>Hook</th>
                <th>Angle</th>
                <th>Rationale</th>
              </tr>
            </thead>
            <tbody>
              {state.hooks.map((h, i) => (
                <tr key={i}>
                  <td className="num">{h.score.toFixed(2)}</td>
                  <td>{h.text}</td>
                  <td>{h.angle}</td>
                  <td className="muted">{h.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {state.shot_list && (
        <Section title={`Shot list (${state.shot_list.shots.length})`}>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Dur</th>
                <th>Prompt</th>
                <th>Negative</th>
              </tr>
            </thead>
            <tbody>
              {state.shot_list.shots.map((s) => (
                <tr key={s.index}>
                  <td className="num">{s.index + 1}</td>
                  <td className="num">{s.duration}s</td>
                  <td>{s.prompt}</td>
                  <td className="muted small">{s.negative_prompt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {qa && (
        <Section title="QA checks" actions={<QaBadge score={qa.score} passed={qa.passed} />}>
          <table className="table">
            <thead>
              <tr>
                <th>Check</th>
                <th>Result</th>
                <th>Value</th>
                <th>Weight</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {qa.checks.map((c) => (
                <tr key={c.name} className={c.passed ? "" : "row-bad"}>
                  <td>{c.name}</td>
                  <td>{c.passed ? <span className="ok">pass</span> : <span className="bad">fail</span>}</td>
                  <td className="mono small">{fmtValue(c.value)}</td>
                  <td className="num">
                    {c.weight}
                    {c.weight >= 1 ? "" : " (soft)"}
                  </td>
                  <td className="muted">{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {state.metadata && state.metadata.length > 0 && (
        <Section title="Platform metadata">
          <div className="meta-grid">
            {state.metadata.map((m) => (
              <div className="meta-card" key={m.platform}>
                <div className="row between">
                  <strong className="platform">{m.platform}</strong>
                  <span className="muted small">
                    {m.aspect} ·{" "}
                    {m.ai_disclosure ? <span className="flag">AI disclosure ON</span> : <span>no AI disclosure</span>}
                  </span>
                </div>
                <div className="meta-title">{m.title}</div>
                <p className="meta-desc">{m.description}</p>
                <div className="hashtags">
                  {m.hashtags.map((h) => (
                    <span key={h} className="tag">
                      {h.startsWith("#") ? h : `#${h}`}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {d.posts.length > 0 && (
        <Section title="Posts">
          <table className="table">
            <thead>
              <tr>
                <th>Platform</th>
                <th>Status</th>
                <th>Scheduled</th>
                <th>Published</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {d.posts.map((p) => (
                <tr key={p.id}>
                  <td>{p.platform}</td>
                  <td>
                    <StatusPill status={p.status} />
                  </td>
                  <td>{dateTime(p.scheduled_at)}</td>
                  <td>{dateTime(p.published_at)}</td>
                  <td>
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noreferrer">
                        {p.external_id ?? "view"}
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="Cost ledger" actions={<strong className="cost-amount">{money(run.cost_total)}</strong>}>
        {d.ledger.length === 0 ? (
          <div className="muted small">No ledger entries yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>At</th>
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
                  <td>{dateTime(l.at)}</td>
                  <td>{l.stage}</td>
                  <td>{l.provider}</td>
                  <td className="num">{l.units}</td>
                  <td className="num">{money(l.unit_cost, 4)}</td>
                  <td className="num">{money(l.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>Total</td>
                <td className="num">
                  <strong>{money(d.ledger.reduce((s, l) => s + l.total, 0))}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </Section>

      {d.assets.length > 0 && (
        <Section title={`Assets (${d.assets.length})`}>
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Path</th>
                <th>SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {d.assets.map((a) => (
                <tr key={a.id}>
                  <td>{a.type}</td>
                  <td>
                    <a href={a.url} target="_blank" rel="noreferrer" className="mono small">
                      {a.storage_path}
                    </a>
                  </td>
                  <td className="mono small muted">{a.sha256.slice(0, 12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {events.length > 0 && (
        <Section title="Live events">
          <pre className="events">{events.map((e) => JSON.stringify(e)).join("\n")}</pre>
        </Section>
      )}
    </div>
  );
}

function StageTimeline({ stages }: { stages: StageRecord[] }) {
  // Latest record per stage name, in pipeline order; unknown stages appended.
  const rows = useMemo(() => {
    const latest = new Map<string, StageRecord>();
    for (const s of stages) {
      const cur = latest.get(s.name);
      if (!cur || s.attempt >= cur.attempt) latest.set(s.name, s);
    }
    const order: string[] = [...STAGES, ...[...latest.keys()].filter((n) => !(STAGES as readonly string[]).includes(n))];
    return order.map((name) => ({ name, rec: latest.get(name) }));
  }, [stages]);

  return (
    <table className="table timeline">
      <thead>
        <tr>
          <th>Stage</th>
          <th>Status</th>
          <th>Provider</th>
          <th className="num">Attempt</th>
          <th className="num">Cost</th>
          <th className="num">Duration</th>
          <th>Started</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ name, rec }) => (
          <tr key={name} className={rec ? `stage-${rec.status}` : "stage-none"}>
            <td>
              <span className={`dot dot-${rec?.status ?? "pending"}`} /> {name}
            </td>
            <td>{rec ? <StatusPill status={rec.status} /> : <span className="muted">—</span>}</td>
            <td>{rec?.provider ?? "—"}</td>
            <td className="num">{rec ? rec.attempt : "—"}</td>
            <td className="num">{rec ? money(rec.cost) : "—"}</td>
            <td className="num">{rec ? duration(rec.started_at, rec.ended_at) : "—"}</td>
            <td>{dateTime(rec?.started_at)}</td>
            <td className="bad small">{rec?.error ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function applyEvent(d: RunDetail, ev: RunEvent): RunDetail {
  switch (ev.type) {
    case "status":
      return { ...d, run: { ...d.run, status: ev.status, error: ev.error ?? d.run.error } };
    case "cost": {
      const total = typeof ev.cost_total === "number" ? ev.cost_total : typeof ev.total === "number" ? ev.total : null;
      return total === null ? d : { ...d, run: { ...d.run, cost_total: total } };
    }
    case "stage": {
      const name = ev.name ?? ev.stage;
      if (!name) return d;
      const { type: _t, stage: _s, ...rest } = ev;
      void _t;
      void _s;
      const idx = ev.id
        ? d.stages.findIndex((s) => s.id === ev.id)
        : d.stages.findIndex((s) => s.name === name && s.attempt === (ev.attempt ?? s.attempt));
      const stages = [...d.stages];
      if (idx >= 0) stages[idx] = { ...stages[idx], ...rest, name };
      else
        stages.push({
          id: ev.id ?? `${name}-${ev.attempt ?? 0}`,
          run_id: d.run.id,
          status: "running",
          attempt: 0,
          provider: null,
          cost: 0,
          input_ref: null,
          output_ref: null,
          error: null,
          started_at: new Date().toISOString(),
          ended_at: null,
          ...rest,
          name,
        });
      return { ...d, stages };
    }
    default:
      return d;
  }
}
