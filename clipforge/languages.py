"""Supported languages for voice-over, burned-in captions and subtitle files.

`spaced=False` scripts (Chinese, Japanese, Thai) have no spaces between words, so captions are chunked
by characters instead of words. `font` is the caption font that has the script's glyphs (installed via
fonts-noto-* in the images); Latin/Cyrillic/Greek keep the brand font.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Language:
    code: str
    name: str  # English name, used in LLM instructions
    native: str
    espeak: str  # espeak-ng voice for the offline demo voice
    spaced: bool = True
    rtl: bool = False
    font: str | None = None  # caption font for non-Latin scripts
    uppercase: bool = True  # scripts with letter case
    chars_per_second: float = 0.0  # speaking pace for unspaced scripts (spaced ones use words/second)


LANGUAGES: dict[str, Language] = {lang.code: lang for lang in [
    Language("en", "English", "English", "en-us"),
    Language("es", "Spanish", "Español", "es"),
    Language("fr", "French", "Français", "fr"),
    Language("de", "German", "Deutsch", "de"),
    Language("pt", "Portuguese", "Português", "pt-br"),
    Language("it", "Italian", "Italiano", "it"),
    Language("nl", "Dutch", "Nederlands", "nl"),
    Language("pl", "Polish", "Polski", "pl"),
    Language("tr", "Turkish", "Türkçe", "tr"),
    Language("ru", "Russian", "Русский", "ru"),
    Language("uk", "Ukrainian", "Українська", "uk"),
    Language("id", "Indonesian", "Bahasa Indonesia", "id"),
    Language("vi", "Vietnamese", "Tiếng Việt", "vi"),
    Language("hi", "Hindi", "हिन्दी", "hi", font="Noto Sans Devanagari", uppercase=False),
    Language("mr", "Marathi", "मराठी", "mr", font="Noto Sans Devanagari", uppercase=False),
    Language("bn", "Bengali", "বাংলা", "bn", font="Noto Sans Bengali", uppercase=False),
    Language("ta", "Tamil", "தமிழ்", "ta", font="Noto Sans Tamil", uppercase=False),
    Language("te", "Telugu", "తెలుగు", "te", font="Noto Sans Telugu", uppercase=False),
    Language("kn", "Kannada", "ಕನ್ನಡ", "kn", font="Noto Sans Kannada", uppercase=False),
    Language("ml", "Malayalam", "മലയാളം", "ml", font="Noto Sans Malayalam", uppercase=False),
    Language("ar", "Arabic", "العربية", "ar", rtl=True, font="Noto Sans Arabic", uppercase=False),
    Language("ja", "Japanese", "日本語", "ja", spaced=False, font="Noto Sans CJK JP", uppercase=False,
             chars_per_second=7.5),
    Language("ko", "Korean", "한국어", "ko", font="Noto Sans CJK KR", uppercase=False),
    Language("zh", "Chinese (Simplified)", "简体中文", "cmn", spaced=False, font="Noto Sans CJK SC",
             uppercase=False, chars_per_second=4.5),
    Language("th", "Thai", "ไทย", "th", spaced=False, font="Noto Sans Thai", uppercase=False,
             chars_per_second=6.0),
]}


def get_language(code: str | None) -> Language:
    if not code:
        return LANGUAGES["en"]
    code = code.lower().split("-")[0].split("_")[0]
    if code not in LANGUAGES:
        raise ValueError(f"unsupported language {code!r}; supported: {', '.join(LANGUAGES)}")
    return LANGUAGES[code]


def is_supported(code: str) -> bool:
    try:
        get_language(code)
        return True
    except ValueError:
        return False


WORDS_PER_SECOND = 2.6


def speech_seconds(text: str, code: str | None = None) -> float:
    """Approximate narration length: words at ~2.6/s, or characters for unspaced scripts."""
    lang = get_language(code)
    if lang.spaced:
        return len(text.split()) / WORDS_PER_SECOND
    chars = sum(1 for ch in text if not ch.isspace())
    return chars / (lang.chars_per_second or 5.0)
