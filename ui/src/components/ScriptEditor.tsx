import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { BEAT_PURPOSES, type Beat, type BeatPurpose, type Script, type ScriptPatch, type Shot } from "../types";
import { Spinner } from "./ui";

interface Props {
  script: Script;
  shots?: Shot[];
  busy?: boolean;
  onSubmit: (patch: ScriptPatch, note: string) => void;
  onCancel: () => void;
}

type Editable = Pick<Script, "title" | "hook" | "vo_text" | "caption_text" | "cta" | "beats">;

/** Edit title/hook/vo_text/caption_text/cta/beats and the shot prompts; submits only changed fields. */
export function ScriptEditor({ script, shots = [], busy, onSubmit, onCancel }: Props) {
  const initialShots = shots.map((s) => ({ prompt: s.prompt, duration: s.duration }));
  const [shotDraft, setShotDraft] = useState(initialShots);
  const [draft, setDraft] = useState<Editable>({
    title: script.title,
    hook: script.hook,
    vo_text: script.vo_text,
    caption_text: script.caption_text,
    cta: script.cta,
    beats: script.beats.map((b) => ({ ...b })),
  });
  const [note, setNote] = useState("");

  const set = <K extends keyof Editable>(k: K, v: Editable[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setBeat = (i: number, b: Partial<Beat>) =>
    set(
      "beats",
      draft.beats.map((x, j) => (j === i ? { ...x, ...b } : x)),
    );

  const patch: ScriptPatch = {};
  (["title", "hook", "vo_text", "caption_text", "cta"] as const).forEach((k) => {
    if (draft[k] !== script[k]) patch[k] = draft[k];
  });
  if (JSON.stringify(draft.beats) !== JSON.stringify(script.beats)) patch.beats = draft.beats;
  if (JSON.stringify(shotDraft) !== JSON.stringify(initialShots)) patch.shots = shotDraft;
  const shotsValid = !shots.length || (shotDraft.length >= 3 && shotDraft.length <= 6 && shotDraft.every((s) => s.prompt.trim()));
  const changed = Object.keys(patch);
  const words = draft.vo_text.trim().split(/\s+/).filter(Boolean).length;
  // ~2.6 spoken words per second is a typical short-form VO pace.
  const estSeconds = Math.round(words / 2.6);

  return (
    <form
      className="form script-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (changed.length && draft.beats.length > 0 && shotsValid) onSubmit(patch, note);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        e.stopPropagation(); // don't trigger page shortcuts while typing
      }}
    >
      <div className="grid-2">
        <label className="field">
          <span className="field-label">Title</span>
          <input value={draft.title} onChange={(e) => set("title", e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span className="field-label">Call to action</span>
          <input value={draft.cta} onChange={(e) => set("cta", e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Hook</span>
        <input value={draft.hook} onChange={(e) => set("hook", e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">
          Voice-over
          <span className={`field-hint ${Math.abs(estSeconds - script.target_seconds) > 8 ? "tone-text-warn" : ""}`}>
            {words} words · ≈{estSeconds}s (target {script.target_seconds}s)
          </span>
        </span>
        <textarea rows={5} value={draft.vo_text} onChange={(e) => set("vo_text", e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Caption text</span>
        <textarea rows={2} value={draft.caption_text} onChange={(e) => set("caption_text", e.target.value)} />
      </label>

      <fieldset className="field">
        <legend className="field-label">Beats</legend>
        <div className="beats-edit">
          {draft.beats.map((b, i) => (
            <div className="beat-row" key={i}>
              <select
                aria-label={`Beat ${i + 1} purpose`}
                value={b.purpose}
                className={`beat-select purpose-${b.purpose}`}
                onChange={(e) => setBeat(i, { purpose: e.target.value as BeatPurpose })}
              >
                {BEAT_PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <input aria-label={`Beat ${i + 1} text`} value={b.text} onChange={(e) => setBeat(i, { text: e.target.value })} />
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove beat ${i + 1}`}
                disabled={draft.beats.length <= 1}
                onClick={() =>
                  set(
                    "beats",
                    draft.beats.filter((_, j) => j !== i),
                  )
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => set("beats", [...draft.beats, { text: "", purpose: "value" }])}
          >
            <Plus size={14} /> Add beat
          </button>
        </div>
      </fieldset>

      {shots.length > 0 && (
        <fieldset className="field">
          <legend className="field-label">
            Shots
            <span className={`field-hint ${shotsValid ? "" : "tone-text-warn"}`}>
              {shotDraft.length} of 3–6 · each prompt becomes one generated scene
            </span>
          </legend>
          <div className="beats-edit">
            {shotDraft.map((s, i) => (
              <div className="shot-row" key={i}>
                <span className="shot-num tabular" aria-hidden>
                  #{i + 1}
                </span>
                <textarea
                  rows={2}
                  aria-label={`Shot ${i + 1} prompt`}
                  value={s.prompt}
                  placeholder="Subject, action, setting, camera, lighting…"
                  onChange={(e) => setShotDraft((d) => d.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)))}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove shot ${i + 1}`}
                  disabled={shotDraft.length <= 3}
                  onClick={() => setShotDraft((d) => d.filter((_, j) => j !== i))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={shotDraft.length >= 6}
              onClick={() => setShotDraft((d) => [...d, { prompt: "", duration: d[d.length - 1]?.duration ?? 6 }])}
            >
              <Plus size={14} /> Add shot
            </button>
          </div>
        </fieldset>
      )}

      <label className="field">
        <span className="field-label">Note for the log (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why the edit?" />
      </label>

      <div className="form-actions">
        <span className="muted small grow">
          {changed.length ? `Changed: ${changed.join(", ")}` : "No changes yet"} · re-renders from TTS
          {patch.shots ? " · changed shots are generated (and billed) again" : ""}
        </span>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!changed.length || !shotsValid || busy}>
          {busy && <Spinner size={15} />} Send edit
        </button>
      </div>
    </form>
  );
}
