import type { ReactNode } from "react";
import { money, pct } from "../format";
import type { QACheck, RunStatus, StageStatus } from "../types";

export function StatusPill({ status }: { status: RunStatus | StageStatus | string }) {
  return <span className={`pill pill-${status}`}>{status.replace(/_/g, " ")}</span>;
}

export function QaBadge({ score, passed }: { score: number; passed: boolean }) {
  const tone = passed ? (score >= 0.9 ? "good" : "ok") : "bad";
  return (
    <span className={`qa-badge qa-${tone}`} title={passed ? "QA passed" : "QA failed (a required check failed)"}>
      QA {pct(score)} {passed ? "✓" : "✗"}
    </span>
  );
}

export function FailedChecks({ checks }: { checks: QACheck[] }) {
  const failed = checks.filter((c) => !c.passed);
  if (!failed.length) return <div className="muted small">All checks passed</div>;
  return (
    <ul className="failed-checks">
      {failed.map((c) => (
        <li key={c.name} className={c.weight >= 1 ? "req" : "soft"}>
          <strong>{c.name}</strong>
          {c.detail ? <span className="muted"> — {c.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Cost vs. budget bar. Cost is shown prominently per PRD. */
export function CostBar({ cost, budget, large }: { cost: number; budget: number; large?: boolean }) {
  const ratio = budget > 0 ? cost / budget : 0;
  const tone = ratio > 1 ? "bad" : ratio > 0.8 ? "warn" : "good";
  return (
    <div className={`cost-bar ${large ? "cost-bar-lg" : ""}`}>
      <div className="cost-bar-label">
        <span className={`cost-amount cost-${tone}`}>{money(cost)}</span>
        <span className="muted"> / {money(budget)} budget</span>
        <span className={`cost-pct cost-${tone}`}>{pct(ratio)}</span>
      </div>
      <div className="cost-track" role="meter" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={cost}>
        <div className={`cost-fill fill-${tone}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
    </div>
  );
}

export function VideoPlayer({ src, aspect = "9:16", poster }: { src: string | null; aspect?: string; poster?: string }) {
  const cls = aspect === "16:9" ? "video-169" : aspect === "1:1" ? "video-11" : "video-916";
  return (
    <div className={`video-frame ${cls}`}>
      {src ? (
        <video src={src} poster={poster} controls playsInline preload="metadata" />
      ) : (
        <div className="video-empty muted">No preview</div>
      )}
    </div>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="error-box">{msg}</div>;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="loading muted">{label}</div>;
}
