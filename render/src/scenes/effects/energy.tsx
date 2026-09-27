/** Electric arcs, spark showers and energy glows (usable inside character coordinate systems). */
import React from "react";
import { jagged, pts, rnd, rr, TAU, type Pt } from "../lib/math";
import { Glow } from "../lib/svg";

/** A crackling arc from a to b that re-rolls its shape every `hold` frames. */
export const Arc: React.FC<{
  a: Pt; b: Pt; frame: number; seed: number; k: string | number; color?: string; width?: number; amp?: number; segs?: number; hold?: number; branches?: number; opacity?: number;
}> = ({ a, b, frame, seed, k, color = "#8fe3ff", width = 5, amp, segs = 9, hold = 2, branches = 2, opacity = 1 }) => {
  const slot = Math.floor(frame / hold);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const main = jagged(a, b, segs, amp ?? len * 0.16, seed, `${k}-${slot}`);
  const br: Pt[][] = [];
  for (let i = 0; i < branches; i++) {
    const from = main[1 + Math.floor(rnd(seed, "brf", k, slot, i) * (main.length - 2))]!;
    const ang = rnd(seed, "bra", k, slot, i) * TAU;
    const bl = len * rr(seed, 0.15, 0.4, "brl", k, slot, i);
    br.push(jagged(from, [from[0] + Math.cos(ang) * bl, from[1] + Math.sin(ang) * bl], 4, bl * 0.25, seed, `b${k}-${slot}-${i}`));
  }
  const flick = 0.75 + 0.25 * rnd(seed, "fl", k, frame);
  const all = [main, ...br];
  return (
    <g opacity={opacity * flick} strokeLinecap="round" strokeLinejoin="round" fill="none">
      {all.map((p, i) => <polyline key={`g${i}`} points={pts(p)} stroke={color} strokeWidth={width * (i ? 2.2 : 3.6)} opacity={0.25} />)}
      {all.map((p, i) => <polyline key={`m${i}`} points={pts(p)} stroke={color} strokeWidth={width * (i ? 0.8 : 1.3)} />)}
      <polyline points={pts(main)} stroke="#ffffff" strokeWidth={width * 0.5} />
    </g>
  );
};

/** Short-lived hot sparks spraying from a point (deterministic particles). */
export const Sparks: React.FC<{
  x: number; y: number; t: number; seed: number; k: string | number; rate?: number; speed?: number; spread?: number; dir?: number; gravity?: number; life?: number; color?: string; size?: number;
}> = ({ x, y, t, seed, k, rate = 30, speed = 520, spread = Math.PI * 0.9, dir = -Math.PI / 2, gravity = 900, life = 0.55, color = "#ffd36b", size = 1 }) => {
  const out = [];
  const first = Math.floor((t - life) * rate);
  const last = Math.floor(t * rate);
  for (let i = Math.max(first, -1000); i <= last; i++) {
    const te = i / rate + rnd(seed, "spt", k, i) / rate;
    const age = t - te;
    if (age < 0 || age > life * rr(seed, 0.5, 1, "spl", k, i)) continue;
    const ang = dir + (rnd(seed, "spa", k, i) - 0.5) * spread;
    const v = speed * rr(seed, 0.4, 1.1, "spv", k, i);
    const vx = Math.cos(ang) * v, vy = Math.sin(ang) * v;
    const px = x + vx * age, py = y + vy * age + 0.5 * gravity * age * age;
    const tvx = vx, tvy = vy + gravity * age;
    const tl = 0.035;
    const fade = 1 - age / life;
    out.push(
      <line key={i} x1={px} y1={py} x2={px - tvx * tl} y2={py - tvy * tl} stroke={i % 3 === 0 ? "#ffffff" : color} strokeWidth={3.2 * size * fade + 0.8} strokeLinecap="round" opacity={Math.min(1, fade * 1.6)} />,
    );
  }
  return <g>{out}</g>;
};

/** Pulsing ball of energy (hands, emblems). */
export const EnergyBall: React.FC<{ x: number; y: number; r: number; t: number; color?: string; k?: number }> = ({ x, y, r, t, color = "#8fe3ff", k = 0 }) => {
  const p = 1 + 0.18 * Math.sin(t * 9 + k) + 0.08 * Math.sin(t * 23 + k * 2);
  return (
    <g>
      <Glow cx={x} cy={y} r={r * 4.2 * p} color={color} opacity={0.55} />
      <Glow cx={x} cy={y} r={r * 1.9 * p} color={color} opacity={0.9} />
      <circle cx={x} cy={y} r={r * 0.62 * p} fill="#ffffff" opacity={0.95} />
    </g>
  );
};
