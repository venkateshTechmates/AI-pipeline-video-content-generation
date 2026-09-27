import { Languages } from "lucide-react";
import { api } from "../api";
import { useAsync } from "../hooks";
import type { LanguageInfo, LocaleSuggestion, RegionInfo } from "../types";

let cache: LanguageInfo[] | null = null;

/** Supported languages from GET /languages (cached for the session). */
export function useLanguages(): LanguageInfo[] {
  const r = useAsync(async () => cache ?? (cache = (await api.languages()).items), []);
  return r.data ?? [];
}

export function languageLabel(langs: LanguageInfo[], code: string | undefined | null): string {
  const l = langs.find((x) => x.code === code);
  return l ? `${l.name} · ${l.native}` : (code ?? "—");
}

/** Narration + burned-in caption language, plus extra translated subtitle files. */
export function LanguagePicker({
  language,
  subtitles,
  onChange,
}: {
  language: string;
  subtitles: string[];
  onChange: (language: string, subtitles: string[]) => void;
}) {
  const langs = useLanguages();
  const toggle = (code: string) =>
    onChange(language, subtitles.includes(code) ? subtitles.filter((c) => c !== code) : [...subtitles, code]);
  return (
    <div className="language-picker">
      <label className="field">
        <span className="field-label">
          <span className="inline-icon">
            <Languages size={14} aria-hidden /> Voice & captions language
          </span>
          <span className="field-hint">script, voice-over and burned-in captions</span>
        </span>
        <select value={language} onChange={(e) => onChange(e.target.value, subtitles.filter((c) => c !== e.target.value))}>
          {(langs.length ? langs : [{ code: language, name: language, native: "", rtl: false }]).map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
              {l.native && l.native !== l.name ? ` · ${l.native}` : ""}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="field">
        <legend className="field-label">
          Extra subtitle files
          <span className="field-hint">translated SRT + WebVTT, same timing</span>
        </legend>
        <div className="lang-chips">
          {langs
            .filter((l) => l.code !== language)
            .map((l) => (
              <button
                key={l.code}
                type="button"
                className={`lang-chip ${subtitles.includes(l.code) ? "on" : ""}`}
                aria-pressed={subtitles.includes(l.code)}
                title={l.name}
                onClick={() => toggle(l.code)}
              >
                {l.native}
              </button>
            ))}
        </div>
      </fieldset>
    </div>
  );
}

let regionCache: RegionInfo[] | null = null;

export function useRegions(): RegionInfo[] {
  const r = useAsync(async () => regionCache ?? (regionCache = (await api.regions()).items), []);
  return r.data ?? [];
}

/** The viewer's suggested content locale (geo / browser language). */
export function useLocaleSuggestion(): LocaleSuggestion | null {
  const r = useAsync(() => api.locale(), []);
  return r.data;
}

/** Audience region: picking one fills in its language and subtitles (callers decide). */
export function RegionSelect({
  value,
  onChange,
  allowEmpty = "Not set",
}: {
  value: string | null | undefined;
  onChange: (region: RegionInfo | null) => void;
  allowEmpty?: string;
}) {
  const regions = useRegions();
  const india = regions.filter((r) => r.code.startsWith("IN-"));
  const countries = regions.filter((r) => !r.code.startsWith("IN-"));
  return (
    <select value={value ?? ""} onChange={(e) => onChange(regions.find((r) => r.code === e.target.value) ?? null)}>
      <option value="">{allowEmpty}</option>
      <optgroup label="India — states & territories">
        {india.map((r) => (
          <option key={r.code} value={r.code}>
            {r.name.replace(", India", "")}
          </option>
        ))}
      </optgroup>
      <optgroup label="Countries">
        {countries.map((r) => (
          <option key={r.code} value={r.code}>
            {r.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
