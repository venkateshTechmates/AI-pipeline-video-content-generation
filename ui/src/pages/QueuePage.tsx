import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { DecisionBar, type DecisionBarHandle } from "../components/DecisionBar";
import { CostBar, ErrorBox, FailedChecks, Loading, QaBadge, VideoPlayer } from "../components/ui";
import { money, relTime } from "../format";
import { useAsync, useBrands, useLiveRefresh } from "../hooks";
import type { QueueItem } from "../types";

export function QueuePage() {
  const [params, setParams] = useSearchParams();
  const brandId = params.get("brand_id") ?? "";
  const brands = useBrands();
  const queue = useAsync(() => api.queue(brandId || undefined).then((r) => r.items), [brandId]);
  const live = useLiveRefresh(() => void queue.reload(true));

  const items = queue.data ?? [];
  const totalCost = items.reduce((s, i) => s + (i.cost_total ?? 0), 0);

  return (
    <div className="page">
      <div className="page-head">
        <h1>
          Approval queue <span className="count">{items.length}</span>
        </h1>
        <div className="row gap">
          <span className="muted small" title="Queue refresh mode">
            {live === "realtime" ? "● live" : "○ polling 10s"}
          </span>
          <select
            value={brandId}
            onChange={(e) => {
              const v = e.target.value;
              setParams(v ? { brand_id: v } : {});
            }}
          >
            <option value="">All brands</option>
            {(brands.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => void queue.reload()}>
            Refresh
          </button>
        </div>
      </div>
      <p className="muted small">
        Pending spend in queue: <strong>{money(totalCost)}</strong> · Focus a card (click or Tab) then press{" "}
        <kbd>A</kbd> approve, <kbd>R</kbd> regenerate, <kbd>E</kbd> edit, <kbd>J</kbd>/<kbd>K</kbd> next/prev.
      </p>

      <ErrorBox error={queue.error} />
      {queue.loading && !queue.data ? (
        <Loading />
      ) : items.length === 0 ? (
        <div className="empty">Nothing awaiting approval.</div>
      ) : (
        <div className="queue-grid">
          {items.map((item) => (
            <QueueCard
              key={item.run.id}
              item={item}
              onDone={() => {
                // optimistic removal; realtime/poll will reconcile
                queue.setData((cur) => (cur ?? []).filter((x) => x.run.id !== item.run.id));
                void queue.reload(true);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QueueCard({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const bar = useRef<DecisionBarHandle>(null);
  const [focused, setFocused] = useState(false);
  const { run, script, qa } = item;
  const title = script?.title || run.brief || "Untitled run";

  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    const tag = (e.target as HTMLElement).tagName;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "a") bar.current?.approve();
    else if (key === "r") bar.current?.regenerate();
    else if (key === "e") bar.current?.edit();
    else if (key === "j" || key === "k") {
      const cards = Array.from(document.querySelectorAll<HTMLElement>(".queue-card"));
      const i = cards.indexOf(e.currentTarget);
      cards[key === "j" ? Math.min(cards.length - 1, i + 1) : Math.max(0, i - 1)]?.focus();
    } else return;
    e.preventDefault();
  };

  return (
    <article
      className={`queue-card panel ${focused ? "focused" : ""}`}
      tabIndex={0}
      onKeyDown={onKey}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false);
      }}
    >
      <VideoPlayer src={item.preview_url} aspect="9:16" />
      <div className="queue-body">
        <div className="row between">
          <span className="brand-tag">{item.brand_name}</span>
          <span className="muted small" title={run.created_at}>
            {run.tier} · {relTime(run.created_at)}
          </span>
        </div>
        <h3 className="queue-title">
          <Link to={`/runs/${run.id}`}>{title}</Link>
        </h3>
        {script?.hook && <p className="hook">“{script.hook}”</p>}
        <CostBar cost={item.cost_total} budget={item.budget} large />
        <div className="qa-block">
          {qa ? (
            <>
              <QaBadge score={qa.score} passed={qa.passed} />
              <FailedChecks checks={qa.checks} />
            </>
          ) : (
            <span className="muted small">No QA report</span>
          )}
        </div>
        <div className="muted small">
          Platforms: {run.platforms.join(", ")}
          {run.schedule ? ` · scheduled ${new Date(run.schedule).toLocaleString()}` : ""}
        </div>
        <DecisionBar ref={bar} runId={run.id} script={script} onDone={onDone} showShortcuts={focused} />
      </div>
    </article>
  );
}
