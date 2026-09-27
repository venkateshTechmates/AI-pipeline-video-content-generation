import { useEffect, useState } from "react";
import { Languages, Save } from "lucide-react";
import { api } from "../../api";
import { LanguagePicker } from "../../components/LanguagePicker";
import { Card, Spinner } from "../../components/ui";
import { useToast } from "../../state";
import type { Brand } from "../../types";

/** Brand default narration language and subtitle languages (new runs inherit them; runs can override). */
export function LanguageSettings({ brand, onSaved }: { brand: Brand; onSaved: (b: Brand) => void }) {
  const toast = useToast();
  const initial = { language: brand.kit.language ?? "en", subtitles: brand.kit.subtitle_languages ?? [] };
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft({ language: brand.kit.language ?? "en", subtitles: brand.kit.subtitle_languages ?? [] }), [brand]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  async function save() {
    setSaving(true);
    try {
      const saved = await api.patchBrand(brand.id, {
        kit: { language: draft.language, subtitle_languages: draft.subtitles },
      });
      onSaved(saved);
      toast({ tone: "success", title: "Language settings saved" });
    } catch (e) {
      toast({ tone: "error", title: "Could not save", body: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title={<span className="inline-icon"><Languages size={15} aria-hidden /> Language & subtitles</span>}>
      <LanguagePicker
        language={draft.language}
        subtitles={draft.subtitles}
        onChange={(language, subtitles) => setDraft({ language, subtitles })}
      />
      <p className="muted small">
        New runs use these defaults; each run can override them on the New run page. Voice comes from the brand voice (or a
        per-language voice); captions switch to a font that covers the script.
      </p>
      <div className="form-actions">
        <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? <Spinner size={14} /> : <Save size={15} />} Save
        </button>
      </div>
    </Card>
  );
}
