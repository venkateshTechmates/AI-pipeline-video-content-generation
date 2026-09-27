// Mirrors clipforge/models.py (Pydantic -> JSON). Datetimes arrive as ISO strings.

export type Tier = "economy" | "premium";
export type Platform = "youtube" | "instagram" | "tiktok" | "linkedin" | "x";
export const ALL_PLATFORMS: Platform[] = ["youtube", "instagram", "tiktok", "linkedin", "x"];
export type AspectRatio = "9:16" | "1:1" | "16:9";

export type RunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "awaiting_provider"
  | "scheduled"
  | "published"
  | "failed"
  | "aborted"
  | "dead_letter";
export const RUN_STATUSES: RunStatus[] = [
  "queued",
  "running",
  "awaiting_approval",
  "awaiting_provider",
  "scheduled",
  "published",
  "failed",
  "aborted",
  "dead_letter",
];

export type StageStatus = "pending" | "running" | "succeeded" | "skipped" | "failed";

export const STAGES = [
  "ideate",
  "script",
  "tts",
  "gen_shots",
  "music",
  "render",
  "qa",
  "approve",
  "metadata",
  "publish",
  "metrics",
] as const;

export const REGENERATABLE = ["ideate", "script", "tts", "gen_shots", "music", "render"] as const;
export type RegenStage = (typeof REGENERATABLE)[number];

export type Decision = "approve" | "regenerate" | "edit" | "reject";

export interface Hook {
  text: string;
  angle: string;
  score: number;
  rationale: string;
}

export type BeatPurpose = "hook" | "setup" | "value" | "payoff" | "cta";
export const BEAT_PURPOSES: BeatPurpose[] = ["hook", "setup", "value", "payoff", "cta"];

export interface Beat {
  text: string;
  purpose: BeatPurpose;
}

export interface Script {
  title: string;
  hook: string;
  beats: Beat[];
  vo_text: string;
  caption_text: string;
  cta: string;
  mood: string;
  target_seconds: number;
}

export interface Shot {
  index: number;
  prompt: string;
  duration: number;
  negative_prompt: string;
  ref_image: string | null;
}

export interface QACheck {
  name: string;
  passed: boolean;
  value: unknown;
  detail: string;
  weight: number;
}

export interface QAReport {
  checks: QACheck[];
  score: number;
  passed: boolean;
}

export interface PlatformMetadata {
  platform: Platform;
  title: string;
  description: string;
  hashtags: string[];
  thumbnail_path: string | null;
  thumbnail_time: number;
  ai_disclosure: boolean;
  aspect: AspectRatio;
}

export interface PostRecord {
  id: string;
  run_id: string;
  platform: Platform;
  external_id: string | null;
  url: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  status: "scheduled" | "published" | "failed";
  metadata: Record<string, unknown>;
}

export interface ApprovalDecision {
  decision: Decision;
  stage?: RegenStage;
  patch?: Partial<Script>;
  note?: string;
  reviewer?: string;
}

export interface Run {
  id: string;
  brand_id: string;
  brief: string | null;
  status: RunStatus;
  tier: Tier;
  budget: number;
  cost_total: number;
  checkpoint_id: string | null;
  schedule: string | null;
  platforms: Platform[];
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

export interface StageRecord {
  id: string;
  run_id: string;
  name: string;
  status: StageStatus;
  attempt: number;
  provider: string | null;
  cost: number;
  input_ref: string | null;
  output_ref: string | null;
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface Asset {
  id: string;
  run_id: string;
  type: string;
  storage_path: string;
  sha256: string;
  meta: Record<string, unknown>;
}

export interface LedgerEntry {
  id: string;
  run_id: string;
  brand_id: string;
  stage: string;
  provider: string;
  units: number;
  unit_cost: number;
  total: number;
  at: string;
}

export interface Brand {
  id: string;
  org_id: string;
  name: string;
  tier: Tier;
  budget_per_run: number;
  daily_budget: number;
  trust_score: number;
  auto_approve_after: number;
  // kit, calendar, publisher etc. exist but are not needed by the UI
  [key: string]: unknown;
}

// ---------------------------------------------------------------- API shapes

export interface QueueItem {
  run: Run;
  brand_name: string;
  qa: { score: number; passed: boolean; checks: QACheck[] } | null;
  script: Script | null;
  preview_url: string | null;
  cost_total: number;
  budget: number;
}

export interface RenderInfo {
  aspect: AspectRatio;
  path: string;
  url: string;
  width: number;
  height: number;
  duration: number;
}

export interface RunState {
  script?: Script;
  shot_list?: { shots: Shot[] };
  qa_report?: QAReport;
  renders?: RenderInfo[];
  metadata?: PlatformMetadata[];
  hooks?: Hook[];
}

export interface RunDetail {
  run: Run;
  stages: StageRecord[];
  assets: (Asset & { url: string })[];
  ledger: LedgerEntry[];
  posts: PostRecord[];
  state: RunState;
}

export interface RunCreateBody {
  brand_id: string;
  brief?: string;
  tier?: Tier;
  schedule?: string;
  platforms?: Platform[];
}

export interface BrandCosts {
  brand_id: string;
  total: number;
  by_provider: Record<string, number>;
  by_stage: Record<string, number>;
  by_day: { day: string; total: number }[];
  runs: number;
}

export type RunEvent =
  | ({ type: "stage" } & Partial<StageRecord> & { name?: string; stage?: string })
  | { type: "status"; status: RunStatus; error?: string | null; [k: string]: unknown }
  | { type: "cost"; cost_total?: number; total?: number; stage?: string; provider?: string; [k: string]: unknown };
