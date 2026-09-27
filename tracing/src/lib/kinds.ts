import {
  Bot,
  Clapperboard,
  Cog,
  Film,
  Layers,
  Mic,
  Music,
  Play,
  Send,
  ShieldCheck,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import type { SpanKind } from "../types";

export const KINDS: SpanKind[] = [
  "run",
  "stage",
  "llm",
  "video",
  "tts",
  "music",
  "render",
  "qa",
  "publish",
  "webhook",
  "internal",
];

export const KIND_META: Record<SpanKind, { label: string; icon: LucideIcon; hint: string }> = {
  run: { label: "Run", icon: Play, hint: "Worker execution (one per start / resume)" },
  stage: { label: "Stage", icon: Layers, hint: "Pipeline graph node" },
  llm: { label: "LLM", icon: Bot, hint: "Language-model call" },
  video: { label: "Video", icon: Film, hint: "AI video generation" },
  tts: { label: "Voice", icon: Mic, hint: "Text-to-speech" },
  music: { label: "Music", icon: Music, hint: "Music track" },
  render: { label: "Render", icon: Clapperboard, hint: "Video render" },
  qa: { label: "QA", icon: ShieldCheck, hint: "Automated checks" },
  publish: { label: "Publish", icon: Send, hint: "Platform publish" },
  webhook: { label: "Webhook", icon: Webhook, hint: "Webhook callback" },
  internal: { label: "Internal", icon: Cog, hint: "Internal bookkeeping" },
};

export function kindOf(k: string): SpanKind {
  return (KINDS as string[]).includes(k) ? (k as SpanKind) : "internal";
}

/** CSS variable for a kind's colour (tokens in styles.css). */
export function kindColor(k: string): string {
  return `var(--k-${kindOf(k)})`;
}

/** The kind of work a pipeline stage mostly does (colours the stage breakdown). */
const STAGE_KIND: Record<string, SpanKind | "wait"> = {
  ideate: "llm",
  script: "llm",
  metadata: "llm",
  translate: "llm",
  tts: "tts",
  gen_shots: "video",
  gen_shot: "video",
  collect_shots: "video",
  music: "music",
  render: "render",
  qa: "qa",
  approve: "wait",
  publish: "publish",
  finalize: "internal",
};

export function stageColor(name: string): string {
  const k = STAGE_KIND[name];
  if (k === "wait") return "var(--k-wait)";
  return kindColor(k ?? "stage");
}

export const STAGE_ORDER = [
  "ideate",
  "script",
  "tts",
  "gen_shots",
  "gen_shot",
  "collect_shots",
  "music",
  "render",
  "qa",
  "approve",
  "metadata",
  "publish",
  "finalize",
];

export function stageRank(name: string): number {
  const i = STAGE_ORDER.indexOf(name);
  return i < 0 ? STAGE_ORDER.length : i;
}

/** Human label for provider names like "fake:kling" / "vertex:veo-3.1". */
export function providerLabel(name: string): string {
  return name;
}
