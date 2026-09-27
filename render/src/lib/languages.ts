/**
 * Caption rules per narration language (mirrors clipforge/languages.py): the font that has the script's
 * glyphs (Google Fonts name, with the system Noto name as fallback), whether words are space-separated,
 * writing direction, and whether the script has letter case.
 */
export type LangRule = {
  font?: string;
  systemFont?: string;
  spaced?: boolean;
  rtl?: boolean;
  uppercase?: boolean;
  /** Extra size for scripts that sit small on their line box (Nastaliq). */
  sizeBoost?: number;
};

const DEVANAGARI = { font: "Noto Sans Devanagari", uppercase: false };
const BENGALI = { font: "Noto Sans Bengali", uppercase: false };

export const LANGUAGE_RULES: Record<string, LangRule> = {
  hi: DEVANAGARI,
  mr: DEVANAGARI,
  ne: DEVANAGARI,
  kok: DEVANAGARI,
  bn: BENGALI,
  as: BENGALI,
  ta: { font: "Noto Sans Tamil", uppercase: false },
  te: { font: "Noto Sans Telugu", uppercase: false },
  kn: { font: "Noto Sans Kannada", uppercase: false },
  ml: { font: "Noto Sans Malayalam", uppercase: false },
  gu: { font: "Noto Sans Gujarati", uppercase: false },
  pa: { font: "Noto Sans Gurmukhi", uppercase: false },
  or: { font: "Noto Sans Oriya", uppercase: false },
  ar: { font: "Noto Sans Arabic", rtl: true, uppercase: false },
  sd: { font: "Noto Naskh Arabic", rtl: true, uppercase: false },
  ur: { font: "Noto Nastaliq Urdu", rtl: true, uppercase: false, sizeBoost: 1.45 },
  ja: { font: "Noto Sans JP", systemFont: "Noto Sans CJK JP", spaced: false, uppercase: false },
  ko: { font: "Noto Sans KR", systemFont: "Noto Sans CJK KR", uppercase: false },
  zh: { font: "Noto Sans SC", systemFont: "Noto Sans CJK SC", spaced: false, uppercase: false },
  th: { font: "Noto Sans Thai", spaced: false, uppercase: false },
};

export const langRule = (language: string | undefined): Required<LangRule> => {
  const code = (language ?? "en").toLowerCase().split(/[-_]/)[0]!;
  const r = LANGUAGE_RULES[code] ?? {};
  return {
    font: r.font ?? "",
    systemFont: r.systemFont ?? r.font ?? "",
    spaced: r.spaced ?? true,
    rtl: r.rtl ?? false,
    uppercase: r.uppercase ?? true,
    sizeBoost: r.sizeBoost ?? 1,
  };
};
