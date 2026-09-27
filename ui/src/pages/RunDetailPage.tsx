import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Clock, RefreshCw, RotateCcw, Timer } from "lucide-react";
import { api, subscribeRunEvents } from "../api";
import { DecisionBar } from "../components/DecisionBar";
import {
  CostMeter,
  ErrorBox,
  PlatformStack,
  ScoreRing,
  Skeleton,
  Spinner,
  StatusPill,
  Tabs,
  TierBadge,
} from "../components/ui";
import { STAGE_META } from "../components/icons";
import { dateTime, durationBetween, relTime, seconds, shortId } from "../format";
import { useAsync } from "../hooks";
import { useBrandScope, useQueue, useToast } from "../state";
import { RETRYABLE_STATUSES, type ApprovalDecision, type RunDetail, type RunEvent } from "../types";
import { Pipeline } from "./run/Pipeline";
import { PreviewTab } from "./run/PreviewTab";
import { CostsTab, LineageTab, PublishTab, QATab, ScriptTab } from "./run/tabs";

type TabId = "preview" | "script" | "qa" | "publish" | "costs" | "lineage";

export function RunDetailPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabId) || "preview";
  const detail = useAsync(() => api.run(id), [id]);
  const [connected, setConnected] = useState(false);
  const { brands, brandName } = useBrandScope();
  const toast = useToast();
  const queue = useQueue();
  const [retrying, setRetrying] = useState(false);
  const reloadRef = useRef(detail.reload);
  reloadRef.current = detail.reload;

  // Live updates via SSE: patch stages/status/cost in place, then refetch the
  // full view (state/assets/posts) shortly after meaningful changes.
  useEffect(() => {
    if (!id) return;
    let refetch: number | undefined;
    const unsub = subscribeRunEvents(
      id,
      (ev) => {
        detail.setData((cur) => (cur ? applyEvent(cur, ev) : cur));
        if (ev.type !== "cost") {
          window.clearTimeout(refetch);
          refetch = window.setTimeout(() => void reloadRef.current(true), 800);
        }
      },
      setConnected,
    );
    return () => {
      window.clearTimeout(refetch);
      unsub();
    };
  }, [id]);

  if (detail.loading && !detail.data) return <DetailSkeleton />;
  if (!detail.data)
    return (
      <div className="page">
        <ErrorBox error={detail.error ?? "Run not found"} onRetry={() => void detail.reload()} />
      </div>
    );

  const d = detail.data;
  const { run, state } = d;
  const brand = brands.find((b) => b.id === run.brand_id) ?? null;
  const script = state.script ?? null;
  const qa = state.qa_report;
  const awaiting = run.status === "awaiting_approval";
  const retryable = RETRYABLE_STATUSES.includes(run.status);
  const title = script?.title || run.brief || `Run ${shortId(run.id)}`;
  const firstStart = d.stages.map((s) => s.started_at).filter(Boolean).sort()[0] ?? run.created_at;
  const wall = durationBetween(firstStart, ["published", "scheduled", "failed", "aborted", "dead_letter"].includes(run.status) ? run.updated_at : null);

  const decide = async (dec: ApprovalDecision) => {
    try {
      await api.decide(run.id, dec);
      queue.remove(run.id);
      toast({
        tone: dec.decision === "reject" ? "warn" : dec.decision === "approve" ? "success" : "info",
        title:
          dec.decision === "approve"
            ? "Approved — publishing"
            : dec.decision === "regenerate"
              ? `Regenerating from ${STAGE_META[dec.stage!]?.label ?? dec.stage}`
              : dec.decision === "edit"
                ? "Script edit sent"
                : "Run rejected",
      });
      void detail.reload(true);
    } catch (e) {
      toast({ tone: "error", title: `Couldn't ${dec.decision}`, body: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  };

  const retry = async () => {
    setRetrying(true);
    try {
      await api.retry(run.id);
      toast({ tone: "info", title: "Run re-queued", body: "It resumes from its last checkpoint." });
      void detail.reload(true);
    } catch (e) {
      toast({ tone: "error", title: "Retry failed", body: e instanceof Error ? e.message : String(e) });
    } finally {
      setRetrying(false);
    }
  };

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "preview", label: "Preview" },
    { id: "script", label: "Script" },
    { id: "qa", label: "QA", count: qa ? qa.checks.filter((c) => !c.passed).length || undefined : undefined },
    { id: "publish", label: "Publish", count: d.posts.length || undefined },
    { id: "costs", label: "Costs" },
    { id: "lineage", label: "Lineage" },
  ];

  return (
    <div className="page">
      <header className="run-head">
        <div className="crumbs">
          <Link to="/runs">Runs</Link>
          <span aria-hidden>/</span>
          <code>{shortId(run.id)}</code>
          <span className={`live-ind ${connected ? "" : "muted"}`} title="Live event stream (SSE)">
            <span className={`live-dot ${connected ? "on" : ""}`} aria-hidden />
            {connected ? "Live" : "Reconnecting…"}
          </span>
        </div>
        <div className="run-title-row">
          <h1>{title}</h1>
          <div className="run-actions">
            {retryable && (
              <button className="btn btn-primary" onClick={() => void retry()} disabled={retrying}>
                {retrying ? <Spinner size={15} /> : <RotateCcw size={15} />} Retry run
              </button>
            )}
            <button className="icon-btn icon-btn-bordered" onClick={() => void detail.reload()} aria-label="Refresh">
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
        <div className="run-meta">
          <StatusPill status={run.status} />
          <TierBadge tier={run.tier} />
          <Link to={`/brands/${run.brand_id}`} className="muted">
            {brandName(run.brand_id)}
          </Link>
          <span className="muted inline-icon" title={dateTime(run.created_at)}>
            <Clock size={13} aria-hidden /> {relTime(run.created_at)}
          </span>
          {wall !== null && (
            <span className="muted inline-icon" title="Wall-clock time">
              <Timer size={13} aria-hidden /> {seconds(wall)}
            </span>
          )}
          {run.attempts > 0 && <span className="muted">{run.attempts} attempts</span>}
          <PlatformStack platforms={run.platforms} />
        </div>
      </header>

      {run.error && (
        <div className="alert tone-danger" role="alert">
          <strong>Run error</strong>
          <span className="mono small">{run.error}</span>
        </div>
      )}

      <div className="run-summary">
        <div className="summary-cell">
          <div className="eyebrow">Cost vs budget</div>
          <CostMeter cost={run.cost_total} budget={run.budget} />
        </div>
        <div className="summary-cell summary-qa">
          {qa ? (
            <>
              <ScoreRing score={qa.score} passed={qa.passed} size={44} />
              <div>
                <div className="eyebrow">QA</div>
                <div className="strong">
                  {qa.checks.filter((c) => c.passed).length}/{qa.checks.length} checks
                </div>
              </div>
            </>
          ) : (
            <div>
              <div className="eyebrow">QA</div>
              <div className="muted">pending</div>
            </div>
          )}
        </div>
        <div className="summary-cell">
          <div className="eyebrow">Publish</div>
          <div className="strong">{publishLabel(d)}</div>
          {state.decision && (
            <div className="muted small">
              Last decision: {state.decision.decision}
              {state.decision.stage ? ` → ${state.decision.stage}` : ""}
              {state.decision.reviewer ? ` by ${state.decision.reviewer}` : ""}
            </div>
          )}
          {state.auto_approved && <div className="muted small">Auto-approved (trust score)</div>}
        </div>
      </div>

      {awaiting && (
        <div className="decision-panel">
          <div>
            <div className="strong">This run is waiting for your review</div>
            <div className="muted small">Approve to generate metadata and publish, or send it back.</div>
          </div>
          <DecisionBar script={script} onDecide={decide} />
        </div>
      )}

      <section className="card pipeline-card">
        <Pipeline stages={d.stages} run={run} />
      </section>

      <Tabs
        label="Run sections"
        tabs={tabs}
        value={tab}
        onChange={(t) => {
          const next = new URLSearchParams(params);
          if (t === "preview") next.delete("tab");
          else next.set("tab", t);
          setParams(next, { replace: true });
        }}
      />
      <div className="tab-panel" role="tabpanel">
        {tab === "preview" && <PreviewTab d={d} brand={brand} />}
        {tab === "script" && <ScriptTab d={d} brand={brand} />}
        {tab === "qa" && <QATab d={d} />}
        {tab === "publish" && <PublishTab d={d} />}
        {tab === "costs" && <CostsTab d={d} />}
        {tab === "lineage" && <LineageTab d={d} />}
      </div>
    </div>
  );
}

function publishLabel(d: RunDetail): string {
  const published = d.posts.filter((p) => p.status === "published").length;
  if (d.posts.length && published === d.posts.length) return `Published to ${published} platform${published === 1 ? "" : "s"}`;
  const next = d.posts
    .map((p) => p.scheduled_at)
    .filter((x): x is string => !!x)
    .sort()[0];
  if (next) return `Scheduled ${dateTime(next)}${published ? ` · ${published} live` : ""}`;
  return d.run.schedule ? dateTime(d.run.schedule) : "Next calendar slot";
}

function DetailSkeleton() {
  return (
    <div className="page">
      <Skeleton h={14} w={160} />
      <Skeleton h={34} w="60%" />
      <Skeleton h={20} w="40%" />
      <Skeleton h={90} />
      <Skeleton h={130} />
      <Skeleton h={360} />
    </div>
  );
}

export function applyEvent(d: RunDetail, ev: RunEvent): RunDetail {
  switch (ev.type) {
    case "status":
      return { ...d, run: { ...d.run, status: ev.status, error: ev.error } };
    case "cost":
      return { ...d, run: { ...d.run, cost_total: ev.cost_total, budget: ev.budget ?? d.run.budget } };
    case "stage": {
      const { type: _t, ...rec } = ev;
      void _t;
      const idx = d.stages.findIndex((s) => s.id === rec.id);
      const stages = [...d.stages];
      if (idx >= 0) stages[idx] = rec;
      else stages.push(rec);
      return { ...d, stages };
    }
    default:
      return d;
  }
}

