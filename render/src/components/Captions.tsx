import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { fontStack, useFonts } from "../lib/fonts";
import { langRule } from "../lib/languages";
import type { CaptionStyle, WordTiming } from "../types";

/** Start a new caption group when the speaker pauses longer than this. */
const PAUSE_BREAK_S = 0.8;
/** Keep the last group on screen briefly after its final word ends. */
const HOLD_S = 0.4;

type Group = { words: WordTiming[]; start: number; end: number };

export const groupWords = (words: WordTiming[], perLine: number): Group[] => {
  const groups: Group[] = [];
  let current: WordTiming[] = [];
  const flush = () => {
    if (current.length === 0) return;
    groups.push({ words: current, start: current[0]!.start, end: current[current.length - 1]!.end });
    current = [];
  };
  const sorted = [...words].filter((w) => w.word.trim()).sort((a, b) => a.start - b.start);
  for (const w of sorted) {
    const prev = current[current.length - 1];
    if (current.length >= Math.max(1, perLine) || (prev && w.start - prev.end > PAUSE_BREAK_S)) flush();
    current.push(w);
  }
  flush();
  return groups;
};

type Props = {
  words: WordTiming[];
  style: CaptionStyle;
  /** Extra multiplier on top of the aspect scaling (templates use this for emphasis). */
  sizeMultiplier?: number;
  /** "color": active word changes colour; "box": active word sits on a highlight-coloured pill. */
  highlight?: "color" | "box";
  /** Narration language (ISO 639-1); non-Latin scripts get a matching Noto font, spacing and direction. */
  language?: string;
};

export const Captions: React.FC<Props> = ({ words, style, sizeMultiplier = 1, highlight = "color", language }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const lang = langRule(language);
  // Unspaced scripts (ja/zh/th) arrive as 2-character tokens: show a few more per line.
  const perLine = lang.spaced ? style.words_per_line : style.words_per_line + 2;
  const groups = useMemo(() => groupWords(words, perLine), [words, perLine]);
  useFonts(lang.font ? [lang.font] : []);

  const t = frame / fps;
  let groupIndex = -1;
  for (let i = 0; i < groups.length && groups[i]!.start <= t; i++) groupIndex = i;
  const group = groups[groupIndex];
  if (!group || t > group.end + HOLD_S) return null;

  let active = -1;
  group.words.forEach((w, i) => {
    if (w.start <= t) active = i;
  });

  // Font sizes in the brand kit are authored for a 1080-wide vertical frame;
  // scale by the short edge so 16:9 (1080 tall) doesn't get oversized captions.
  const scale = Math.min(width, height) / 1080;
  const fontSize = style.font_size * scale * sizeMultiplier * lang.sizeBoost;
  const stroke = style.stroke_width * scale * sizeMultiplier;
  const isVertical = height > width;

  const justify = style.position === "top" ? "flex-start" : style.position === "bottom" ? "flex-end" : "center";
  const padTop = style.position === "top" ? height * (isVertical ? 0.14 : 0.1) : 0;
  // Leave room for platform UI (title/buttons) on vertical video.
  const padBottom = style.position === "bottom" ? height * (isVertical ? 0.22 : 0.12) : 0;

  const entry = interpolate(frame - Math.round(group.start * fps), [0, 4], [0.85, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: justify,
        alignItems: "center",
        paddingTop: padTop,
        paddingBottom: padBottom,
      }}
    >
      <div
        style={{
          maxWidth: width * 0.86,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
          columnGap: lang.spaced ? fontSize * 0.28 : 0,
          rowGap: fontSize * 0.1,
          transform: `scale(${entry})`,
          // the brand font first; the script's Noto face (Google name, then the system name) covers the rest
          fontFamily: fontStack(style.font, lang.font, lang.systemFont),
          fontSize,
          fontWeight: lang.sizeBoost > 1 ? 700 : 900,
          lineHeight: lang.sizeBoost > 1 ? 1.6 : 1.15,
          textAlign: "center",
          direction: lang.rtl ? "rtl" : "ltr",
          textTransform: style.uppercase && lang.uppercase ? "uppercase" : "none",
        }}
      >
        {group.words.map((w, i) => {
          const isActive = i === active;
          const pop = isActive
            ? interpolate(frame - Math.round(w.start * fps), [0, 3, 6], [1, 1.12, 1.06], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })
            : 1;
          const boxed = isActive && highlight === "box";
          return (
            <span
              key={`${groupIndex}-${i}`}
              style={{
                display: "inline-block",
                transform: `scale(${pop})`,
                color: boxed ? style.stroke_color : isActive ? style.highlight_color : style.color,
                background: boxed ? style.highlight_color : "transparent",
                borderRadius: boxed ? fontSize * 0.18 : 0,
                padding: boxed ? `0 ${fontSize * 0.16}px` : 0,
                // Stroke is drawn centred on the glyph edge; paint it under the fill
                // so the full stroke width is visible outside the letterforms.
                WebkitTextStroke: boxed || stroke <= 0 ? undefined : `${stroke * 2}px ${style.stroke_color}`,
                paintOrder: "stroke fill",
                textShadow: `0 ${4 * scale}px ${14 * scale}px rgba(0,0,0,0.45)`,
              }}
            >
              {w.word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
