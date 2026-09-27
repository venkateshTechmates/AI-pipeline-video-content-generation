// Fixture data for VITE_MOCK=1 — mirrors the span layout the backend emits
// (run.execute → stage → provider leaf, cost/budget_check/retry/fallback events,
// a paused approve span and a second run.execute after the human decision).
import type {
  AttrValue,
  Brand,
  ProviderStat,
  Span,
  SpanEvent,
  SpanKind,
  StageStat,
  TraceDetail,
  TraceStats,
  TraceSummary,
} from "./types";
import type { StatsQuery, TraceQuery } from "./api";

// ------------------------------------------------------------------ rng

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let idn = 0;
function uid(r: () => number): string {
  const h = () =>
    Math.floor(r() * 0xffffffff)
      .toString(16)
      .padStart(8, "0");
  idn++;
  const a = h();
  const b = h();
  const c = h();
  const d = h();
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-${(8 + (idn % 4)).toString(16)}${c.slice(1, 4)}-${c.slice(4)}${d}`;
}

// ------------------------------------------------------------------ builder

interface Draft {
  id: string;
  parent: string | null;
  name: string;
  kind: SpanKind;
  t0: number;
  t1: number;
  status: "ok" | "error";
  attributes: Record<string, AttrValue>;
  events: { name: string; t: number; attributes: Record<string, unknown> }[];
  error: string | null;
}

const BRANDS: Brand[] = [
  { id: "00000000-0000-4000-8000-000000000001", name: "Daily Habits Lab" },
  { id: "00000000-0000-4000-8000-000000000002", name: "Pocket Finance" },
  { id: "00000000-0000-4000-8000-000000000003", name: "Trailhead Outdoors" },
];

const TITLES: Record<string, string[]> = {
  "Daily Habits Lab": [
    "sleep better tonight",
    "3 deep work mistakes everyone makes",
    "morning routines that actually stick",
    "the 2-minute rule for procrastinators",
    "why your to-do list is failing you",
    "habit stacking in 60 seconds",
    "stop doom-scrolling before bed",
  ],
  "Pocket Finance": [
    "the 50/30/20 budget explained",
    "index funds vs. ETFs in 45 seconds",
    "3 subscriptions you forgot you pay for",
    "how compound interest really works",
    "emergency fund: how much is enough?",
  ],
  "Trailhead Outdoors": [
    "pack a day hike bag in 60s",
    "5 knots every hiker should know",
    "leave no trace, explained",
    "how to read a topo map fast",
  ],
};

interface Scenario {
  status: string;
  brand: number;
  ageMin: number; // minutes before "now" the run started
  tier?: "economy" | "premium";
  language?: string;
  shots?: number;
  approvalWaitMin?: number; // gap between run 1 and run 2
  videoRetry?: boolean;
  videoFallback?: boolean;
  videoFail?: boolean; // gen fails for good
  renderFail?: boolean;
  ttsRetry?: boolean;
  liveElapsedS?: number; // for running traces: how far along
  platforms?: string[];
  reject?: boolean;
  publishFail?: boolean;
  cacheHit?: boolean;
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const SCENARIOS: Scenario[] = [
  { status: "running", brand: 0, ageMin: 0.9, shots: 5, liveElapsedS: 52, videoRetry: true },
  { status: "queued", brand: 1, ageMin: 0.2 },
  { status: "awaiting_approval", brand: 0, ageMin: 38, shots: 4, cacheHit: true },
  {
    status: "published",
    brand: 0,
    ageMin: 6 * 60,
    shots: 5,
    approvalWaitMin: 134,
    videoRetry: true,
    videoFallback: true,
    platforms: ["youtube", "tiktok", "instagram"],
  },
  { status: "failed", brand: 1, ageMin: 9 * 60, shots: 4, videoFail: true },
  { status: "scheduled", brand: 2, ageMin: 20 * 60, shots: 4, approvalWaitMin: 47, platforms: ["youtube", "instagram"], language: "es" },
  { status: "published", brand: 1, ageMin: 26 * 60, shots: 6, tier: "premium", approvalWaitMin: 12, platforms: ["youtube", "linkedin"] },
  { status: "dead_letter", brand: 2, ageMin: 30 * 60, shots: 3, renderFail: true, language: "pt" },
  { status: "aborted", brand: 0, ageMin: 2 * DAY / MIN, shots: 4, approvalWaitMin: 290, reject: true },
  { status: "published", brand: 0, ageMin: 2.3 * DAY / MIN, shots: 4, approvalWaitMin: 25, ttsRetry: true, platforms: ["youtube", "tiktok"] },
  { status: "published", brand: 2, ageMin: 3.1 * DAY / MIN, shots: 5, approvalWaitMin: 61, platforms: ["youtube"], language: "de" },
  { status: "failed", brand: 1, ageMin: 3.6 * DAY / MIN, shots: 4, publishFail: true, approvalWaitMin: 8, platforms: ["tiktok"] },
  { status: "published", brand: 1, ageMin: 4.2 * DAY / MIN, shots: 4, approvalWaitMin: 18, platforms: ["youtube", "tiktok"], cacheHit: true },
  { status: "published", brand: 0, ageMin: 5 * DAY / MIN, shots: 6, tier: "premium", approvalWaitMin: 190, videoFallback: true, platforms: ["youtube", "instagram", "tiktok"] },
  { status: "published", brand: 2, ageMin: 6.2 * DAY / MIN, shots: 4, approvalWaitMin: 35, platforms: ["youtube"], language: "hi" },
  { status: "failed", brand: 0, ageMin: 7.1 * DAY / MIN, shots: 5, videoFail: true, videoRetry: true },
  { status: "published", brand: 1, ageMin: 8 * DAY / MIN, shots: 4, approvalWaitMin: 44, platforms: ["youtube"] },
  { status: "published", brand: 0, ageMin: 9.4 * DAY / MIN, shots: 5, approvalWaitMin: 15, videoRetry: true, platforms: ["tiktok"] },
  { status: "published", brand: 2, ageMin: 10.5 * DAY / MIN, shots: 3, approvalWaitMin: 70, platforms: ["youtube"] },
  { status: "published", brand: 1, ageMin: 11.2 * DAY / MIN, shots: 4, approvalWaitMin: 22, platforms: ["youtube", "linkedin"], language: "fr" },
  { status: "failed", brand: 2, ageMin: 12.3 * DAY / MIN, shots: 4, renderFail: true },
  { status: "published", brand: 0, ageMin: 13.1 * DAY / MIN, shots: 5, approvalWaitMin: 100, platforms: ["youtube"] },
  { status: "published", brand: 1, ageMin: 16 * DAY / MIN, shots: 4, approvalWaitMin: 30, platforms: ["youtube"] },
  { status: "published", brand: 0, ageMin: 19 * DAY / MIN, shots: 5, approvalWaitMin: 45, platforms: ["youtube", "tiktok"] },
  { status: "failed", brand: 2, ageMin: 22 * DAY / MIN, shots: 4, videoFail: true },
  { status: "published", brand: 1, ageMin: 25 * DAY / MIN, shots: 4, approvalWaitMin: 20, platforms: ["youtube"] },
  { status: "published", brand: 2, ageMin: 28 * DAY / MIN, shots: 3, approvalWaitMin: 55, platforms: ["youtube"] },
];

const PROMPTS = [
  "Close-up of a hand silencing a phone on a nightstand, warm lamp light, slow push-in, shallow depth of field",
  "Person stretching beside a window at sunrise, soft golden backlight, handheld drift",
  "Top-down desk with a notebook and coffee, pen crossing items off a list, natural light",
  "Timelapse of a city skyline from dusk to night, locked-off wide shot",
  "Runner lacing shoes on a porch step, morning mist, low angle dolly",
  "Hands pouring water into a glass on a kitchen counter, macro, backlit droplets",
];

function buildTrace(sc: Scenario, index: number, now: number): { summary: TraceSummary; spans: Span[]; endsAt: number } {
  const r = rng(1000 + index * 7919);
  const brand = BRANDS[sc.brand];
  const titles = TITLES[brand.name];
  const title = titles[index % titles.length];
  const runId = uid(r);
  const tier = sc.tier ?? "economy";
  const language = sc.language ?? "en";
  const start = now - sc.ageMin * MIN;
  const drafts: Draft[] = [];
  const add = (d: Omit<Draft, "id" | "events" | "error" | "status"> & Partial<Draft>): Draft => {
    const full: Draft = { id: uid(r), events: [], error: null, status: "ok", ...d } as Draft;
    drafts.push(full);
    return full;
  };
  const j = (a: number, b: number) => a + r() * (b - a);

  if (sc.status === "queued") {
    return {
      summary: summarize(runId, brand, title, sc.status, start, null, [], tier, language),
      spans: [],
      endsAt: start,
    };
  }

  const videoProv = tier === "premium" ? "fake:veo" : "fake:kling";
  const videoFallbackProv = tier === "premium" ? "fake:kling" : "fake:seedance";
  const perSecond = tier === "premium" ? 0.25 : 0.084;
  let t = start + 3;
  let failed = false;

  // ------------------------------------------------ run 1
  const run1 = add({
    parent: null,
    name: "run.execute",
    kind: "run",
    t0: start,
    t1: start,
    attributes: { brand_id: brand.id, tier, language, resume: false, attempt: 1 },
  });

  const llm = (parent: Draft, method: string, t0: number, d: number, extra: Record<string, AttrValue> = {}) =>
    add({
      parent: parent.id,
      name: `llm.${method}`,
      kind: "llm",
      t0,
      t1: t0 + d,
      attributes: {
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        method,
        language,
        tokens: Math.round(j(600, 2400)),
        ...extra,
      },
    });

  // ideate
  const ideate = add({ parent: run1.id, name: "ideate", kind: "stage", t0: t, t1: 0, attributes: { attempt: 1, language } });
  let lt = t + 2;
  const ideaCall = llm(ideate, "ideate", lt, j(2800, 5200), { candidates: 8 });
  lt = ideaCall.t1 + 3;
  for (let k = 0; k < 2; k++) {
    const e = add({
      parent: ideate.id,
      name: "llm.embed",
      kind: "llm",
      t0: lt,
      t1: lt + j(120, 380),
      attributes: { provider: "openai", model: "text-embedding-3-small", method: "embed", tokens: Math.round(j(40, 120)) },
    });
    if (sc.cacheHit && k === 1) e.events.push({ name: "cache_hit", t: e.t0 + 4, attributes: { key: "embed:hook", ttl_s: 86400 } });
    lt = e.t1 + 2;
  }
  ideate.t1 = lt + 4;
  t = ideate.t1 + 3;

  // script
  const script = add({ parent: run1.id, name: "script", kind: "stage", t0: t, t1: 0, attributes: { attempt: 1, language } });
  const sc1 = llm(script, "script", t + 2, j(6200, 11800), { beats: sc.shots ?? 4 });
  const mod = llm(script, "moderate_text", sc1.t1 + 3, j(700, 1400), { safe: true, categories: "" });
  script.t1 = mod.t1 + 3;
  t = script.t1 + 4;

  // tts
  const tts = add({ parent: run1.id, name: "tts", kind: "stage", t0: t, t1: 0, attributes: { attempt: 1, language } });
  let tt = t + 1;
  if (sc.ttsRetry) {
    const bad = add({
      parent: tts.id,
      name: "tts:fake:tts",
      kind: "tts",
      t0: tt,
      t1: tt + j(1800, 2600),
      status: "error",
      error: "ProviderError: 429 Too Many Requests — rate limited (retry-after 2s)",
      attributes: { provider: "fake:tts", attempt: 1, voice: "calm-female-1", chars: 612 },
    });
    tt = bad.t1 + 2000;
    tts.events.push({ name: "retry", t: bad.t1 + 1, attributes: { attempt: 2, delay_ms: 2000, error: "429 Too Many Requests" } });
  }
  const ttsCall = add({
    parent: tts.id,
    name: "tts:fake:tts",
    kind: "tts",
    t0: tt,
    t1: tt + j(2400, 4200),
    attributes: { provider: "fake:tts", attempt: sc.ttsRetry ? 2 : 1, voice: "calm-female-1", chars: 612, units: 38.4 },
  });
  const ttsCost = +(0.0869 + r() * 0.02).toFixed(4);
  tts.attributes.cost_usd = ttsCost;
  tts.events.push({ name: "cost", t: ttsCall.t1 + 1, attributes: { provider: "fake:tts", usd: ttsCost } });
  tts.t1 = ttsCall.t1 + j(900, 2200);
  t = tts.t1 + 2;

  // gen_shots (+ shot 0) then gen_shot per remaining shot, in parallel
  const shots = sc.shots ?? 4;
  const shotSeconds = Array.from({ length: shots }, () => (r() < 0.5 ? 5 : 10));
  const estimate = shotSeconds.reduce((a, s) => a + s * perSecond, 0);
  const genShots = add({ parent: run1.id, name: "gen_shots", kind: "stage", t0: t, t1: 0, attributes: { shots, tier } });
  genShots.events.push({
    name: "budget_check",
    t: t + 1,
    attributes: { estimate_usd: +estimate.toFixed(2), spent_usd: ttsCost, budget_usd: 25, tier },
  });
  let spent = ttsCost;
  const shotSpan = (parent: Draft, i: number, t0: number): number => {
    let st = t0;
    const secs = shotSeconds[i];
    const cost = +(secs * perSecond).toFixed(2);
    const baseDur = (tier === "premium" ? j(52, 96) : j(24, 48)) * 1000;
    const failThis = sc.videoFail && i === shots - 1;
    const retryThis = (sc.videoRetry && i === 1) || failThis;
    const fallbackThis = sc.videoFallback && i === 2;
    let attempt = 1;
    if (retryThis || fallbackThis) {
      const tries = failThis ? 3 : 1;
      for (let a = 0; a < tries; a++) {
        const errMsg =
          a === 0
            ? `ProviderError: ${videoProv} job timed out after 90s (status=IN_QUEUE)`
            : `ProviderError: ${videoProv} 503 Service Unavailable`;
        const bad = add({
          parent: parent.id,
          name: `video:${videoProv}`,
          kind: "video",
          t0: st,
          t1: st + (a === 0 ? 90_000 : j(1200, 3000)),
          status: "error",
          error: errMsg,
          attributes: {
            provider: videoProv,
            attempt,
            shot_index: i,
            seconds: secs,
            prompt: PROMPTS[i % PROMPTS.length],
          },
        });
        st = bad.t1 + 1500 * 2 ** a;
        parent.events.push({
          name: "retry",
          t: bad.t1 + 1,
          attributes: { attempt: attempt + 1, delay_ms: 1500 * 2 ** a, error: errMsg.slice(15, 70) },
        });
        attempt++;
      }
    }
    if (failThis) {
      const bad = add({
        parent: parent.id,
        name: `video:${videoFallbackProv}`,
        kind: "video",
        t0: st + 50,
        t1: st + j(3000, 5000),
        status: "error",
        error: `PermanentError: ${videoFallbackProv} rejected request: content policy (prompt flagged: "crowd")\nTraceback (most recent call last):\n  File "clipforge/providers/fal.py", line 118, in generate\n    raise PermanentError(f"{self.name} rejected request: {msg}")\nclipforge.retry.PermanentError: content policy`,
        attributes: {
          provider: videoFallbackProv,
          attempt: 1,
          fallback_from: videoProv,
          shot_index: i,
          seconds: secs,
          prompt: PROMPTS[i % PROMPTS.length],
        },
      });
      parent.events.push({
        name: "fallback",
        t: st + 10,
        attributes: { from_provider: videoProv, to_provider: videoFallbackProv, error: "retries exhausted" },
      });
      parent.status = "error";
      parent.error = `All video providers failed for shot ${i}: ${videoProv} (timeout ×3), ${videoFallbackProv} (content policy)`;
      failed = true;
      return bad.t1 + 2;
    }
    const prov = fallbackThis ? videoFallbackProv : videoProv;
    if (fallbackThis)
      parent.events.push({
        name: "fallback",
        t: st + 5,
        attributes: { from_provider: videoProv, to_provider: prov, error: "timeout" },
      });
    const ok = add({
      parent: parent.id,
      name: `video:${prov}`,
      kind: "video",
      t0: st + 10,
      t1: st + 10 + baseDur,
      attributes: {
        provider: prov,
        model: prov === "fake:veo" ? "veo-3.1" : prov === "fake:kling" ? "kling-v3" : "seedance-1-pro",
        attempt: fallbackThis ? 1 : attempt,
        fallback_from: fallbackThis ? videoProv : null,
        shot_index: i,
        seconds: secs,
        units: secs,
        prompt: PROMPTS[i % PROMPTS.length],
      },
    });
    spent += cost;
    parent.attributes.cost_usd = cost;
    parent.events.push({ name: "cost", t: ok.t1 + 30, attributes: { provider: prov, usd: cost } });
    return ok.t1 + 40;
  };
  // shot 0 inside gen_shots
  genShots.t1 = shotSpan(genShots, 0, t + 3) + 5;
  t = genShots.t1 + 2;
  let shotEnd = t;
  for (let i = 1; i < shots && !failed; i++) {
    const s0 = t + i * 7;
    const gs = add({
      parent: run1.id,
      name: "gen_shot",
      kind: "stage",
      t0: s0,
      t1: 0,
      attributes: { shot_index: i, prompt: PROMPTS[i % PROMPTS.length], seconds: shotSeconds[i] },
    });
    gs.events.push({
      name: "budget_check",
      t: s0 + 1,
      attributes: { estimate_usd: +(shotSeconds[i] * perSecond).toFixed(2), spent_usd: +spent.toFixed(4), budget_usd: 25, tier },
    });
    gs.t1 = shotSpan(gs, i, s0 + 2);
    shotEnd = Math.max(shotEnd, gs.t1);
  }
  // any errors in a shot fail the run
  if (!failed) {
    const cs = add({ parent: run1.id, name: "collect_shots", kind: "stage", t0: shotEnd + 3, t1: shotEnd + 5, attributes: { shots } });
    t = cs.t1 + 2;

    // music
    const music = add({ parent: run1.id, name: "music", kind: "stage", t0: t, t1: 0, attributes: { attempt: 1, language } });
    const mc = add({
      parent: music.id,
      name: "music:fake:music",
      kind: "music",
      t0: t + 2,
      t1: t + j(1500, 3500),
      attributes: { provider: "fake:music", attempt: 1, mood: "uplifting-lofi", bpm: 92, license: "royalty-free" },
    });
    music.t1 = mc.t1 + 2;
    t = music.t1 + 2;

    // render
    const render = add({ parent: run1.id, name: "render", kind: "stage", t0: t, t1: 0, attributes: { attempt: 1, language } });
    const renderTries = sc.renderFail ? 3 : 1;
    let rt = t + 2;
    for (let a = 1; a <= renderTries; a++) {
      const fail = !!sc.renderFail;
      const rc = add({
        parent: render.id,
        name: "render:ffmpeg:render",
        kind: "render",
        t0: rt,
        t1: rt + (fail ? j(8000, 14000) : j(18_000, 34_000)),
        status: fail ? "error" : "ok",
        error: fail
          ? "RenderError: ffmpeg exited with status 1\n[libx264 @ 0x55d1c] height not divisible by 2 (1080x1921)\nError initializing output stream 0:0 -- Error while opening encoder"
          : null,
        attributes: { renderer: "ffmpeg:render", provider: "ffmpeg:render", aspects: 3, seconds: 34.9, language, attempt: a, preset: "medium" },
      });
      rt = rc.t1 + (fail ? 4000 * a : 2);
      if (fail && a < renderTries) render.events.push({ name: "retry", t: rc.t1 + 1, attributes: { attempt: a + 1, delay_ms: 4000 * a } });
    }
    render.t1 = rt + 2;
    if (sc.renderFail) {
      render.status = "error";
      render.error = "Render failed after 3 attempts: ffmpeg exited with status 1 (height not divisible by 2)";
      failed = true;
    }
    t = render.t1 + 2;

    if (!failed) {
      // qa
      const qa = add({ parent: run1.id, name: "qa", kind: "stage", t0: t, t1: 0, attributes: { attempt: 1 } });
      const q1 = add({
        parent: qa.id,
        name: "qa:checks",
        kind: "qa",
        t0: t + 2,
        t1: t + j(900, 1800),
        attributes: { provider: "local:qa", score: 0.94, passed: true, checks: 9, failed_checks: "" },
      });
      const q2 = llm(qa, "moderate_video", q1.t1 + 2, j(3000, 6000), { safe: true, frames: 12, model: "claude-sonnet-4-5" });
      qa.t1 = q2.t1 + 2;
      t = qa.t1 + 2;

      // approve (pauses)
      const ap1 = add({ parent: run1.id, name: "approve", kind: "stage", t0: t, t1: t + 6, attributes: { gate: "human" } });
      ap1.events.push({ name: "paused", t: t + 5, attributes: { reason: "awaiting_approval" } });
      t = ap1.t1 + 3;
    }
  }
  t = Math.max(t, shotEnd, genShots.t1);
  run1.t1 = t + 2;
  if (failed) {
    run1.status = "error";
    run1.error = sc.renderFail ? "Run moved to dead letter after 3 render attempts" : "Run failed in gen_shot";
  }

  let end: number | null = run1.t1;

  // ------------------------------------------------ run 2 (after the human decision)
  if (!failed && sc.approvalWaitMin !== undefined && sc.status !== "awaiting_approval") {
    let t2 = run1.t1 + sc.approvalWaitMin * MIN + j(0, 40_000);
    const run2 = add({
      parent: null,
      name: "run.execute",
      kind: "run",
      t0: t2,
      t1: 0,
      attributes: { brand_id: brand.id, tier, language, resume: true, attempt: 2 },
    });
    t2 += 3;
    const ap2 = add({
      parent: run2.id,
      name: "approve",
      kind: "stage",
      t0: t2,
      t1: t2 + 12,
      attributes: { gate: "human", decision: sc.reject ? "reject" : "approve", reviewer: "venkatesh.p", waited_s: sc.approvalWaitMin * 60 },
    });
    t2 = ap2.t1 + 3;
    if (!sc.reject) {
      const meta = add({ parent: run2.id, name: "metadata", kind: "stage", t0: t2, t1: 0, attributes: { attempt: 1, language } });
      const mc = llm(meta, "metadata", t2 + 2, j(4200, 7800), { platforms: (sc.platforms ?? ["youtube"]).length });
      meta.t1 = mc.t1 + 3;
      t2 = meta.t1 + 3;
      const pub = add({ parent: run2.id, name: "publish", kind: "stage", t0: t2, t1: 0, attributes: { platforms: (sc.platforms ?? []).join(",") } });
      let pe = t2;
      (sc.platforms ?? ["youtube"]).forEach((p, i) => {
        const fail = sc.publishFail && i === 0;
        const ps = add({
          parent: pub.id,
          name: `publish:${p}`,
          kind: "publish",
          t0: t2 + 3 + i * 4,
          t1: t2 + 3 + i * 4 + j(900, 3200),
          status: fail ? "error" : "ok",
          error: fail ? "PublishError: upload_post 401 Unauthorized — TikTok token expired (reconnect the account)" : null,
          attributes: {
            provider: "fake:publish",
            platform: p,
            attempt: 1,
            scheduled_for: sc.status === "scheduled" ? new Date(now + 5 * 3600_000).toISOString() : null,
            post_id: fail ? null : `${p}_${Math.floor(r() * 1e9).toString(36)}`,
          },
        });
        pe = Math.max(pe, ps.t1);
      });
      pub.t1 = pe + 3;
      if (sc.publishFail) {
        pub.status = "error";
        pub.error = "1 of 1 platform publishes failed";
        run2.status = "error";
        run2.error = "publish failed";
      }
      t2 = pub.t1 + 2;
      const fin = add({ parent: run2.id, name: "finalize", kind: "stage", t0: t2, t1: t2 + j(20, 60), attributes: {} });
      t2 = fin.t1 + 2;
    }
    run2.t1 = t2 + 2;
    end = run2.t1;
  } else if (sc.status === "awaiting_approval") {
    end = null;
  }

  // ------------------------------------------------ live trace: trim to "now"
  let spans: Span[] = drafts.map((d) => toSpan(d, runId));
  if (sc.status === "running" && sc.liveElapsedS !== undefined) {
    const cut = start + sc.liveElapsedS * 1000;
    const shift = now - cut; // align the cut with "now" so it keeps moving
    spans = [];
    for (const d of drafts) {
      if (d.t0 > cut) continue;
      const open = d.t1 > cut || d.kind === "run";
      spans.push(
        toSpan(
          {
            ...d,
            t0: d.t0 + shift,
            t1: open ? NaN : d.t1 + shift,
            events: d.events.filter((e) => e.t <= cut).map((e) => ({ ...e, t: e.t + shift })),
          },
          runId,
        ),
      );
    }
    end = null;
  }
  const endsAt = end ?? now;
  return {
    summary: summarize(runId, brand, title, sc.status, spans.length ? Math.min(...spans.map((s) => +new Date(s.start_at))) : start, end, spans, tier, language),
    spans,
    endsAt,
  };
}

function toSpan(d: Draft, traceId: string): Span {
  const end = isFinite(d.t1) && d.t1 >= d.t0 ? d.t1 : null;
  const events: SpanEvent[] = d.events
    .sort((a, b) => a.t - b.t)
    .map((e) => ({ name: e.name, at: new Date(e.t).toISOString(), attributes: e.attributes }));
  return {
    id: d.id,
    trace_id: traceId,
    parent_id: d.parent,
    name: d.name,
    kind: d.kind,
    status: d.status,
    start_at: new Date(d.t0).toISOString(),
    end_at: end === null ? null : new Date(end).toISOString(),
    duration_ms: end === null ? null : +(end - d.t0).toFixed(1),
    attributes: d.attributes,
    events,
    error: d.error,
  };
}

function summarize(
  runId: string,
  brand: Brand,
  title: string,
  status: string,
  start: number,
  end: number | null,
  spans: Span[],
  tier: string,
  language: string,
): TraceSummary {
  const cost = spans.reduce((a, s) => a + (typeof s.attributes.cost_usd === "number" ? s.attributes.cost_usd : 0), 0);
  const last = spans.reduce((a, s) => Math.max(a, s.end_at ? +new Date(s.end_at) : +new Date(s.start_at)), start);
  const stageMap = new Map<string, number>();
  for (const s of spans) {
    if (s.kind !== "stage" || s.name === "gen_shot") continue;
    const d = (s.end_at ? +new Date(s.end_at) : Date.now()) - +new Date(s.start_at);
    stageMap.set(s.name, (stageMap.get(s.name) ?? 0) + d);
  }
  return {
    trace_id: runId,
    run_id: runId,
    brand_id: brand.id,
    brand_name: brand.name,
    title,
    status,
    started_at: new Date(start).toISOString(),
    ended_at: end ? new Date(end).toISOString() : null,
    duration_ms: spans.length ? +((end ?? Math.max(last, Date.now())) - start).toFixed(1) : null,
    span_count: spans.length,
    error_count: spans.filter((s) => s.status === "error").length,
    cost_total: +cost.toFixed(4),
    language,
    tier,
    stages: [...stageMap].map(([name, duration_ms]) => ({ name, duration_ms })),
  };
}

// ------------------------------------------------------------------ dataset

const LOADED = Date.now();

function dataset(): TraceDetail[] {
  // Rebuild so the live trace advances with the clock.
  const now = Date.now();
  idn = 0;
  const all = SCENARIOS.map((sc, i) => {
    const b = buildTrace(sc, i, sc.status === "running" ? now : LOADED);
    return { trace: b.summary, spans: b.spans };
  });
  return all.sort((a, b) => +new Date(b.trace.started_at) - +new Date(a.trace.started_at));
}

const delay = <T>(v: T, ms = 180): Promise<T> => new Promise((res) => setTimeout(() => res(v), ms));

function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const mockApi = {
  brands: () => delay({ items: BRANDS }),

  traces: (q: TraceQuery) => {
    let items = dataset().map((d) => d.trace);
    if (q.brand_id) items = items.filter((t) => t.brand_id === q.brand_id);
    if (q.status === "error") items = items.filter((t) => t.error_count > 0);
    else if (q.status) items = items.filter((t) => t.status === q.status);
    if (q.q) {
      const needle = q.q.toLowerCase();
      items = items.filter((t) => (t.title ?? "").toLowerCase().includes(needle) || t.run_id.includes(needle));
    }
    return delay({ items: items.slice(0, q.limit ?? 50) });
  },

  trace: (id: string) => {
    const d = dataset().find((x) => x.trace.trace_id === id || x.trace.run_id === id);
    if (!d) return Promise.reject(Object.assign(new Error("trace not found"), { status: 404 }));
    return delay(d, 220);
  },

  stats: (q: StatsQuery): Promise<TraceStats> => {
    const from = new Date(`${q.from}T00:00:00Z`).getTime();
    const to = new Date(`${q.to}T23:59:59Z`).getTime();
    const ds = dataset().filter((d) => {
      const t = +new Date(d.trace.started_at);
      return t >= from && t <= to && (!q.brand_id || d.trace.brand_id === q.brand_id);
    });
    const prov = new Map<string, { kind: SpanKind; durs: number[]; errors: number; cost: number }>();
    const stages = new Map<string, { durs: number[]; errors: number; runs: Set<string> }>();
    for (const d of ds) {
      for (const s of d.spans) {
        const dms = s.duration_ms ?? 0;
        const p = s.attributes.provider;
        if (typeof p === "string" && s.kind !== "stage" && s.kind !== "run") {
          const cur = prov.get(p) ?? { kind: s.kind, durs: [], errors: 0, cost: 0 };
          cur.durs.push(dms);
          if (s.status === "error") cur.errors++;
          prov.set(p, cur);
        }
        for (const e of s.events) {
          if (e.name === "cost" && typeof e.attributes.provider === "string") {
            const cur = prov.get(e.attributes.provider);
            if (cur) cur.cost += Number(e.attributes.usd) || 0;
          }
        }
        if (s.kind === "stage" && s.end_at) {
          const cur = stages.get(s.name) ?? { durs: [], errors: 0, runs: new Set() };
          cur.durs.push(dms);
          cur.runs.add(d.trace.run_id);
          if (s.status === "error") cur.errors++;
          stages.set(s.name, cur);
        }
      }
    }
    const providers: ProviderStat[] = [...prov].map(([name, v]) => ({
      name,
      kind: v.kind,
      calls: v.durs.length,
      errors: v.errors,
      p50_ms: quantile(v.durs, 0.5),
      p95_ms: quantile(v.durs, 0.95),
      avg_ms: v.durs.reduce((a, b) => a + b, 0) / Math.max(1, v.durs.length),
      cost: +v.cost.toFixed(4),
    }));
    providers.sort((a, b) => b.calls - a.calls);
    const stageStats: StageStat[] = [...stages].map(([name, v]) => ({
      name,
      runs: v.runs.size,
      errors: v.errors,
      p50_ms: quantile(v.durs, 0.5),
      p95_ms: quantile(v.durs, 0.95),
    }));
    const days = new Map<string, { runs: number; errors: number; cost: number }>();
    for (let t = from; t <= to; t += DAY) days.set(new Date(t).toISOString().slice(0, 10), { runs: 0, errors: 0, cost: 0 });
    for (const d of ds) {
      const k = d.trace.started_at.slice(0, 10);
      const cur = days.get(k);
      if (!cur) continue;
      cur.runs++;
      if (d.trace.error_count > 0) cur.errors++;
      cur.cost += d.trace.cost_total;
    }
    const throughput = [...days].map(([day, v]) => ({ day, ...v, cost: +v.cost.toFixed(4) }));
    const slowest = ds
      .map((d) => d.trace)
      .filter((t) => t.duration_ms !== null)
      .sort((a, b) => (b.duration_ms ?? 0) - (a.duration_ms ?? 0))
      .slice(0, 8);
    return delay({ providers, stages: stageStats, throughput, slowest }, 260);
  },
};
