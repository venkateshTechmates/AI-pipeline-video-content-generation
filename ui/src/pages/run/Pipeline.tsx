import { useMemo } from "react";
import { AlertTriangle, Check, Loader2, Minus, X } from "lucide-react";
import { STAGE_META } from "../../components/icons";
import { durationBetween, money, seconds, timeOnly } from "../../format";
import { useNow } from "../../hooks";
import { STAGES, type Run, type StageRecord } from "../../types";

export interface StageRow {
  name: string;
  rec: StageRecord | undefined;
  attempts: number;
}

/** Latest record per stage (highest attempt), in pipeline order; unknown stages appended. */
export function latestStages(stages: StageRecord[]): StageRow[] {
  const latest = new Map<string, StageRecord>();
  const count = new Map<string, number>();
  for (const s of stages) {
    count.set(s.name, (count.get(s.name) ?? 0) + 1);
    const cur = latest.get(s.name);
    if (!cur || s.attempt > cur.attempt || (s.attempt === cur.attempt && (s.started_at ?? "") >= (cur.started_at ?? "")))
      latest.set(s.name, s);
  }
  const extra = [...latest.keys()].filter((n) => !(STAGES as readonly string[]).includes(n));
  return [...STAGES, ...extra].map((name) => ({ name, rec: latest.get(name), attempts: count.get(name) ?? 0 }));
}

/** Visual state of a stage node, including the "approve" gate which stays pending while awaiting review. */
function nodeState(row: StageRow, run: Run): string {
  const s = row.rec?.status;
  if (row.name === "approve" && run.status === "awaiting_approval") return "waiting";
  if (!s) return "idle";
  return s;
}

export function Pipeline({ stages, run }: { stages: StageRecord[]; run: Run }) {
  const rows = useMemo(() => latestStages(stages), [stages]);
  const anyRunning = rows.some((r) => r.rec?.status === "running");
  useNow(anyRunning ? 1000 : 60_000); // tick live durations
  const done = rows.filter((r) => r.rec?.status === "succeeded" || r.rec?.status === "skipped").length;

  return (
    <div className="pipeline-wrap">
      <div className="pipeline-head">
        <h2 className="eyebrow">Pipeline</h2>
        <span className="muted small tabular">
          {done}/{rows.length} stages complete
        </span>
      </div>
      <ol className="pipeline" aria-label="Pipeline stages">
        {rows.map((row, i) => {
          const meta = STAGE_META[row.name] ?? { label: row.name, icon: Minus, hint: "" };
          const st = nodeState(row, run);
          const rec = row.rec;
          const dur = rec ? durationBetween(rec.started_at, rec.ended_at) : null;
          const Icon = meta.icon;
          const next = rows[i + 1];
          const linkDone = next && (next.rec || st === "succeeded");
          return (
            <li key={row.name} className={`stage st-${st}`}>
              <div className="stage-top">
                <span className="stage-node" aria-hidden>
                  {st === "running" ? (
                    <Loader2 size={16} className="spin" />
                  ) : st === "succeeded" ? (
                    <Check size={16} />
                  ) : st === "failed" ? (
                    <X size={16} />
                  ) : st === "waiting" ? (
                    <Icon size={16} />
                  ) : (
                    <Icon size={16} />
                  )}
                </span>
                {i < rows.length - 1 && <span className={`stage-link ${linkDone ? "done" : ""}`} aria-hidden />}
              </div>
              <div className="stage-label">{meta.label}</div>
              <div className="stage-sub tabular">
                {st === "waiting"
                  ? "waiting for review"
                  : st === "running"
                    ? dur !== null
                      ? seconds(dur)
                      : "running"
                    : rec && st !== "pending"
                      ? dur !== null
                        ? seconds(dur)
                        : st
                      : st === "pending"
                        ? "pending"
                        : "—"}
              </div>
              {rec && (rec.provider || rec.cost > 0) && (
                <div className="stage-provider" title={rec.provider ?? ""}>
                  {rec.provider && <span>{rec.provider}</span>}
                  {rec.cost > 0 && <span className="stage-cost tabular">{money(rec.cost)}</span>}
                </div>
              )}
              {row.attempts > 1 && <div className="stage-attempt">×{row.attempts} attempts</div>}
              <span className="sr-only">
                {meta.label}: {st}
                {rec?.started_at ? `, started ${timeOnly(rec.started_at)}` : ""}
                {rec?.error ? `, error ${rec.error}` : ""}
              </span>
            </li>
          );
        })}
      </ol>
      {rows
        .filter((r) => r.rec?.error)
        .map((r) => (
          <div key={r.name} className="alert tone-danger stage-error" role="alert">
            <AlertTriangle size={16} aria-hidden />
            <div>
              <strong>{STAGE_META[r.name]?.label ?? r.name} failed</strong>
              {r.rec?.attempt ? <span className="muted"> · attempt {r.rec.attempt}</span> : null}
              <pre className="error-pre">{r.rec?.error}</pre>
            </div>
          </div>
        ))}
    </div>
  );
}
