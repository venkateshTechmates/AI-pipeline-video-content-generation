"""Word-level captions: grouping, ASS (word-highlight) for ffmpeg, SRT, and sync drift."""

from __future__ import annotations

import re

from .models import CaptionStyle, WordTiming


def group_words(words: list[WordTiming], per_line: int) -> list[list[WordTiming]]:
    """Group words into caption lines, breaking early at sentence punctuation."""
    groups: list[list[WordTiming]] = []
    cur: list[WordTiming] = []
    for w in words:
        cur.append(w)
        if len(cur) >= per_line or re.search(r"[.!?,;:]$", w.word):
            groups.append(cur)
            cur = []
    if cur:
        groups.append(cur)
    return groups


def estimate_word_timings(text: str, total: float, start: float = 0.0) -> list[WordTiming]:
    """Fallback when the TTS provider has no timestamps: distribute by character length,
    adding a small pause weight after punctuation."""
    tokens = text.split()
    if not tokens:
        return []
    weights = [len(t) + 2 + (4 if re.search(r"[.!?]$", t) else 2 if re.search(r"[,;:]$", t) else 0)
               for t in tokens]
    unit = total / sum(weights)
    out, t = [], start
    for tok, wgt in zip(tokens, weights, strict=True):
        d = wgt * unit
        speak = d * (0.8 if re.search(r"[.!?,;:]$", tok) else 0.95)
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


def to_ass(words: list[WordTiming], style: CaptionStyle, width: int, height: int) -> str:
    """ASS subtitles with one event per word so the active word is highlighted (word-highlight style)."""
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
Style: Cap,{style.font},{size},{_ass_color(style.color)},{_ass_color(style.highlight_color)},{_ass_color(style.stroke_color)},&H64000000,-1,0,0,0,100,100,0,0,1,{max(1, int(style.stroke_width * scale))},2,{align},{int(60 * scale)},{int(60 * scale)},{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    hl = _ass_color(style.highlight_color)
    lines = []
    for group in group_words(words, style.words_per_line):
        texts = [(w.word.upper() if style.uppercase else w.word) for w in group]
        for i, w in enumerate(group):
            start = w.start
            end = group[i + 1].start if i + 1 < len(group) else w.end
            parts = [
                f"{{\\c{hl}}}{_esc(t)}{{\\r}}" if j == i else _esc(t) for j, t in enumerate(texts)
            ]
            lines.append(f"Dialogue: 0,{_ass_time(start)},{_ass_time(max(end, start + 0.05))},Cap,,0,0,0,,"
                         + " ".join(parts))
    return header + "\n".join(lines) + "\n"


def to_srt(words: list[WordTiming], per_line: int = 6) -> str:
    def ts(t: float) -> str:
        ms = int(round(t * 1000))
        return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"

    out = []
    for i, g in enumerate(group_words(words, per_line), 1):
        out.append(f"{i}\n{ts(g[0].start)} --> {ts(g[-1].end)}\n{' '.join(w.word for w in g)}\n")
    return "\n".join(out)


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
