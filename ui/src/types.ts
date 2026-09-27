// Mirrors clipforge/models.py and the view shapes built in clipforge/api/app.py.
// Datetimes arrive as ISO strings.

export type Tier = "economy" | "premium";
export type Platform =
  | "youtube" | "instagram" | "tiktok" | "linkedin" | "x"
  | "facebook" | "threads" | "pinterest" | "bluesky" | "reddit";
export const ALL_PLATFORMS: Platform[] = [
  "youtube", "instagram", "tiktok", "facebook", "linkedin", "x", "threads", "pinterest", "bluesky", "reddit",
];
/** Platforms whose policy requires labelling realistic AI content; always labelled (mirrors platforms.py). */
export const DISCLOSURE_REQUIRED: Platform[] = ["youtube", "instagram", "tiktok", "facebook", "threads"];
/** Account targets a platform needs in the brand kit before it can be posted to (mirrors platforms.py). */
export const REQUIRED_PLATFORM_OPTIONS: Partial<Record<Platform, string[]>> = {
  pinterest: ["board_id"],
  reddit: ["subreddit"],
};
export type AspectRatio = "9:16" | "1:1" | "16:9";
export const ASPECTS: AspectRatio[] = ["9:16", "1:1", "16:9"];

export type RunStatus =
  | "queued"
  | "running"
  | "resume_requested"
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
  "resume_requested",
  "awaiting_approval",
  "awaiting_provider",
  "scheduled",
  "published",
  "failed",
  "aborted",
  "dead_letter",
];
export const RETRYABLE_STATUSES: RunStatus[] = ["failed", "dead_letter", "aborted"];
export const ACTIVE_STATUSES: RunStatus[] = ["queued", "running", "resume_requested", "awaiting_provider"];

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
export type StageName = (typeof STAGES)[number];

export const REGENERATABLE = ["ideate", "script", "tts", "gen_shots", "music", "render"] as const;
export type RegenStage = (typeof REGENERATABLE)[number];

export type Decision = "approve" | "regenerate" | "edit" | "reject";

export interface Hook {
  text: string;
  angle: string;
  score: number;
  rationale: string;
  /** cosine similarity to recent hooks (dedupe), present on state.hooks */
  similarity?: number;
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
  /** resolved URL for thumbnail_path (GET /runs/{id} only) */
  thumbnail_url?: string | null;
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

/** Edit patch: changed Script fields, plus optionally the full new shot list (3–6 prompts). */
export type ScriptPatch = Partial<Script> & { shots?: { prompt: string; duration?: number }[] };

export interface ApprovalDecision {
  decision: Decision;
  stage?: RegenStage;
  patch?: ScriptPatch;
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
  pending_decision: ApprovalDecision | null;
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

// ---------------------------------------------------------------- brand kit

export interface CaptionStyle {
  font: string;
  font_size: number;
  color: string;
  highlight_color: string;
  stroke_color: string;
  stroke_width: number;
  position: "top" | "center" | "bottom";
  words_per_line: number;
  uppercase: boolean;
}

export interface CalendarSlot {
  weekday: number; // Monday = 0
  time: string;
  platforms: Platform[];
}

export interface BrandKit {
  fonts: string[];
  colors: Record<string, string>;
  logo_path: string | null;
  caption_style: CaptionStyle;
  voice_id: string;
  reference_images: string[];
  negative_prompts: string[];
  banned_topics: string[];
  tone: string;
  audience: string;
  niche: string;
  template: string;
  music_moods: string[];
  disclosure: { default: boolean; per_platform: Partial<Record<Platform, boolean>> };
  platforms: Platform[];
  platform_options?: Partial<Record<Platform, Record<string, string>>>;
  hashtags: string[];
  consistency: "reference" | "first_shot" | "none";
}

export interface Brand {
  id: string;
  org_id: string;
  name: string;
  kit: BrandKit;
  tier: Tier;
  budget_per_run: number;
  daily_budget: number;
  trust_score: number;
  auto_approve_after: number;
  calendar: { timezone: string; slots: CalendarSlot[] };
  publisher: "upload_post" | "ayrshare";
  /** GET /brands/{id} only: whether a publisher profile key is stored (never the key itself). */
  credentials?: Partial<Record<"upload_post" | "ayrshare", boolean>>;
  /** GET/PATCH /brands/{id} only: enabled platforms that are missing required account fields. */
  warnings?: string[];
}

export interface BrandPatch {
  name?: string;
  tier?: Tier;
  budget_per_run?: number;
  daily_budget?: number;
  auto_approve_after?: number;
  publisher?: Brand["publisher"];
  kit?: Partial<BrandKit>;
}

// ---------------------------------------------------------------- API shapes

export interface QueueItem {
  run: Run;
  brand_name: string;
  qa: QAReport | null;
  script: Script | null;
  vo?: VoiceOver | null;
  shot_list?: { shots: Shot[] } | null;
  preview_url: string | null;
  cost_total: number;
  budget: number;
}

export interface RenderInfo {
  aspect: AspectRatio;
  path: string;
  url: string | null;
  width: number;
  height: number;
  duration: number;
}

export interface ClipInfo {
  shot_index: number;
  index?: number;
  path: string;
  url: string | null;
  duration: number;
  provider: string;
  model: string;
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface VoiceOver {
  audio_path: string;
  duration: number;
  words: WordTiming[];
  lufs: number | null;
}

export interface MusicTrack {
  path: string;
  title: string;
  license_id: string;
  provider: string;
  duck_db: number;
}

export interface RunState {
  hooks?: Hook[];
  hook?: Hook;
  script?: Script;
  shot_list?: { shots: Shot[] };
  qa_report?: QAReport;
  metadata?: PlatformMetadata[];
  vo?: VoiceOver;
  music?: MusicTrack;
  decision?: ApprovalDecision;
  auto_approved?: boolean;
  renders: RenderInfo[];
  clips: ClipInfo[];
}

export interface RunDetail {
  run: Run;
  stages: StageRecord[];
  assets: (Asset & { url: string | null })[];
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
  budget?: number;
}

export interface CostDay {
  day: string;
  total: number;
  by_stage: Record<string, number>;
  by_provider: Record<string, number>;
}

export interface BrandCosts {
  brand_id: string;
  from: string;
  to: string;
  total: number;
  by_provider: Record<string, number>;
  by_stage: Record<string, number>;
  by_day: CostDay[];
  runs: number;
}

/** SSE frames from GET /runs/{id}/events. */
export type RunEvent =
  | ({ type: "stage" } & StageRecord)
  | { type: "status"; status: RunStatus; error: string | null }
  | { type: "cost"; cost_total: number; budget: number };
