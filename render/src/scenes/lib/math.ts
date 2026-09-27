/** Deterministic randomness, smooth noise and easing for the scene engine (no Math.random). */
import { random } from "remotion";

/** 0..1, deterministic for (seed, ...keys). */
export const rnd = (seed: number, ...keys: (string | number)[]): number => random(`${seed}|${keys.join("|")}`);
/** Uniform in [a, b). */
export const rr = (seed: number, a: number, b: number, ...keys: (string | number)[]): number => a + (b - a) * rnd(seed, ...keys);
/** Pick one element deterministically. */
export const pick = <T,>(seed: number, arr: readonly T[], ...keys: (string | number)[]): T =>
  arr[Math.min(arr.length - 1, Math.floor(rnd(seed, "pick", ...keys) * arr.length))] as T;

export const clamp = (v: number, a = 0, b = 1): number => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Map v from [a,b] to [0,1], clamped. */
export const prog = (v: number, a: number, b: number): number => clamp((v - a) / (b - a));
export const smooth = (t: number): number => t * t * (3 - 2 * t);
export const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeIn = (t: number): number => t * t * t;
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const TAU = Math.PI * 2;
export const deg = (r: number): number => (r * 180) / Math.PI;
/** Positive modulo. */
export const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Cheap smooth 1-D noise in [-1, 1]: sum of incommensurate sines, phase-shifted by seed. */
export const wobble = (t: number, seed: number, key: number | string = 0): number => {
  const p = rnd(seed, "wob", key) * 100;
  return (Math.sin(t * 1.0 + p) * 0.5 + Math.sin(t * 2.31 + p * 1.7) * 0.3 + Math.sin(t * 4.13 + p * 2.3) * 0.2);
};

/** Blink envelope: 1 = open, 0 = closed. Blinks every ~2.5-4.5 s, 0.15 s long. */
export const blink = (t: number, seed: number, key: number | string = 0): number => {
  const period = 2.5 + rnd(seed, "blinkp", key) * 2;
  const off = rnd(seed, "blinko", key) * period;
  const local = mod(t + off, period);
  const d = 0.16;
  if (local > d) return 1;
  return Math.abs(local / d - 0.5) * 2; // 1 -> 0 -> 1
};

/** Polyline/polygon helpers. */
export type Pt = [number, number];
export const pts = (p: Pt[]): string => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
/** Smooth closed path through points (Catmull-Rom -> cubic Bezier). */
export const smoothPath = (p: Pt[], closed = true, tension = 1): string => {
  const n = p.length;
  if (n < 2) return "";
  const get = (i: number): Pt => (closed ? p[mod(i, n)]! : p[clamp(i, 0, n - 1)]!);
  let d = `M${p[0]![0].toFixed(1)},${p[0]![1].toFixed(1)}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const c1: Pt = [p1[0] + ((p2[0] - p0[0]) / 6) * tension, p1[1] + ((p2[1] - p0[1]) / 6) * tension];
    const c2: Pt = [p2[0] - ((p3[0] - p1[0]) / 6) * tension, p2[1] - ((p3[1] - p1[1]) / 6) * tension];
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return closed ? d + "Z" : d;
};

/** Jagged electric polyline from a to b; `key` changes the shape (re-roll every few frames). */
export const jagged = (a: Pt, b: Pt, segs: number, amp: number, seed: number, key: string | number): Pt[] => {
  const out: Pt[] = [a];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  for (let i = 1; i < segs; i++) {
    const t = i / segs;
    const off = (rnd(seed, "jag", key, i) - 0.5) * 2 * amp * Math.sin(Math.PI * t);
    out.push([a[0] + dx * t + nx * off, a[1] + dy * t + ny * off]);
  }
  out.push(b);
  return out;
};
