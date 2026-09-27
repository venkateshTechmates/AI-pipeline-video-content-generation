/** Camera moves and timed events (lightning strikes, impacts) — all deterministic from the seed. */
import type { Cam } from "./ctx";
import { easeInOut, rnd, rr, wobble } from "./lib/math";
import type { SceneSpec } from "./parse";

/** Lightning strike times (s) for a clip. */
export const strikeTimes = (seed: number, dur: number): number[] => {
  const out: number[] = [];
  let t = rr(seed, 0.35, 0.9, "strike0");
  let i = 0;
  while (t < dur - 0.2) {
    out.push(t);
    t += rr(seed, 1.2, 2.3, "strike", i++);
  }
  return out;
};

/** Flash intensity 0..1 at time t: a bright spike with a second flicker. */
export const flashAt = (t: number, strikes: number[]): number => {
  let f = 0;
  for (const s of strikes) {
    const d = t - s;
    if (d < 0 || d > 0.6) continue;
    const a = Math.exp(-d * 11);
    const b = d > 0.13 ? 0.75 * Math.exp(-(d - 0.13) * 13) : 0;
    f = Math.max(f, a, b);
  }
  return Math.min(1, f);
};

/** Moments something hits hard enough to shake the camera. */
export const impactTimes = (spec: SceneSpec, seed: number, dur: number): { t: number; amp: number }[] => {
  const out: { t: number; amp: number }[] = [];
  if (spec.effects.includes("lightning")) for (const s of strikeTimes(seed, dur)) out.push({ t: s, amp: 9 });
  if (spec.action === "land") out.push({ t: landImpactTime(dur), amp: 26 });
  if (spec.action === "roar") out.push({ t: roarStart(dur) + 0.12, amp: 14 });
  return out;
};
export const landImpactTime = (dur: number): number => Math.min(dur * 0.42, 1.8);
export const roarStart = (dur: number): number => Math.min(dur * 0.28, 1.4);

export const cameraAt = (spec: SceneSpec, seed: number, t: number, dur: number): Cam => {
  const p = easeInOut(Math.min(1, t / dur));
  let zoom = 1, x = 0, y = 0;
  const dir = rnd(seed, "camdir") < 0.5 ? -1 : 1;
  switch (spec.camera) {
    case "push": zoom = 1.02 + 0.13 * p; x = dir * 25 * p; break;
    case "pull": zoom = 1.16 - 0.13 * p; y = -20 * p; break;
    case "pan": zoom = 1.06; x = dir * (-70 + 140 * p); break;
    case "drift": zoom = 1.05 + 0.03 * p; x = wobble(t * 0.5, seed, "cx") * 22; y = wobble(t * 0.45, seed, "cy") * 14; break;
  }
  // handheld float
  x += wobble(t * 0.8, seed, "hx") * 4;
  y += wobble(t * 0.7, seed, "hy") * 4;
  let shakeX = 0, shakeY = 0;
  for (const e of impactTimes(spec, seed, dur)) {
    const d = t - e.t;
    if (d < 0 || d > 0.8) continue;
    const a = e.amp * Math.exp(-d * 6);
    shakeX += a * Math.sin(d * 67 + e.t);
    shakeY += a * 0.8 * Math.sin(d * 53 + e.t * 3);
  }
  return { x, y, zoom, rot: shakeX * 0.03, shakeX, shakeY };
};

/** Treadmill speed (world units / s in the subject plane) for moving subjects. */
export const travelSpeed = (spec: SceneSpec): number => {
  const c = spec.character, a = spec.action;
  if (a === "fly") return c === "hero" || c === "heroine" ? 900 : c === "butterfly" ? 110 : c === "owl" ? 300 : 380;
  if (a === "run") return c === "dog" || c === "fox" || c === "wolf" ? 620 : 520;
  if (a === "walk") return c === "penguin" ? 90 : c === "elephant" || c === "bear" ? 150 : c === "person" ? 190 : 220;
  if (a === "swim") return c === "whale" ? 140 : c === "fish" ? 90 : 260;
  if (a === "jump") return c === "rabbit" ? 260 : c === "dolphin" ? 200 : c === "deer" ? 420 : c === "penguin" ? 0 : 200;
  return 0;
};
