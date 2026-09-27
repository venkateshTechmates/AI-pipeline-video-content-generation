import { forwardRef, useImperativeHandle, useState } from "react";
import { api } from "../api";
import { REGENERATABLE, type ApprovalDecision, type RegenStage, type Script } from "../types";
import { ScriptEditor } from "./ScriptEditor";
import { ErrorBox } from "./ui";

export interface DecisionBarHandle {
  approve: () => void;
  regenerate: () => void;
  edit: () => void;
  reject: () => void;
}

interface Props {
  runId: string;
  script: Script | null;
  /** Called after the backend accepted a decision. */
  onDone?: (decision: ApprovalDecision, status: string) => void;
  showShortcuts?: boolean;
  disabled?: boolean;
}

/** Approve / Regenerate(stage) / Edit script / Reject(note) controls for one run. */
export const DecisionBar = forwardRef<DecisionBarHandle, Props>(function DecisionBar(
  { runId, script, onDone, showShortcuts, disabled },
  ref,
) {
  const [stage, setStage] = useState<RegenStage>("gen_shots");
  const [mode, setMode] = useState<"idle" | "edit" | "reject">("idle");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<string | null>(null);

  const send = async (d: ApprovalDecision) => {
    if (busy || disabled) return;
    if (d.decision === "reject" && !window.confirm("Reject this run? It will not be published.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.decide(runId, d);
      setResult(`${d.decision}${d.stage ? ` → ${d.stage}` : ""}: ${res.status}`);
      setMode("idle");
      setNote("");
      onDone?.(d, res.status);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const approve = () => void send({ decision: "approve" });
  const regenerate = () => void send({ decision: "regenerate", stage });
  const edit = () => {
    if (script) setMode("edit");
  };
  const reject = () => setMode("reject");

  useImperativeHandle(ref, () => ({ approve, regenerate, edit, reject }));

  const k = (key: string) => (showShortcuts ? <kbd>{key}</kbd> : null);
  const off = busy || disabled;

  return (
    <div className="decision-bar">
      <div className="decision-buttons">
        <button className="btn btn-approve" onClick={approve} disabled={off}>
          Approve {k("A")}
        </button>
        <div className="btn-group">
          <select
            aria-label="Stage to regenerate"
            value={stage}
            onChange={(e) => setStage(e.target.value as RegenStage)}
            onKeyDown={(e) => e.stopPropagation()}
            disabled={off}
          >
            {REGENERATABLE.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className="btn btn-regen" onClick={regenerate} disabled={off}>
            Regenerate {k("R")}
          </button>
        </div>
        <button
          className="btn"
          onClick={edit}
          disabled={off || !script}
          title={script ? "Edit script" : "No script available"}
        >
          Edit script {k("E")}
        </button>
        <button className="btn btn-reject" onClick={reject} disabled={off}>
          Reject
        </button>
      </div>

      {mode === "reject" && (
        <form
          className="reject-form row gap"
          onSubmit={(e) => {
            e.preventDefault();
            void send({ decision: "reject", note: note.trim() || undefined });
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setMode("idle");
            e.stopPropagation();
          }}
        >
          <input
            autoFocus
            placeholder="Reason for rejection (note)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="submit" className="btn btn-reject" disabled={off}>
            Confirm reject
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setMode("idle")}>
            Cancel
          </button>
        </form>
      )}

      {mode === "edit" && script && (
        <ScriptEditor
          script={script}
          busy={busy}
          onCancel={() => setMode("idle")}
          onSubmit={(patch, n) => void send({ decision: "edit", patch, note: n.trim() || undefined })}
        />
      )}

      <ErrorBox error={error} />
      {result && !error && <div className="ok-box small">Sent — {result}</div>}
    </div>
  );
});
