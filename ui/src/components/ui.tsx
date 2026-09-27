import { useEffect, useId, useRef, type ReactNode } from "react";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { humanize, money, pct } from "../format";
import type { Platform, QACheck } from "../types";
import { PLATFORM_LABEL, PlatformIcon } from "./icons";

// ------------------------------------------------------------------ status

const STATUS_TONE: Record<string, string> = {
  queued: "neutral",
  pending: "neutral",
  running: "info",
  resume_requested: "info",
  awaiting_provider: "info",
  awaiting_approval: "attention",
  scheduled: "teal",
  published: "success",
  succeeded: "success",
  skipped: "neutral",
  failed: "danger",
  aborted: "warn",
  dead_letter: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  awaiting_approval: "needs review",
  resume_requested: "resuming",
  awaiting_provider: "waiting on provider",
  dead_letter: "dead letter",
};

export function statusTone(status: string): string {
  return STATUS_TONE[status] ?? "neutral";
}

export function StatusPill({ status, size }: { status: string; size?: "sm" }) {
  const tone = statusTone(status);
  const live = ["running", "resume_requested", "awaiting_provider"].includes(status);
  return (
    <span className={`pill tone-${tone} ${size === "sm" ? "pill-sm" : ""}`}>
      <span className={`pill-dot ${live ? "pulse" : ""}`} aria-hidden />
      {STATUS_LABEL[status] ?? humanize(status)}
    </span>
  );
}

// ------------------------------------------------------------------ QA ring

export function ScoreRing({
  score,
  passed,
  size = 56,
  label = "QA",
}: {
  score: number;
  passed: boolean;
  size?: number;
  label?: string;
}) {
  const stroke = size >= 56 ? 5 : 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = !passed ? "danger" : score >= 0.9 ? "success" : "warn";
  return (
    <div
      className={`ring tone-${tone}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label} score ${pct(score)}, ${passed ? "passed" : "failed"}`}
      title={passed ? "All required QA checks passed" : "A required QA check failed"}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="ring-value"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(1, score)))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-label">
        <strong>{Math.round(score * 100)}</strong>
        {size >= 56 && <span>{label}</span>}
      </div>
    </div>
  );
}

export function CheckChips({ checks, max = 4 }: { checks: QACheck[]; max?: number }) {
  const failed = checks.filter((c) => !c.passed);
  if (!failed.length)
    return (
      <div className="chips">
        <span className="chip tone-success">
          <Check size={12} aria-hidden /> {checks.length} checks passed
        </span>
      </div>
    );
  return (
    <div className="chips">
      {failed.slice(0, max).map((c) => (
        <span
          key={c.name}
          className={`chip ${c.weight >= 1 ? "tone-danger" : "tone-warn"}`}
          title={`${c.weight >= 1 ? "Required" : "Soft"} check failed${c.detail ? ` — ${c.detail}` : ""}`}
        >
          {c.weight >= 1 ? <X size={12} aria-hidden /> : <AlertTriangle size={12} aria-hidden />}
          {humanize(c.name)}
        </span>
      ))}
      {failed.length > max && <span className="chip">+{failed.length - max}</span>}
    </div>
  );
}

// ------------------------------------------------------------------ cost

export function CostMeter({ cost, budget, compact }: { cost: number; budget: number; compact?: boolean }) {
  const ratio = budget > 0 ? cost / budget : 0;
  const tone = ratio > 1 ? "danger" : ratio > 0.8 ? "warn" : "success";
  return (
    <div className={`meter ${compact ? "meter-compact" : ""}`}>
      <div className="meter-head">
        <span className="meter-value">
          <strong className="tabular">{money(cost)}</strong>
          <span className="muted"> / {money(budget)}</span>
        </span>
        <span className={`meter-pct tone-text-${tone}`}>
          {ratio > 1 && <AlertTriangle size={12} aria-hidden />}
          {pct(ratio)}
          {ratio > 1 ? " · over" : ""}
        </span>
      </div>
      <div
        className="meter-track"
        role="meter"
        aria-label="Cost versus budget"
        aria-valuemin={0}
        aria-valuemax={budget}
        aria-valuenow={cost}
        aria-valuetext={`${money(cost)} of ${money(budget)}`}
      >
        <div className={`meter-fill tone-bg-${tone}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
    </div>
  );
}

export function Progress({ value, max, tone = "accent" }: { value: number; max: number; tone?: string }) {
  const r = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="meter-track" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className={`meter-fill tone-bg-${tone}`} style={{ width: `${r * 100}%` }} />
    </div>
  );
}

// ------------------------------------------------------------------ video

export function PhoneFrame({
  src,
  poster,
  children,
  label,
  autoPlay,
  videoRef,
  onTime,
  tracks = [],
}: {
  src: string | null | undefined;
  poster?: string;
  children?: ReactNode;
  label?: string;
  autoPlay?: boolean;
  videoRef?: React.Ref<HTMLVideoElement>;
  onTime?: (t: number) => void;
  tracks?: VideoTrack[];
}) {
  return (
    <div className="phone">
      <div className="phone-screen">
        {src ? (
          <video
            ref={videoRef}
            src={src}
            poster={poster}
            controls
            playsInline
            muted={autoPlay}
            autoPlay={autoPlay}
            loop={autoPlay}
            preload="metadata"
            aria-label={label ?? "9:16 preview"}
            crossOrigin={tracks.length ? "anonymous" : undefined}
            onTimeUpdate={onTime ? (e) => onTime(e.currentTarget.currentTime) : undefined}
          >
            {tracks.map((tr) => (
              <track key={tr.lang} kind="subtitles" src={tr.src} srcLang={tr.lang} label={tr.label} />
            ))}
          </video>
        ) : (
          <div className="video-empty">
            <span>No 9:16 render yet</span>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** A subtitle track for <video> (WebVTT). */
export interface VideoTrack {
  lang: string;
  label: string;
  src: string;
}

export function VideoBox({
  src,
  aspect,
  label,
  tracks = [],
}: {
  src: string | null | undefined;
  aspect: string;
  label?: string;
  tracks?: VideoTrack[];
}) {
  return (
    <div className={`video-box ar-${aspect.replace(":", "x")}`}>
      {src ? (
        <video
          src={src}
          controls
          playsInline
          preload="metadata"
          aria-label={label ?? `${aspect} render`}
          crossOrigin={tracks.length ? "anonymous" : undefined}
        >
          {tracks.map((tr) => (
            <track key={tr.lang} kind="subtitles" src={tr.src} srcLang={tr.lang} label={tr.label} />
          ))}
        </video>
      ) : (
        <div className="video-empty">No {aspect} render</div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ layout bits

export function Card({
  title,
  children,
  actions,
  className = "",
  pad = true,
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={pad ? "card-body" : ""}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  crumbs,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  crumbs?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-main">
        {crumbs && <div className="crumbs">{crumbs}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="alert tone-danger" role="alert">
      <AlertTriangle size={16} aria-hidden />
      <span>{msg}</span>
      {onRetry && (
        <button className="btn btn-sm btn-ghost" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <Loader2 size={size} className="spin" aria-hidden />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function Skeleton({ h = 16, w = "100%", r }: { h?: number | string; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function PlatformChip({ platform, withLabel }: { platform: Platform; withLabel?: boolean }) {
  return (
    <span className={`platform-chip pf-${platform}`} title={PLATFORM_LABEL[platform]}>
      <PlatformIcon platform={platform} size={14} />
      {withLabel ? <span>{PLATFORM_LABEL[platform]}</span> : <span className="sr-only">{PLATFORM_LABEL[platform]}</span>}
    </span>
  );
}

export function PlatformStack({ platforms }: { platforms: Platform[] }) {
  return (
    <span className="platform-stack">
      {platforms.map((p) => (
        <PlatformChip key={p} platform={p} />
      ))}
    </span>
  );
}

export function TierBadge({ tier }: { tier: string }) {
  return <span className={`tier tier-${tier}`}>{tier}</span>;
}

// ------------------------------------------------------------------ tabs

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: { id: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (t: T) => void;
  label: string;
}) {
  const id = useId();
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[n].id);
    document.getElementById(`${id}-${tabs[n].id}`)?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          id={`${id}-${t.id}`}
          role="tab"
          aria-selected={value === t.id}
          tabIndex={value === t.id ? 0 : -1}
          className={`tab ${value === t.id ? "active" : ""}`}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          className={value === o.id ? "active" : ""}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ modal

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // showModal focuses the first focusable (the close button); prefer the first field.
      d.querySelector<HTMLElement>(".modal-body input, .modal-body textarea, .modal-body select")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {open && (
        <div className="modal-inner">
          <header className="modal-head">
            <h2>{title}</h2>
            <button className="icon-btn" aria-label="Close" onClick={onClose}>
              <X size={18} />
            </button>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function StatTile({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="stat">
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className={`stat-value tabular ${tone ? `tone-text-${tone}` : ""}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
