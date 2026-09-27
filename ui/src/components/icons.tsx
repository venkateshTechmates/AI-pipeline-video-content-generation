import type { SVGProps } from "react";
import {
  CalendarClock,
  Clapperboard,
  FileText,
  Film,
  Lightbulb,
  LineChart,
  Mic,
  Music,
  PenLine,
  Send,
  ShieldCheck,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import type { Platform } from "../types";

type P = SVGProps<SVGSVGElement> & { size?: number };

/** Simplified monochrome platform glyphs (lucide dropped brand icons). */
export function PlatformIcon({ platform, size = 16, ...rest }: P & { platform: Platform }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true, ...rest };
  switch (platform) {
    case "youtube":
      return (
        <svg {...common} fill="currentColor">
          <path d="M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C18 4.8 12 4.8 12 4.8s-6 0-7.7.5a2.7 2.7 0 0 0-1.9 1.9C2 8.9 2 12 2 12s0 3.1.4 4.8a2.7 2.7 0 0 0 1.9 1.9c1.7.5 7.7.5 7.7.5s6 0 7.7-.5a2.7 2.7 0 0 0 1.9-1.9c.4-1.7.4-4.8.4-4.8s0-3.1-.4-4.8ZM10 15.1V8.9l5.2 3.1L10 15.1Z" />
        </svg>
      );
    case "instagram":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
        </svg>
      );
    case "tiktok":
      return (
        <svg {...common} fill="currentColor">
          <path d="M16.6 3c.3 2.2 1.6 3.7 3.9 3.9v3a7 7 0 0 1-3.9-1.2v6.1a5.8 5.8 0 1 1-5-5.7v3.1a2.8 2.8 0 1 0 2 2.7V3h3Z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg {...common} fill="currentColor">
          <path d="M4.5 3A1.5 1.5 0 0 0 3 4.5v15A1.5 1.5 0 0 0 4.5 21h15a1.5 1.5 0 0 0 1.5-1.5v-15A1.5 1.5 0 0 0 19.5 3h-15Zm1.9 6.2h2.7V18H6.4V9.2Zm1.3-4.1a1.6 1.6 0 1 1 0 3.1 1.6 1.6 0 0 1 0-3.1Zm3.3 4.1h2.6v1.2c.4-.7 1.3-1.4 2.7-1.4 2.8 0 3.3 1.8 3.3 4.2V18h-2.7v-4.3c0-1 0-2.3-1.4-2.3s-1.7 1.1-1.7 2.2V18H11V9.2Z" />
        </svg>
      );
    case "x":
      return (
        <svg {...common} fill="currentColor">
          <path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.2-8.3L2 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.5l11.2 14.5Z" />
        </svg>
      );
  }
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube Shorts",
  instagram: "Instagram Reels",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
};

/** Soft caps per platform (title / description) used for char-count meters. */
export const PLATFORM_LIMITS: Record<Platform, { title: number | null; description: number }> = {
  youtube: { title: 100, description: 5000 },
  instagram: { title: null, description: 2200 },
  tiktok: { title: null, description: 2200 },
  linkedin: { title: 200, description: 3000 },
  x: { title: null, description: 280 },
};

export const STAGE_META: Record<string, { label: string; icon: LucideIcon; hint: string }> = {
  ideate: { label: "Ideate", icon: Lightbulb, hint: "Hook candidates + dedupe" },
  script: { label: "Script", icon: FileText, hint: "Beats, VO, shot list" },
  tts: { label: "Voice", icon: Mic, hint: "TTS + word timings" },
  gen_shots: { label: "Shots", icon: Film, hint: "AI video generation" },
  music: { label: "Music", icon: Music, hint: "Licensed track" },
  render: { label: "Render", icon: Clapperboard, hint: "9:16 · 1:1 · 16:9" },
  qa: { label: "QA", icon: ShieldCheck, hint: "Automated checks" },
  approve: { label: "Approve", icon: UserCheck, hint: "Human gate" },
  metadata: { label: "Metadata", icon: PenLine, hint: "Per-platform copy" },
  publish: { label: "Publish", icon: Send, hint: "Schedule posts" },
  metrics: { label: "Metrics", icon: LineChart, hint: "Post performance" },
};
export const SCHEDULE_ICON = CalendarClock;
