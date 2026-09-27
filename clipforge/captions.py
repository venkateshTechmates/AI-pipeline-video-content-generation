"""Word-level captions: tokenising, grouping, ASS (word-highlight) for ffmpeg, SRT/WebVTT, sync drift.

Languages written without spaces (Chinese, Japanese, Thai) are tokenised into short character chunks so
captions still advance a "word" at a time; lines are joined without spaces for them.
"""

from __future__ import annotations

import re

from .languages import Language, get_language
from .models import CaptionStyle, WordTiming

PUNCT_END = r"[.!?,;:。！？、，；：।॥؟،]$"
PUNCT_STOP = r"[.!?。！？।॥؟]$"
CJK_CHUNK = 2  # characters per caption token for unspaced scripts


def tokenize(text: str, lang: Language | str | None = None) -> list[str]:
    lang = lang if isinstance(lang, Language) else get_language(lang)
    if lang.spaced:
        return text.split()
    tokens: list[str] = []
    for seg in text.split():
        buf = ""
        for ch in seg:
            if re.match(PUNCT_END, ch):  # punctuation sticks to the previous chunk
                if buf:
                    tokens.append(buf + ch)
                    buf = ""
                elif tokens:
                    tokens[-1] += ch
                else:
                    buf = ch
                continue
            buf += ch
            if len(buf) >= CJK_CHUNK:
                tokens.append(buf)
                buf = ""
        if buf:
            if tokens and re.match(PUNCT_END, buf):
                tokens[-1] += buf
            else:
                tokens.append(buf)
    return tokens


def joiner(lang: Language | str | None) -> str:
    lang = lang if isinstance(lang, Language) else get_language(lang)
    return " " if lang.spaced else ""


def group_words(words: list[WordTiming], per_line: int, lang: Language | str | None = None) -> list[list[WordTiming]]:
    """Group words into caption lines, breaking early at sentence punctuation."""
    lang = lang if isinstance(lang, Language) else get_language(lang)
    per_line = per_line if lang.spaced else per_line + 2  # 2-char chunks: ~8-10 characters a line
    groups: list[list[WordTiming]] = []
    cur: list[WordTiming] = []
    for w in words:
        cur.append(w)
        if len(cur) >= per_line or re.search(PUNCT_END, w.word):
            groups.append(cur)
            cur = []
    if cur:
        groups.append(cur)
    return groups


def estimate_word_timings(text: str, total: float, start: float = 0.0,
                          lang: Language | str | None = None) -> list[WordTiming]:
    """Fallback when the TTS provider has no timestamps: distribute by character length,
    adding a small pause weight after punctuation."""
    lang = lang if isinstance(lang, Language) else get_language(lang)
    tokens = tokenize(text, lang)
    if not tokens:
        return []
    gap = 2 if lang.spaced else 0
    weights = [len(t) + gap + (4 if re.search(PUNCT_STOP, t) else 2 if re.search(PUNCT_END, t) else 0)
               for t in tokens]
    unit = total / sum(weights)
    out, t = [], start
    for tok, wgt in zip(tokens, weights, strict=True):
        d = wgt * unit
        speak = d * (0.8 if re.search(PUNCT_END, tok) else 0.95)
        out.append(WordTiming(word=tok, start=round(t, 3), end=round(t + speak, 3)))
        t += d
    return out


def _ass_time(t: float) -> str:
    t = max(0.0, t)
    h = int(t // 3600)
    m = int(t % 3600 // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _ass_color(hex_color: str) -> str:
    h = hex_color.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H00{b}{g}{r}".upper()


def _esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("{", "(").replace("}", ")")


def to_ass(words: list[WordTiming], style: CaptionStyle, width: int, height: int,
           lang: Language | str | None = None) -> str:
    """ASS subtitles with one event per word so the active word is highlighted (word-highlight style)."""
    lang = lang if isinstance(lang, Language) else get_language(lang)
    font = lang.font or style.font  # scripts the brand font may not cover get a Noto face
    upper = style.uppercase and lang.uppercase
    sep = joiner(lang)
    scale = width / 1080
    size = int(style.font_size * scale)
    align = {"top": 8, "center": 5, "bottom": 2}[style.position]
    margin_v = int(height * (0.12 if style.position != "center" else 0))
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{font},{size},{_ass_color(style.color)},{_ass_color(style.highlight_color)},{_ass_color(style.stroke_color)},&H64000000,-1,0,0,0,100,100,0,0,1,{max(1, int(style.stroke_width * scale))},2,{align},{int(60 * scale)},{int(60 * scale)},{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    hl = _ass_color(style.highlight_color)
    lines = []
    for group in group_words(words, style.words_per_line, lang):
        texts = [(w.word.upper() if upper else w.word) for w in group]
        for i, w in enumerate(group):
            start = w.start
            end = group[i + 1].start if i + 1 < len(group) else w.end
            parts = [
                f"{{\\c{hl}}}{_esc(t)}{{\\r}}" if j == i else _esc(t) for j, t in enumerate(texts)
            ]
            lines.append(f"Dialogue: 0,{_ass_time(start)},{_ass_time(max(end, start + 0.05))},Cap,,0,0,0,,"
                         + sep.join(parts))
    return header + "\n".join(lines) + "\n"


def subtitle_segments(words: list[WordTiming], per_line: int = 7,
                      lang: Language | str | None = None) -> list[tuple[float, float, str]]:
    """Readable subtitle cues (start, end, text) from word timings."""
    sep = joiner(lang)
    return [(g[0].start, g[-1].end, sep.join(w.word for w in g)) for g in group_words(words, per_line, lang)]


def _ts(t: float, sep: str) -> str:
    ms = int(round(max(0.0, t) * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}{sep}{ms % 1000:03d}"


def segments_to_srt(segments: list[tuple[float, float, str]]) -> str:
    return "\n".join(f"{i}\n{_ts(a, ',')} --> {_ts(b, ',')}\n{text}\n" for i, (a, b, text) in enumerate(segments, 1))


def segments_to_vtt(segments: list[tuple[float, float, str]]) -> str:
    body = "\n".join(f"{_ts(a, '.')} --> {_ts(b, '.')}\n{text}\n" for a, b, text in segments)
    return "WEBVTT\n\n" + body


def to_srt(words: list[WordTiming], per_line: int = 6, lang: Language | str | None = None) -> str:
    return segments_to_srt(subtitle_segments(words, per_line, lang))


def caption_drift_ms(words: list[WordTiming], audio_duration: float) -> float:
    """Worst-case caption/audio drift estimate in ms.

    Captions are generated straight from TTS word timestamps, so drift comes from
    (a) timestamps that run past the audio, (b) non-monotonic or overlapping
    timings, and (c) the frame quantisation of burned-in captions (half a frame
    at 30 fps). QA fails above 150 ms.
    """
    if not words:
        return float("inf")
    drift = 1000 / 30 / 2
    overrun = max(0.0, words[-1].end - audio_duration) * 1000
    back = 0.0
    for a, b in zip(words, words[1:], strict=False):
        if b.start < a.start:
            back = max(back, (a.start - b.start) * 1000)
        if a.end < a.start:
            back = max(back, (a.start - a.end) * 1000)
    return round(drift + max(overrun, back), 1)
