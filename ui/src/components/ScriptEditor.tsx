import { useState } from "react";
import { BEAT_PURPOSES, type Beat, type BeatPurpose, type Script } from "../types";

interface Props {
  script: Script;
  busy?: boolean;
  onSubmit: (patch: Partial<Script>, note: string) => void;
  onCancel: () => void;
}

type Editable = Pick<Script, "title" | "hook" | "vo_text" | "caption_text" | "cta" | "beats">;

/** Edit title/hook/vo_text/caption_text/cta/beats; submits only changed fields as the patch. */
export function ScriptEditor({ script, busy, onSubmit, onCancel }: Props) {
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

  const patch: Partial<Script> = {};
  (["title", "hook", "vo_text", "caption_text", "cta"] as const).forEach((k) => {
    if (draft[k] !== script[k]) patch[k] = draft[k];
  });
  if (JSON.stringify(draft.beats) !== JSON.stringify(script.beats)) patch.beats = draft.beats;
  const changed = Object.keys(patch).length > 0;
  const words = draft.vo_text.trim().split(/\s+/).filter(Boolean).length;

  return (
    <form
      className="script-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (changed && draft.beats.length > 0) onSubmit(patch, note);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        e.stopPropagation(); // don't trigger card shortcuts while typing
      }}
    >
      <div className="grid-2">
        <label>
          Title
          <input value={draft.title} onChange={(e) => set("title", e.target.value)} autoFocus />
        </label>
        <label>
          CTA
          <input value={draft.cta} onChange={(e) => set("cta", e.target.value)} />
        </label>
      </div>
      <label>
        Hook
        <input value={draft.hook} onChange={(e) => set("hook", e.target.value)} />
      </label>
      <label>
        VO text <span className="muted small">({words} words · target {script.target_seconds}s)</span>
        <textarea rows={5} value={draft.vo_text} onChange={(e) => set("vo_text", e.target.value)} />
      </label>
      <label>
        Caption text
        <textarea rows={2} value={draft.caption_text} onChange={(e) => set("caption_text", e.target.value)} />
      </label>

      <fieldset className="beats-edit">
        <legend>Beats</legend>
        {draft.beats.map((b, i) => (
          <div className="beat-row" key={i}>
            <select value={b.purpose} onChange={(e) => setBeat(i, { purpose: e.target.value as BeatPurpose })}>
              {BEAT_PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input value={b.text} onChange={(e) => setBeat(i, { text: e.target.value })} />
            <button
              type="button"
              className="btn btn-ghost"
              title="Remove beat"
              disabled={draft.beats.length <= 1}
              onClick={() =>
                set(
                  "beats",
                  draft.beats.filter((_, j) => j !== i),
                )
              }
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => set("beats", [...draft.beats, { text: "", purpose: "value" }])}
        >
          + Add beat
        </button>
      </fieldset>

      <label>
        Note (optional)
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why the edit?" />
      </label>

      <div className="row gap">
        <button type="submit" className="btn btn-primary" disabled={!changed || busy}>
          {busy ? "Sending…" : `Send edit${changed ? ` (${Object.keys(patch).join(", ")})` : ""}`}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
