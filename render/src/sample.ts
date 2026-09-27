import type { RenderSpec } from "./types";

/** Default props for Remotion Studio (no real assets: shows captions + CTA over the brand colour). */
const text =
  "Stop scrolling this one trick will change how you edit short videos forever so follow for more";

export const sampleSpec: RenderSpec = {
  run_id: "studio-preview",
  template: "default",
  fps: 30,
  duration: 10,
  aspects: ["9:16", "1:1", "16:9"],
  clips: [],
  audio: { voice_path: "", music_path: null, music_gain_db: -12, voice_gain_db: 0, ambient_gain_db: -18 },
  words: text.split(" ").map((word, i) => ({ word, start: 0.2 + i * 0.4, end: 0.2 + i * 0.4 + 0.35 })),
  caption_style: {
    font: "Inter",
    font_size: 72,
    color: "#FFFFFF",
    highlight_color: "#FFD400",
    stroke_color: "#000000",
    stroke_width: 6,
    position: "center",
    words_per_line: 3,
    uppercase: true,
  },
  brand: {
    logo_path: null,
    primary_color: "#111111",
    accent_color: "#FFD400",
    font: "Inter",
    cta_text: "Follow for daily tips",
  },
  language: "en",
  film_look: "cinematic",
  output_prefix: "runs/studio-preview/render",
};
