/** Shared quadruped machinery: IK legs driven by a gait, eyes, sound rings. */
import React from "react";
import { travelSpeed } from "../camera";
import { darken } from "../lib/color";
import { blink, mod, type Pt } from "../lib/math";
import { capsule, gaitFoot, ik2 } from "../lib/rig";
import type { CharProps } from "./types";

export type LegDef = {
  /** Hip / shoulder in local coords (ground y = 0). */
  x: number;
  y: number;
  l1: number;
  l2: number;
  w: [number, number, number];
  /** +1 joint points forward (front legs), -1 backward (hind legs). */
  bend: 1 | -1;
  /** Gait phase offset 0..1. */
  phase: number;
  near: boolean;
  /** Neutral foot x offset from the hip. */
  footDx?: number;
};

export type Gait = { period: number; duty: number; lift: number };

export const GAITS = {
  walk: { period: 1.1, duty: 0.62, lift: 34 },
  trot: { period: 0.52, duty: 0.5, lift: 46 },
  run: { period: 0.42, duty: 0.4, lift: 60 },
} satisfies Record<string, Gait>;

/** Phase offsets: lateral walk and diagonal trot. */
export const WALK_PHASE = { lh: 0, lf: 0.25, rh: 0.5, rf: 0.75 };
export const TROT_PHASE = { lh: 0.5, lf: 0, rh: 0, rf: 0.5 };

/** Local-units travel speed for a character drawn at scale s. */
export const localSpeed = (p: CharProps): number => travelSpeed(p.ctx.spec) / Math.max(0.1, p.scale);

/** Returns renderers for far and near legs plus the body bob for this frame. */
export const quadLegs = (
  p: CharProps,
  legs: LegDef[],
  gait: Gait,
  moving: boolean,
  color: string,
  paw: (foot: Pt, knee: Pt, near: boolean, leg: LegDef) => React.ReactNode,
  /** Optional override of the foot target (e.g. mid-air poses). */
  footFn?: (leg: LegDef, foot: Pt, hip: Pt) => Pt,
  bobOverride?: number,
): { far: React.ReactNode; near: React.ReactNode; bob: number; phase: number } => {
  const speed = moving ? localSpeed(p) : 0;
  const phase = moving ? p.t / gait.period : 0;
  const stride = speed * gait.duty * gait.period;
  const bob = bobOverride ?? (moving ? Math.sin(phase * Math.PI * 4) * gait.lift * 0.12 : Math.sin(p.t * 2) * 2);
  const draw = (near: boolean) =>
    legs.filter((l) => l.near === near).map((l, i) => {
      const off = moving ? gaitFoot(phase + l.phase, gait.duty, stride, gait.lift) : ([0, 0] as Pt);
      const hip: Pt = [l.x, l.y + bob];
      const foot0: Pt = [l.x + (l.footDx ?? 0) + off[0], Math.min(0, off[1])];
      const foot = footFn ? footFn(l, foot0, hip) : foot0;
      const { knee, foot: f } = ik2(hip, foot, l.l1, l.l2, l.bend);
      const c = near ? color : darken(color, 0.28);
      return (
        <g key={`${near}${i}`}>
          <path d={capsule(hip, knee, l.w[0], l.w[1])} fill={c} />
          <path d={capsule(knee, f, l.w[1], l.w[2])} fill={c} />
          {paw(f, knee, near, l)}
        </g>
      );
    });
  return { far: draw(false), near: draw(true), bob, phase };
};

/** Almond eye with blink and highlight. */
export const Eye: React.FC<{ x: number; y: number; r: number; t: number; seed: number; iris?: string; look?: number; slit?: boolean }> = ({ x, y, r, t, seed, iris = "#2a1a0c", look = 0.2, slit }) => {
  const o = Math.max(0.08, blink(t, seed));
  return (
    <g transform={`translate(${x},${y}) scale(1,${o})`}>
      <ellipse cx={0} cy={0} rx={r} ry={r * 0.8} fill="#fffaf0" />
      <circle cx={r * look} cy={0} r={r * 0.62} fill={iris} />
      {slit ? <ellipse cx={r * look} cy={0} rx={r * 0.14} ry={r * 0.5} fill="#111" /> : <circle cx={r * look} cy={0} r={r * 0.3} fill="#111" />}
      <circle cx={r * look + r * 0.22} cy={-r * 0.25} r={r * 0.2} fill="#fff" />
    </g>
  );
};

/** Expanding sound-wave arcs (roar / howl / bark) from (x, y) in direction `ang` (radians). */
export const SoundRings: React.FC<{ x: number; y: number; ang: number; t: number; on: number; color?: string; size?: number }> = ({ x, y, ang, t, on, color = "#ffffff", size = 1 }) => {
  if (on <= 0) return null;
  const rings = [];
  for (let i = 0; i < 4; i++) {
    const u = mod(t * 1.8 + i / 4, 1);
    const r = (30 + u * 260) * size;
    const a0 = ang - 0.5, a1 = ang + 0.5;
    rings.push(
      <path
        key={i}
        d={`M${x + Math.cos(a0) * r},${y + Math.sin(a0) * r} A${r},${r} 0 0 1 ${x + Math.cos(a1) * r},${y + Math.sin(a1) * r}`}
        stroke={color}
        strokeWidth={(10 - u * 7) * size}
        fill="none"
        strokeLinecap="round"
        opacity={on * (1 - u) * 0.8}
      />,
    );
  }
  return <g>{rings}</g>;
};
