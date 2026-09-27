import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, Loader2 } from "lucide-react";
import { copyText } from "../hooks";
import { humanize, LANGUAGE_NAMES } from "../format";
import { KIND_META, kindColor, kindOf } from "../lib/kinds";

// ------------------------------------------------------------------ status

const STATUS_TONE: Record<string, string> = {
  queued: "neutral",
  running: "info",
  resume_requested: "info",
  awaiting_approval: "accent",
  scheduled: "teal",
  published: "success",
  failed: "danger",
  aborted: "warn",
  dead_letter: "danger",
  ok: "success",
  error: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  awaiting_approval: "needs review",
  resume_requested: "resuming",
  dead_letter: "dead letter",
};

export function statusLabel(s: string): string {
  return STATUS_LABEL[s] ?? humanize(s);
}

export function StatusPill({ status, size }: { status: string; size?: "sm" }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  const live = status === "running" || status === "resume_requested";
  return (
    <span className={`pill tone-${tone} ${size === "sm" ? "pill-sm" : ""}`}>
      <span className={`pill-dot ${live ? "pulse" : ""}`} aria-hidden />
      {statusLabel(status)}
    </span>
  );
}

export function TierBadge({ tier }: { tier: string }) {
  return <span className={`tier ${tier === "premium" ? "tier-premium" : ""}`}>{tier}</span>;
}

export function LangBadge({ code }: { code: string }) {
  return (
    <span className="lang" title={LANGUAGE_NAMES[code] ?? code}>
      {code}
    </span>
  );
}

export function KindBadge({ kind }: { kind: string }) {
  const k = kindOf(kind);
  const M = KIND_META[k];
  return (
    <span className="kind-badge" style={{ "--kc": kindColor(k) } as React.CSSProperties} title={M.hint}>
      <M.icon size={12} aria-hidden />
      {M.label}
    </span>
  );
}

export function KindIcon({ kind, size = 12 }: { kind: string; size?: number }) {
  const k = kindOf(kind);
  const M = KIND_META[k];
  return (
    <span className="wf-kind-icon" style={{ "--kc": kindColor(k) } as React.CSSProperties} aria-hidden>
      <M.icon size={size} />
    </span>
  );
}

// ------------------------------------------------------------------ feedback

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

export function EmptyState({
  icon,
  title,
  body,
  action,
  boxed = true,
}: {
  icon: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  boxed?: boolean;
}) {
  return (
    <div className={`empty ${boxed ? "boxed" : ""}`}>
      <div className="empty-orb" aria-hidden>
        {icon}
      </div>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function CopyButton({ text, label = "Copy", size = 13 }: { text: string; label?: string; size?: number }) {
  const [done, setDone] = useState(false);
  const t = useRef<number>();
  useEffect(() => () => window.clearTimeout(t.current), []);
  return (
    <button
      type="button"
      className={`icon-btn icon-btn-sm ${done ? "copied" : ""}`}
      aria-label={done ? "Copied" : label}
      title={done ? "Copied" : label}
      onClick={async (e) => {
        e.stopPropagation();
        if (await copyText(text)) {
          setDone(true);
          window.clearTimeout(t.current);
          t.current = window.setTimeout(() => setDone(false), 1400);
        }
      }}
    >
      {done ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
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

export function Tile({
  icon,
  label,
  value,
  foot,
  tone,
  children,
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  tone?: "danger";
  children?: ReactNode;
}) {
  return (
    <div className={`tile ${tone ?? ""}`}>
      <div className="tile-label">
        {icon}
        {label}
      </div>
      <div className="tile-value">{value}</div>
      {foot && <div className="tile-foot">{foot}</div>}
      {children}
    </div>
  );
}

export function Toggle({
  pressed,
  onChange,
  children,
  accent,
  title,
}: {
  pressed: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  accent?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`toggle ${accent ? "accent" : ""}`}
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      title={title}
    >
      <span className="switch" aria-hidden />
      {children}
    </button>
  );
}
