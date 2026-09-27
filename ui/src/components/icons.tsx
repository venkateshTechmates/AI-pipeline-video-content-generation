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
    case "facebook":
      return (
        <svg {...common} fill="currentColor">
          <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z" />
        </svg>
      );
    case "threads":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M16.5 8.8C15.9 6.5 14.2 5 11.8 5 8.4 5 6.2 7.8 6.2 12s2.2 7 5.8 7c2.9 0 4.9-1.7 4.9-4.1 0-2.3-1.8-3.6-4.4-3.6-2 0-3.3 1-3.3 2.4 0 1.3 1.1 2.1 2.5 2.1 2.3 0 3.5-2 3.1-5.2" />
        </svg>
      );
    case "pinterest":
      return (
        <svg {...common} fill="currentColor">
          <path d="M12 2a10 10 0 0 0-3.6 19.3c-.1-.8-.2-2 0-2.9l1.2-5s-.3-.6-.3-1.5c0-1.4.8-2.5 1.8-2.5.9 0 1.3.7 1.3 1.4 0 .9-.6 2.2-.9 3.4-.2 1 .5 1.9 1.6 1.9 1.9 0 3.3-2 3.3-4.9 0-2.5-1.8-4.3-4.4-4.3-3 0-4.8 2.3-4.8 4.6 0 .9.4 1.9.8 2.4l.1.4-.3 1.2c0 .2-.2.3-.4.2-1.4-.6-2.2-2.6-2.2-4.2 0-3.4 2.5-6.6 7.2-6.6 3.8 0 6.7 2.7 6.7 6.3 0 3.8-2.4 6.8-5.7 6.8-1.1 0-2.2-.6-2.5-1.3l-.7 2.6c-.3 1-.9 2.2-1.4 2.9A10 10 0 1 0 12 2Z" />
        </svg>
      );
    case "bluesky":
      return (
        <svg {...common} fill="currentColor">
          <path d="M6.3 4.4C8.6 6.1 11 9.6 12 11.5c1-1.9 3.4-5.4 5.7-7.1 1.6-1.2 4.3-2.2 4.3.9 0 .6-.4 5.2-.6 5.9-.7 2.6-3.3 3.2-5.6 2.8 4 .7 5 3 2.8 5.2-4.2 4.3-6-1.1-6.5-2.5l-.1-.3-.1.3c-.5 1.4-2.3 6.8-6.5 2.5-2.2-2.2-1.2-4.5 2.8-5.2-2.3.4-4.9-.2-5.6-2.8C2.4 10.5 2 5.9 2 5.3c0-3.1 2.7-2.1 4.3-.9Z" />
        </svg>
      );
    case "reddit":
      return (
        <svg {...common} fill="currentColor">
          <path d="M22 12.1a2.2 2.2 0 0 0-3.7-1.6 10.8 10.8 0 0 0-5.8-1.8l1-4.6 3.2.7a1.6 1.6 0 1 0 .2-1l-3.6-.8a.5.5 0 0 0-.6.4l-1.1 5.3a10.8 10.8 0 0 0-5.9 1.8A2.2 2.2 0 1 0 3.3 14a4.3 4.3 0 0 0 0 .7c0 3.4 4 6.2 8.8 6.2s8.8-2.8 8.8-6.2a4.3 4.3 0 0 0 0-.7 2.2 2.2 0 0 0 1.1-1.9ZM7 13.6a1.6 1.6 0 1 1 1.6 1.6A1.6 1.6 0 0 1 7 13.6Zm8.9 4.2a5.9 5.9 0 0 1-3.8 1.2 5.9 5.9 0 0 1-3.8-1.2.4.4 0 0 1 .6-.6 5 5 0 0 0 3.2 1 5 5 0 0 0 3.2-1 .4.4 0 1 1 .6.6Zm-.3-2.6a1.6 1.6 0 1 1 1.6-1.6 1.6 1.6 0 0 1-1.6 1.6Z" />
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
  facebook: "Facebook Reels",
  threads: "Threads",
  pinterest: "Pinterest",
  bluesky: "Bluesky",
  reddit: "Reddit",
};

/** Soft caps per platform (title / description) used for char-count meters. */
export const PLATFORM_LIMITS: Record<Platform, { title: number | null; description: number }> = {
  youtube: { title: 100, description: 5000 },
  instagram: { title: null, description: 2200 },
  tiktok: { title: null, description: 2200 },
  linkedin: { title: 200, description: 3000 },
  x: { title: null, description: 280 },
  facebook: { title: 255, description: 2200 },
  threads: { title: null, description: 500 },
  pinterest: { title: 100, description: 500 },
  bluesky: { title: null, description: 300 },
  reddit: { title: 300, description: 10000 },
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
