import { createRef, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, CalendarClock, Inbox, Plus, RefreshCw, Sparkles } from "lucide-react";
import { api } from "../api";
import { DecisionBar, type DecisionBarHandle } from "../components/DecisionBar";
import {
  CheckChips,
  CostMeter,
  EmptyState,
  ErrorBox,
  Kbd,
  PageHeader,
  PhoneFrame,
  PlatformStack,
  ScoreRing,
  Skeleton,
  TierBadge,
} from "../components/ui";
import { STAGE_META } from "../components/icons";
import { CaptionPreview } from "./run/PreviewTab";
import { dateTime, money, relTime } from "../format";
import { isTypingTarget, useAsync, useMediaQuery } from "../hooks";
import { useBrandScope, useQueue, useToast } from "../state";
import { ACTIVE_STATUSES, type ApprovalDecision, type QueueItem } from "../types";

export function QueuePage() {
  const queue = useQueue();
  const toast = useToast();
  const nav = useNavigate();
  const { brand } = useBrandScope();
  const [focus, setFocus] = useState(0);
  const wide = useMediaQuery("(min-width: 1180px)");
  const items = queue.items;
  const refs = useRef(new Map<string, RefObject<DecisionBarHandle>>());
  const cardRefs = useRef(new Map<string, HTMLElement | null>());

  const barRef = (id: string) => {
    let r = refs.current.get(id);
    if (!r) refs.current.set(id, (r = createRef<DecisionBarHandle>()));
    return r;
  };

  const idx = Math.min(focus, Math.max(0, items.length - 1));
  const current = items[idx];

  // Keep the focused card in view after keyboard navigation (not on load).
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    if (current && !wide) {
      const el = cardRefs.current.get(current.run.id);
      el?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  }, [current?.run.id, wide]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("dialog[open]") || document.querySelector(".menu")) return;
      if (!current) return;
      const bar = refs.current.get(current.run.id)?.current;
      const key = e.key.toLowerCase();
      if (key === "j" || key === "k") {
        moved.current = true;
        setFocus(key === "j" ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1));
      }
      else if (key === "a") bar?.approve();
      else if (key === "r") bar?.regenerate();
      else if (key === "e") bar?.edit();
      else if (key === "x") bar?.reject();
      else if (key === "o" || key === "enter") {
        if ((e.target as HTMLElement).closest?.("button, a")) return;
        nav(`/runs/${current.run.id}`);
      } else if (key === " ") {
        if ((e.target as HTMLElement).closest?.("button, a, video")) return;
        const v = cardRefs.current.get(current.run.id)?.querySelector("video");
        if (v) void (v.paused ? v.play() : v.pause());
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, idx, items.length, nav]);

  const decide = async (item: QueueItem, d: ApprovalDecision) => {
    const title = item.script?.title || item.run.brief || "Run";
    queue.remove(item.run.id);
    try {
      await api.decide(item.run.id, d);
      toast(
        d.decision === "approve"
          ? { tone: "success", title: "Approved", body: `${title} — metadata & publishing will follow.` }
          : d.decision === "regenerate"
            ? { tone: "info", title: `Regenerating from ${STAGE_META[d.stage!]?.label ?? d.stage}`, body: title }
            : d.decision === "edit"
              ? { tone: "info", title: "Script edit sent", body: `${title} — re-voicing and re-rendering.` }
              : { tone: "warn", title: "Rejected", body: title },
      );
      queue.reload();
    } catch (e) {
      queue.restore(item);
      toast({ tone: "error", title: `Couldn't ${d.decision}`, body: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  };

  const pending = items.reduce((s, i) => s + (i.cost_total ?? 0), 0);

  return (
    <div className="page">
      <PageHeader
        title={
          <>
            Review queue {items.length > 0 && <span className="count-badge">{items.length}</span>}
          </>
        }
        subtitle={
          <>
            {brand ? brand.name : "All brands"} · {money(pending)} of generation awaiting a decision ·{" "}
            <span className="live-ind">
              <span className={`live-dot ${queue.live === "realtime" ? "on" : "poll"}`} aria-hidden />
              {queue.live === "realtime" ? "Live" : "Auto-refresh 10s"}
            </span>
          </>
        }
        actions={
          <>
            <span className="hide-mobile muted small shortcut-hint">
              <Kbd>J</Kbd>
              <Kbd>K</Kbd> move · <Kbd>A</Kbd> approve · <Kbd>?</Kbd> all shortcuts
            </span>
            <button className="btn btn-ghost hide-mobile" onClick={queue.reload} aria-label="Refresh queue">
              <RefreshCw size={15} /> <span className="hide-mobile">Refresh</span>
            </button>
          </>
        }
      />
      <ErrorBox error={queue.error} onRetry={queue.reload} />

      {queue.loading ? (
        <div className="queue-grid">
          {[0, 1].map((i) => (
            <div className="qcard" key={i}>
              <Skeleton h={420} w={236} r={28} />
              <div className="qcard-body">
                <Skeleton h={14} w="40%" />
                <Skeleton h={26} w="85%" />
                <Skeleton h={48} />
                <Skeleton h={40} />
                <Skeleton h={36} />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <QueueEmpty />
      ) : wide ? (
        <div className="triage">
          <QueueRail items={items} idx={idx} onSelect={setFocus} />
          {current && (
            <QueueCard
              key={current.run.id}
              item={current}
              focused
              wide
              position={`${idx + 1} of ${items.length}`}
              onFocus={() => undefined}
              barRef={barRef(current.run.id)}
              cardRef={(el) => cardRefs.current.set(current.run.id, el)}
              onDecide={(d) => decide(current, d)}
            />
          )}
        </div>
      ) : (
        <div className="queue-grid">
          {items.map((item, i) => (
            <QueueCard
              key={item.run.id}
              item={item}
              focused={i === idx}
              onFocus={() => setFocus(i)}
              barRef={barRef(item.run.id)}
              cardRef={(el) => cardRefs.current.set(item.run.id, el)}
              onDecide={(d) => decide(item, d)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QueueCard({
  item,
  focused,
  wide,
  position,
  onFocus,
  barRef,
  cardRef,
  onDecide,
}: {
  item: QueueItem;
  focused: boolean;
  wide?: boolean;
  position?: string;
  onFocus: () => void;
  barRef: RefObject<DecisionBarHandle>;
  cardRef: (el: HTMLElement | null) => void;
  onDecide: (d: ApprovalDecision) => Promise<void>;
}) {
  const { run, script, qa } = item;
  const title = script?.title || run.brief || "Untitled run";
  const [t, setT] = useState(0);
  const { brands } = useBrandScope();
  const captionStyle = brands.find((b) => b.id === run.brand_id)?.kit?.caption_style;
  return (
    <article
      ref={cardRef}
      className={`qcard ${wide ? "qcard-wide" : focused ? "is-focused" : ""}`}
      onMouseDown={onFocus}
      onFocusCapture={onFocus}
      aria-label={`${title}, awaiting review`}
      aria-current={focused ? "true" : undefined}
    >
      <div className="qcard-media">
        <PhoneFrame src={item.preview_url} label={`Preview of ${title}`} onTime={item.vo?.words?.length ? setT : undefined} />
        {focused && item.vo?.words?.length ? (
          <div className="qcard-caption" title="Word-timed caption preview, synced to the player">
            <CaptionPreview words={item.vo.words} t={t} style={captionStyle} />
          </div>
        ) : null}
      </div>
      <div className="qcard-body">
        <div className="qcard-meta">
          <span className="brand-name">{item.brand_name}</span>
          <TierBadge tier={run.tier} />
          <span className="muted small" title={dateTime(run.created_at)}>
            {position ? `${position} · ` : ""}
            {relTime(run.created_at)}
          </span>
        </div>
        <h2 className="qcard-title">
          <Link to={`/runs/${run.id}`}>
            {title}
            <ArrowUpRight size={16} aria-hidden className="title-arrow" />
          </Link>
        </h2>
        {script?.hook && script.hook !== title && <p className="qcard-hook">“{script.hook}”</p>}
        {run.brief && <p className="qcard-brief muted small">Brief: {run.brief}</p>}

        <div className="qcard-qa">
          {qa ? (
            <>
              <ScoreRing score={qa.score} passed={qa.passed} />
              <div className="qcard-qa-text">
                <div className="small strong">{qa.passed ? "QA passed" : "QA failed"}</div>
                <CheckChips checks={qa.checks} />
              </div>
            </>
          ) : (
            <span className="muted small">No QA report</span>
          )}
        </div>

        <CostMeter cost={item.cost_total} budget={item.budget} />

        {wide && script && (
          <div className="qcard-beats">
            <div className="eyebrow">Script · {script.beats.length} beats · target {script.target_seconds}s</div>
            <ol>
              {script.beats.map((b, i) => (
                <li key={i} className={`purpose-${b.purpose}`}>
                  <span className={`purpose-tag purpose-${b.purpose}`}>{b.purpose}</span>
                  <span>{b.text}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="qcard-foot muted small">
          <PlatformStack platforms={run.platforms} />
          <span className="inline-icon">
            <CalendarClock size={14} aria-hidden />
            {run.schedule ? dateTime(run.schedule) : "Next calendar slot"}
          </span>
        </div>

        <DecisionBar ref={barRef} script={script} shots={item.shot_list?.shots} onDecide={onDecide} showShortcuts={focused} block />
      </div>
    </article>
  );
}

function QueueEmpty() {
  const { brandId } = useBrandScope();
  const runs = useAsync(() => api.runs({ brand_id: brandId || undefined, limit: 100 }).then((r) => r.items), [brandId]);
  const active = useMemo(() => (runs.data ?? []).filter((r) => ACTIVE_STATUSES.includes(r.status)), [runs.data]);
  return (
    <EmptyState
      icon={
        <div className="empty-orb">
          <Inbox size={28} />
          <Sparkles size={14} className="empty-spark" />
        </div>
      }
      title="Inbox zero"
      body={
        <>
          Nothing needs your review right now.
          {active.length > 0 && (
            <>
              {" "}
              <Link to="/runs">
                {active.length} run{active.length === 1 ? " is" : "s are"} in progress
              </Link>{" "}
              and will land here when QA finishes.
            </>
          )}
        </>
      }
      action={
        <Link className="btn btn-primary" to="/runs/new">
          <Plus size={15} /> Start a run
        </Link>
      }
    />
  );
}

function QueueRail({ items, idx, onSelect }: { items: QueueItem[]; idx: number; onSelect: (i: number) => void }) {
  return (
    <nav className="rail" aria-label="Runs awaiting review">
      <ol>
        {items.map((it, i) => {
          const ratio = it.budget > 0 ? it.cost_total / it.budget : 0;
          return (
            <li key={it.run.id}>
              <button
                className={`rail-item ${i === idx ? "active" : ""}`}
                onClick={() => onSelect(i)}
                aria-current={i === idx ? "true" : undefined}
              >
                <span className="rail-thumb" aria-hidden>
                  {it.preview_url ? <video src={`${it.preview_url}#t=1`} muted preload="metadata" tabIndex={-1} /> : null}
                </span>
                <span className="rail-main">
                  <span className="rail-title">{it.script?.title || it.run.brief || "Untitled run"}</span>
                  <span className="rail-sub">
                    {it.brand_name} · {relTime(it.run.created_at)}
                  </span>
                  <span className="rail-stats">
                    {it.qa && (
                      <span className={`tone-text-${it.qa.passed ? (it.qa.score >= 0.9 ? "success" : "warn") : "danger"}`}>
                        QA {Math.round(it.qa.score * 100)}
                      </span>
                    )}
                    <span className={ratio > 1 ? "tone-text-danger" : ""}>{money(it.cost_total)}</span>
                    <TierBadge tier={it.run.tier} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
