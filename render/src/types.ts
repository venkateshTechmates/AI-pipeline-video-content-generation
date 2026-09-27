/**
 * Mirrors `clipforge/render_spec.py` (RenderSpec / RenderResult) and the
 * relevant bits of `clipforge/models.py`. The zod schema applies the same
 * defaults as the Pydantic models so a partially-filled spec parses the same
 * on both sides.
 */
import { z } from "zod";

export const ASPECTS = ["9:16", "1:1", "16:9"] as const;
export type Aspect = (typeof ASPECTS)[number];

export const ASPECT_SIZE: Record<Aspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

/** "9:16" -> "9x16" (composition ids and output file names). */
export const aspectSlug = (aspect: Aspect): string => aspect.replace(":", "x");

export const TEMPLATES = ["default", "bold"] as const;
export type TemplateId = (typeof TEMPLATES)[number];

export const compositionId = (template: string, aspect: Aspect): string => {
  const t = (TEMPLATES as readonly string[]).includes(template) ? template : "default";
  return `${t}-${aspectSlug(aspect)}`;
};

export const AspectSchema = z.enum(ASPECTS);

export const WordTimingSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
});

export const CaptionStyleSchema = z.object({
  font: z.string().default("Inter"),
  font_size: z.number().int().positive().default(72),
  color: z.string().default("#FFFFFF"),
  highlight_color: z.string().default("#FFD400"),
  stroke_color: z.string().default("#000000"),
  stroke_width: z.number().int().nonnegative().default(6),
  position: z.enum(["top", "center", "bottom"]).default("center"),
  words_per_line: z.number().int().positive().default(3),
  uppercase: z.boolean().default(true),
});

export const RenderClipSchema = z.object({
  path: z.string().min(1),
  start: z.number().nonnegative(),
  duration: z.number().positive(),
});

export const RenderAudioSchema = z.object({
  voice_path: z.string().min(1),
  music_path: z.string().nullable().default(null),
  music_gain_db: z.number().default(-12),
  voice_gain_db: z.number().default(0),
});

export const BrandOverlaySchema = z.object({
  logo_path: z.string().nullable().default(null),
  primary_color: z.string().default("#111111"),
  accent_color: z.string().default("#FFD400"),
  font: z.string().default("Inter"),
  cta_text: z.string().nullable().default(null),
});

export const RenderSpecSchema = z.object({
  run_id: z.string(),
  template: z.string().default("default"),
  fps: z.number().int().positive().default(30),
  duration: z.number().positive(),
  aspects: z.array(AspectSchema).min(1).default(["9:16", "1:1", "16:9"]),
  clips: z.array(RenderClipSchema),
  audio: RenderAudioSchema,
  words: z.array(WordTimingSchema),
  caption_style: CaptionStyleSchema.prefault({}),
  brand: BrandOverlaySchema.prefault({}),
  output_prefix: z.string().min(1),
  /** Narration/caption language (ISO 639-1): picks a font with the script's glyphs, spacing, case, direction. */
  language: z.string().default("en"),
});

export type WordTiming = z.infer<typeof WordTimingSchema>;
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;
export type RenderClip = z.infer<typeof RenderClipSchema>;
export type RenderAudio = z.infer<typeof RenderAudioSchema>;
export type BrandOverlay = z.infer<typeof BrandOverlaySchema>;
export type RenderSpec = z.infer<typeof RenderSpecSchema>;

export const parseRenderSpec = (raw: unknown): RenderSpec => RenderSpecSchema.parse(raw);

export type RenderResultItem = {
  aspect: Aspect;
  path: string;
  width: number;
  height: number;
  duration: number;
};

export type RenderResult = {
  outputs: RenderResultItem[];
  renderer: string;
};

/** Input props of every composition. Asset paths in `spec` are already URLs. */
export type CompositionProps = {
  spec: RenderSpec;
  aspect: Aspect;
};

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
