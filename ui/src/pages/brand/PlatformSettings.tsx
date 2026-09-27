import { useEffect, useMemo, useState } from "react";
import { Bot, KeyRound, Save, Send, Undo2 } from "lucide-react";
import { api } from "../../api";
import { PLATFORM_LABEL, PlatformIcon } from "../../components/icons";
import { Card, Spinner } from "../../components/ui";
import { useToast } from "../../state";
import { ALL_PLATFORMS, DISCLOSURE_REQUIRED, REQUIRED_PLATFORM_OPTIONS, type Brand, type Platform } from "../../types";

/** Per-platform account fields shown when a platform is on. Required ones mirror clipforge/platforms.py. */
const OPTION_FIELDS: Partial<Record<Platform, { key: string; label: string; placeholder: string }[]>> = {
  facebook: [{ key: "page_id", label: "Page ID", placeholder: "needed for Upload-Post" }],
  pinterest: [{ key: "board_id", label: "Board ID", placeholder: "required" }],
  reddit: [{ key: "subreddit", label: "Subreddit", placeholder: "required, without r/" }],
};

const PUBLISHERS: { id: Brand["publisher"]; label: string; hint: string }[] = [
  { id: "upload_post", label: "Upload-Post", hint: "Simple, per-account user name" },
  { id: "ayrshare", label: "Ayrshare", hint: "Agency: one Profile-Key per brand" },
];

type Options = Partial<Record<Platform, Record<string, string>>>;

interface Draft {
  platforms: Platform[];
  options: Options;
  disclosure: Partial<Record<Platform, boolean>>;
  publisher: Brand["publisher"];
}

function fromBrand(b: Brand): Draft {
  const k = b.kit;
  return {
    platforms: [...k.platforms],
    options: JSON.parse(JSON.stringify(k.platform_options ?? {})),
    disclosure: Object.fromEntries(ALL_PLATFORMS.map((p) => [p, k.disclosure.per_platform[p] ?? k.disclosure.default])),
    publisher: b.publisher,
  };
}

export function PlatformSettings({ brand, onSaved }: { brand: Brand; onSaved: (b: Brand) => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => fromBrand(brand));
  const [profileKey, setProfileKey] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(fromBrand(brand)), [brand]);

  const original = useMemo(() => JSON.stringify(fromBrand(brand)), [brand]);
  const dirty = JSON.stringify(draft) !== original || profileKey.trim() !== "";
  const hasKey = brand.credentials?.[draft.publisher] ?? false;

  const missing = (p: Platform) => (REQUIRED_PLATFORM_OPTIONS[p] ?? []).filter((o) => !draft.options[p]?.[o]?.trim());
  const blocked = draft.platforms.filter((p) => missing(p).length);

  const toggle = (p: Platform) =>
    setDraft((d) => ({
      ...d,
      platforms: d.platforms.includes(p) ? d.platforms.filter((x) => x !== p) : ALL_PLATFORMS.filter((x) => x === p || d.platforms.includes(x)),
    }));
  const setOption = (p: Platform, key: string, value: string) =>
    setDraft((d) => ({ ...d, options: { ...d.options, [p]: { ...(d.options[p] ?? {}), [key]: value } } }));

  async function save() {
    if (!draft.platforms.length) {
      toast({ tone: "warn", title: "Pick at least one platform" });
      return;
    }
    setSaving(true);
    try {
      // drop empty option values so "required" checks stay honest
      const options: Options = {};
      for (const [p, o] of Object.entries(draft.options) as [Platform, Record<string, string>][]) {
        const clean = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
        if (Object.keys(clean).length) options[p] = clean;
      }
      if (profileKey.trim()) await api.putCredential(brand.id, draft.publisher, profileKey.trim());
      const saved = await api.patchBrand(brand.id, {
        publisher: draft.publisher,
        kit: {
          platforms: draft.platforms,
          platform_options: options,
          disclosure: { default: brand.kit.disclosure.default, per_platform: draft.disclosure },
        },
      });
      setProfileKey("");
      onSaved(saved);
      toast({
        tone: saved.warnings?.length ? "warn" : "success",
        title: "Platforms saved",
        body: saved.warnings?.length ? `Will be skipped until fixed: ${saved.warnings.join("; ")}` : undefined,
      });
    } catch (e) {
      toast({ tone: "error", title: "Could not save", body: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      className="platform-settings"
      title={<span className="inline-icon"><Send size={15} aria-hidden /> Platforms & publishing</span>}
      actions={<span className="muted small tabular">{draft.platforms.length}/{ALL_PLATFORMS.length} on</span>}
    >
      <fieldset className="field">
        <legend className="field-label">Publisher</legend>
        <div className="publisher-choice" role="radiogroup" aria-label="Publisher">
          {PUBLISHERS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={draft.publisher === p.id}
              className={`publisher-option ${draft.publisher === p.id ? "on" : ""}`}
              onClick={() => setDraft((d) => ({ ...d, publisher: p.id }))}
            >
              <span className="strong">{p.label}</span>
              <span className="muted small">{p.hint}</span>
            </button>
          ))}
        </div>
        <label className="field mt-sm">
          <span className="field-label">
            <span className="inline-icon"><KeyRound size={13} aria-hidden /> {draft.publisher === "ayrshare" ? "Profile-Key" : "Upload-Post user"}</span>
            <span className={`field-hint ${hasKey ? "tone-text-success" : ""}`}>{hasKey ? "saved (hidden)" : "not set"}</span>
          </span>
          <input
            type="password"
            autoComplete="off"
            value={profileKey}
            placeholder={hasKey ? "•••••••• enter a new value to replace" : "stored encrypted, never shown again"}
            onChange={(e) => setProfileKey(e.target.value)}
          />
        </label>
      </fieldset>

      <ul className="platform-editor" aria-label="Platforms">
        {ALL_PLATFORMS.map((p) => {
          const on = draft.platforms.includes(p);
          const miss = on ? missing(p) : [];
          return (
            <li key={p} className={on ? "on" : ""}>
              <div className="platform-editor-row">
                <span className={`pf-badge pf-${p}`} aria-hidden>
                  <PlatformIcon platform={p} size={16} />
                </span>
                <span className="grow">
                  <span className="strong">{PLATFORM_LABEL[p]}</span>
                  {miss.length > 0 && <span className="small tone-text-warn"> · needs {miss.join(", ").replace(/_id\b/g, " ID")}</span>}
                </span>
                {on && (
                  <label
                    className="disclose-toggle small"
                    title={DISCLOSURE_REQUIRED.includes(p) ? "Required by this platform's policy" : "Label posts as AI-generated on this platform"}
                  >
                    <input
                      type="checkbox"
                      disabled={DISCLOSURE_REQUIRED.includes(p)}
                      checked={DISCLOSURE_REQUIRED.includes(p) || (draft.disclosure[p] ?? true)}
                      onChange={(e) => setDraft((d) => ({ ...d, disclosure: { ...d.disclosure, [p]: e.target.checked } }))}
                    />
                    <Bot size={13} aria-hidden /> AI label{DISCLOSURE_REQUIRED.includes(p) ? " (required)" : ""}
                  </label>
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${PLATFORM_LABEL[p]} ${on ? "on" : "off"}`}
                  className={`switch ${on ? "on" : ""}`}
                  onClick={() => toggle(p)}
                >
                  <span />
                </button>
              </div>
              {on && OPTION_FIELDS[p] && (
                <div className="platform-editor-options">
                  {OPTION_FIELDS[p]!.map((f) => (
                    <label key={f.key} className="field">
                      <span className="field-label">{f.label}</span>
                      <input
                        value={draft.options[p]?.[f.key] ?? ""}
                        placeholder={f.placeholder}
                        onChange={(e) => setOption(p, f.key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="muted small">
        Platforms are posted through {draft.publisher === "ayrshare" ? "Ayrshare" : "Upload-Post"}; connect each social account there first.
        {blocked.length > 0 && <span className="tone-text-warn"> {blocked.map((p) => PLATFORM_LABEL[p]).join(", ")} will be skipped until the missing fields are filled.</span>}
      </p>
      <div className="form-actions">
        <button className="btn btn-ghost" disabled={!dirty || saving} onClick={() => { setDraft(fromBrand(brand)); setProfileKey(""); }}>
          <Undo2 size={15} /> Reset
        </button>
        <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? <Spinner size={14} /> : <Save size={15} />} Save
        </button>
      </div>
    </Card>
  );
}
