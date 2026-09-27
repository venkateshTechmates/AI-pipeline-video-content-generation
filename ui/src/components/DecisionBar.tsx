import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Ban, Check, ChevronDown, Pencil, RefreshCw } from "lucide-react";
import { REGENERATABLE, type ApprovalDecision, type RegenStage, type Script, type Shot } from "../types";
import { STAGE_META } from "./icons";
import { ScriptEditor } from "./ScriptEditor";
import { Kbd, Modal, Spinner } from "./ui";

export interface DecisionBarHandle {
  approve: () => void;
  regenerate: () => void;
  edit: () => void;
  reject: () => void;
}

interface Props {
  script: Script | null;
  shots?: Shot[];
  /** Performs the decision; rejects to keep the bar interactive. */
  onDecide: (d: ApprovalDecision) => Promise<void>;
  showShortcuts?: boolean;
  disabled?: boolean;
  /** Stretch buttons to fill (card layout). */
  block?: boolean;
}

/** Approve / Regenerate (stage menu) / Edit script / Reject (note) for one run. */
export const DecisionBar = forwardRef<DecisionBarHandle, Props>(function DecisionBar(
  { script, shots, onDecide, showShortcuts, disabled, block },
  ref,
) {
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState<"edit" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const send = async (d: ApprovalDecision) => {
    if (busy || disabled) return;
    setBusy(d.decision);
    try {
      await onDecide(d);
      setModal(null);
      setMenu(false);
      setNote("");
    } catch {
      /* parent reports the error */
    } finally {
      setBusy(null);
    }
  };

  const approve = () => void send({ decision: "approve" });
  const regen = (stage: RegenStage) => void send({ decision: "regenerate", stage });
  const edit = () => script && !disabled && setModal("edit");
  const reject = () => !disabled && setModal("reject");

  useImperativeHandle(ref, () => ({ approve, regenerate: () => !disabled && setMenu((m) => !m), edit, reject }));

  // Focus the first item when the menu opens; close on outside click.
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.parentElement?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      setMenu(false);
      e.preventDefault();
    } else if (e.key === "ArrowDown" || e.key === "j") {
      items[(i + 1) % items.length]?.focus();
      e.preventDefault();
    } else if (e.key === "ArrowUp" || e.key === "k") {
      items[(i - 1 + items.length) % items.length]?.focus();
      e.preventDefault();
    } else if (/^[1-6]$/.test(e.key)) {
      regen(REGENERATABLE[Number(e.key) - 1]);
      e.preventDefault();
    }
  };

  const k = (key: string) => (showShortcuts ? <Kbd>{key}</Kbd> : null);
  const off = !!busy || disabled;

  return (
    <div className={`decision ${block ? "decision-block" : ""}`}>
      <button className="btn btn-primary btn-approve" onClick={approve} disabled={off}>
        {busy === "approve" ? <Spinner size={15} /> : <Check size={15} aria-hidden />}
        Approve {k("A")}
      </button>
      <div className="menu-wrap">
        <button
          className="btn"
          onClick={() => setMenu((m) => !m)}
          disabled={off}
          aria-haspopup="menu"
          aria-expanded={menu}
        >
          {busy === "regenerate" ? <Spinner size={15} /> : <RefreshCw size={15} aria-hidden />}
          Regenerate {k("R")}
          <ChevronDown size={14} aria-hidden className="chev" />
        </button>
        {menu && (
          <div className="menu" role="menu" ref={menuRef} onKeyDown={onMenuKey} aria-label="Stage to regenerate from">
            <div className="menu-label">Regenerate from stage</div>
            {REGENERATABLE.map((s, i) => {
              const m = STAGE_META[s];
              const Icon = m.icon;
              return (
                <button key={s} role="menuitem" className="menu-item" onClick={() => regen(s)}>
                  <Icon size={15} aria-hidden />
                  <span className="menu-item-main">
                    <span>{m.label}</span>
                    <span className="menu-hint">{m.hint}</span>
                  </span>
                  <Kbd>{i + 1}</Kbd>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <button className="btn" onClick={edit} disabled={off || !script} title={script ? "Edit script" : "No script"}>
        <Pencil size={15} aria-hidden />
        Edit {k("E")}
      </button>
      <button className="btn btn-danger-ghost" onClick={reject} disabled={off}>
        <Ban size={15} aria-hidden />
        Reject {k("X")}
      </button>

      <Modal open={modal === "reject"} onClose={() => setModal(null)} title="Reject this run?">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void send({ decision: "reject", note: note.trim() || undefined });
          }}
        >
          <p className="muted">The run will not be published. A note helps tune future ideas and scripts.</p>
          <label className="field">
            <span className="field-label">Reason (optional)</span>
            <textarea
              rows={3}
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Off-brand tone, hook repeats last week's post…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send({ decision: "reject", note: note.trim() || undefined });
                }
              }}
            />
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-danger" disabled={!!busy}>
              {busy === "reject" ? <Spinner size={15} /> : <Ban size={15} aria-hidden />} Reject run
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={modal === "edit"} onClose={() => setModal(null)} title="Edit script" wide>
        {script && (
          <ScriptEditor
            script={script}
            shots={shots}
            busy={busy === "edit"}
            onCancel={() => setModal(null)}
            onSubmit={(patch, n) => void send({ decision: "edit", patch, note: n.trim() || undefined })}
          />
        )}
      </Modal>
    </div>
  );
});
