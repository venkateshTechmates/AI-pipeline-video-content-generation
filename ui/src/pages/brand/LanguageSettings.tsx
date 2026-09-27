import { useEffect, useState } from "react";
import { Languages, LocateFixed, MapPin, Save } from "lucide-react";
import { api } from "../../api";
import { LanguagePicker, RegionSelect, languageLabel, useLanguages } from "../../components/LanguagePicker";
import { Card, Spinner } from "../../components/ui";
import { useToast } from "../../state";
import type { Brand } from "../../types";

interface Draft {
  region: string | null;
  language: string;
  subtitles: string[];
}

const fromBrand = (b: Brand): Draft => ({
  region: b.kit.region ?? null,
  language: b.kit.language ?? "en",
  subtitles: b.kit.subtitle_languages ?? [],
});

/** Audience region → default narration language + subtitles (new runs inherit them; runs can override). */
export function LanguageSettings({ brand, onSaved }: { brand: Brand; onSaved: (b: Brand) => void }) {
  const toast = useToast();
  const langs = useLanguages();
  const [draft, setDraft] = useState<Draft>(() => fromBrand(brand));
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  useEffect(() => setDraft(fromBrand(brand)), [brand]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(fromBrand(brand));

  async function useMyLocation() {
    setLocating(true);
    try {
      const s = await api.locale();
      if (s.source === "default") {
        toast({ tone: "info", title: "Couldn't detect a location", body: "Pick the audience region from the list." });
        return;
      }
      setDraft({ region: s.region?.includes("-") || s.region_name ? s.region : draft.region ?? s.region,
                 language: s.language, subtitles: s.subtitle_languages });
      toast({
        tone: "success",
        title: `Detected ${s.region_name ?? s.region ?? "your browser language"}`,
        body: `${languageLabel(langs, s.language)} (from ${s.source === "geo" ? "your location" : "your browser language"})`,
      });
    } catch (e) {
      toast({ tone: "error", title: "Location lookup failed", body: e instanceof Error ? e.message : String(e) });
    } finally {
      setLocating(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await api.patchBrand(brand.id, {
        kit: { region: draft.region, language: draft.language, subtitle_languages: draft.subtitles },
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
    <Card
      className="language-settings"
      title={<span className="inline-icon"><Languages size={15} aria-hidden /> Audience & language</span>}
      actions={
        <button className="btn btn-ghost btn-sm" onClick={() => void useMyLocation()} disabled={locating}>
          {locating ? <Spinner size={13} /> : <LocateFixed size={14} aria-hidden />} Use my location
        </button>
      }
    >
      <label className="field">
        <span className="field-label">
          <span className="inline-icon">
            <MapPin size={14} aria-hidden /> Audience region
          </span>
          <span className="field-hint">sets the default language and makes scripts locally relevant</span>
        </span>
        <RegionSelect
          value={draft.region}
          onChange={(r) =>
            setDraft(r ? { region: r.code, language: r.language, subtitles: r.subtitle_languages } : { ...draft, region: null })
          }
        />
      </label>
      <LanguagePicker
        language={draft.language}
        subtitles={draft.subtitles}
        onChange={(language, subtitles) => setDraft({ ...draft, language, subtitles })}
      />
      <p className="muted small">
        Picking a region fills in its language (e.g. Telangana → Telugu with English and Hindi subtitles); you can still change it.
        Each run can override these on the New run page.
      </p>
      <div className="form-actions">
        <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? <Spinner size={14} /> : <Save size={15} />} Save
        </button>
      </div>
    </Card>
  );
}
