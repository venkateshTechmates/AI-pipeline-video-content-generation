import { AlertOctagon, ArrowUpLeft, Braces, MousePointerClick, X } from "lucide-react";
import { dur, fmtAttr, fullDateTime, money, timeOnly } from "../format";
import { ms, spanCost, spanProvider, subtreeCost, type TSpan } from "../lib/timeline";
import { CopyButton, KindBadge, KindIcon, Kbd, StatusPill } from "./ui";

const EVENT_TONE: Record<string, string> = {
  retry: "warn",
  fallback: "warn",
  cache_hit: "success",
  budget_check: "info",
  cost: "teal",
  paused: "accent",
  error: "danger",
  exception: "danger",
};

interface Props {
  span: TSpan | null;
  traceStart: number;
  onSelect: (id: string) => void;
  onClose: () => void;
  overlay: boolean;
}

export function SpanPanel({ span: s, traceStart, onSelect, onClose, overlay }: Props) {
  if (!s)
    return (
      <div className="sp-placeholder">
        <MousePointerClick size={26} aria-hidden />
        <div>
          <div className="strong" style={{ color: "var(--text)" }}>
            Select a span
          </div>
          <p className="small" style={{ marginTop: 4 }}>
            Click a row, or use <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to move and <Kbd>←</Kbd>
            <Kbd>→</Kbd> to collapse / expand.
          </p>
        </div>
      </div>
    );

  const cost = spanCost(s);
  const treeCost = s.children.length ? subtreeCost(s) : null;
  const provider = spanProvider(s);
  const model = s.attributes.model;
  const attrs = Object.entries(s.attributes ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const d = s.duration_ms ?? s.t1 - s.t0;

  return (
    <>
      <div className="sp-head">
        <div className="sp-title">
          <div className="row wrap" style={{ gap: 6 }}>
            <KindBadge kind={s.kind} />
            <StatusPill status={s.open ? "running" : s.status} size="sm" />
          </div>
          <h2 id="span-panel-title">{s.name}</h2>
        </div>
        <CopyButton text={JSON.stringify(stripTree(s), null, 2)} label="Copy span as JSON" />
        {overlay && (
          <button type="button" className="icon-btn" aria-label="Close span details" onClick={onClose}>
            <X size={17} />
          </button>
        )}
      </div>

      <div className="sp-section">
        <div className="sp-stats">
          <Stat k="Duration" v={s.open ? `${dur(d)} · running` : dur(d, { precise: true })} />
          <Stat k="Starts at" v={`+${dur(s.t0 - traceStart, { precise: true })}`} title={fullDateTime(s.start_at)} />
          {cost !== null ? (
            <Stat k="Cost" v={money(cost)} />
          ) : treeCost ? (
            <Stat k="Cost (children)" v={money(treeCost)} />
          ) : (
            <Stat k="Cost" v="—" />
          )}
          <Stat k={provider ? "Provider" : "Children"} v={provider ?? String(s.children.length)} mono={!!provider} />
          {model !== undefined && model !== null && <Stat k="Model" v={String(model)} mono />}
          {s.attributes.attempt !== undefined && <Stat k="Attempt" v={String(s.attributes.attempt)} />}
          <Stat k="Start" v={timeOnly(s.start_at, true)} title={fullDateTime(s.start_at)} />
          <Stat k="End" v={s.end_at ? timeOnly(s.end_at, true) : "—"} title={s.end_at ? fullDateTime(s.end_at) : "still open"} />
        </div>
        {s.parent && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10, paddingLeft: 6 }} onClick={() => onSelect(s.parent!.id)}>
            <ArrowUpLeft size={14} aria-hidden /> Parent: <span className="mono">{s.parent.name}</span>
          </button>
        )}
      </div>

      {s.error && (
        <div className="sp-section">
          <div className="sp-error" role="alert">
            <div className="sp-error-head">
              <AlertOctagon size={15} aria-hidden />
              <span className="grow">Error</span>
              <CopyButton text={s.error} label="Copy error" />
            </div>
            <pre>{s.error}</pre>
          </div>
        </div>
      )}

      <div className="sp-section">
        <div className="sp-section-head">
          <h3 className="eyebrow">Attributes · {attrs.length}</h3>
          <CopyButton text={JSON.stringify(s.attributes, null, 2)} label="Copy attributes as JSON" />
        </div>
        {attrs.length ? (
          <table className="kv">
            <tbody>
              {attrs.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td>
                    <AttrVal v={v} />
                  </td>
                  <td className="act">
                    <CopyButton text={fmtAttr(v)} label={`Copy ${k}`} size={12} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="small faint">No attributes.</p>
        )}
      </div>

      <div className="sp-section">
        <div className="sp-section-head">
          <h3 className="eyebrow">Events · {s.events.length}</h3>
        </div>
        {s.events.length ? (
          <ol className="events">
            {s.events.map((e, i) => {
              const t = ms(e.at);
              const attrs = Object.entries(e.attributes ?? {});
              return (
                <li key={i}>
                  <span className={`ev-dot tone-${EVENT_TONE[e.name] ?? "neutral"}`} aria-hidden />
                  <div className="ev-head">
                    <span className="ev-name">{e.name}</span>
                    <span className="ev-time" title={fullDateTime(e.at)}>
                      +{dur(t - s.t0, { precise: true })}
                    </span>
                  </div>
                  {attrs.length > 0 && (
                    <div className="ev-attrs">
                      {attrs.map(([k, v]) => (
                        <span key={k} className="ev-attr" title={`${k}: ${fmtAttr(v)}`}>
                          <b>{k}</b> {k === "usd" || k.endsWith("_usd") ? money(Number(v)) : fmtAttr(v)}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="small faint">No events recorded.</p>
        )}
      </div>

      {s.children.length > 0 && (
        <div className="sp-section">
          <div className="sp-section-head">
            <h3 className="eyebrow">Children · {s.children.length}</h3>
          </div>
          <ul className="sp-children">
            {s.children.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onSelect(c.id)}>
                  <KindIcon kind={c.kind} size={11} />
                  <span className={`ellipsis ${c.status === "error" ? "tone-text-danger" : ""}`}>{c.name}</span>
                  <span className="d">{c.open ? "running" : dur(c.duration_ms ?? c.t1 - c.t0)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="sp-section">
        <div className="sp-section-head">
          <h3 className="eyebrow">
            <Braces size={11} aria-hidden style={{ verticalAlign: -1 }} /> Identifiers
          </h3>
        </div>
        <table className="kv">
          <tbody>
            {[
              ["span_id", s.id],
              ["parent_id", s.parent_id],
              ["trace_id", s.trace_id],
            ].map(([k, v]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td>{v ? v : <span className="v-null">null</span>}</td>
                <td className="act">{v && <CopyButton text={v} label={`Copy ${k}`} size={12} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat({ k, v, title, mono }: { k: string; v: string; title?: string; mono?: boolean }) {
  return (
    <div className="sp-stat" title={title ?? v}>
      <div className="k">{k}</div>
      <div className={`v ${mono ? "mono" : ""}`}>{v}</div>
    </div>
  );
}

function AttrVal({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="v-null">null</span>;
  if (typeof v === "number") return <span className="v-num">{fmtAttr(v)}</span>;
  if (typeof v === "boolean") return <span className="v-bool">{String(v)}</span>;
  if (v === "") return <span className="v-null">""</span>;
  return <>{fmtAttr(v)}</>;
}

function stripTree(s: TSpan) {
  return {
    id: s.id,
    trace_id: s.trace_id,
    parent_id: s.parent_id,
    name: s.name,
    kind: s.kind,
    status: s.status,
    start_at: s.start_at,
    end_at: s.end_at,
    duration_ms: s.duration_ms,
    attributes: s.attributes,
    events: s.events,
    error: s.error,
  };
}
