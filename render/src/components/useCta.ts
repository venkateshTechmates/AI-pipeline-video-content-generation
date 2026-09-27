import { useVideoConfig } from "remotion";

export const CTA_SECONDS = 2.5;

/** Frame window for the end card, or null when the spec has no CTA text. */
export const useCtaWindow = (ctaText: string | null): { from: number; frames: number } | null => {
  const { fps, durationInFrames } = useVideoConfig();
  if (!ctaText?.trim()) return null;
  const frames = Math.min(Math.round(CTA_SECONDS * fps), durationInFrames);
  return { from: durationInFrames - frames, frames };
};
