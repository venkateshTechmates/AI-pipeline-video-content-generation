/** Character registry: component, placement in the frame, shadows and aura anchors. */
import type React from "react";
import type { Ctx } from "../ctx";
import type { Action, CharacterId } from "../parse";
import { Dog, Fox, Wolf } from "./canines";
import { Cat, Lion } from "./felines";
import { Hero, heroLift } from "./hero";
import type { CharProps, Placement } from "./types";

export type CharDef = {
  C: React.FC<CharProps>;
  kind: "ground" | "air" | "water";
  place: (ctx: Ctx, idx: number, n: number) => Placement;
  lift?: (p: { action: Action; t: number; dur: number; idx: number }) => number;
  shadowW: number;
  auraY?: number;
  auraR?: number;
  rim?: number;
};

/** Standard ground placement: centred, extra copies further back and smaller. */
export const groundPlace = (s: number, spread = 0.3, xBias = 0.5) => (ctx: Ctx, idx: number, n: number): Placement => {
  const back = idx; // 0 = front
  const k = Math.pow(0.78, back);
  const side = idx === 0 ? 0 : idx % 2 === 1 ? -1 : 1;
  return {
    x: ctx.VW * xBias + side * ctx.VW * spread * (n > 1 ? 1 : 0) + (idx === 0 && n > 1 ? ctx.VW * 0.05 : 0),
    y: ctx.groundY - back * 70,
    s: s * k,
    z: -back,
    t: idx * 0.37,
  };
};

const heroDef: CharDef = {
  C: Hero,
  kind: "ground",
  place: (ctx, idx, n) => {
    const fly = ctx.spec.action === "fly";
    if (fly) return { x: ctx.VW * 0.5 + (idx ? -ctx.VW * 0.25 : 0), y: ctx.VH * (0.42 + idx * 0.12), s: 0.95 * Math.pow(0.8, idx), z: -idx, t: idx * 0.5 };
    const p = groundPlace(1.12, 0.28)(ctx, idx, n);
    return p;
  },
  lift: heroLift,
  shadowW: 110,
  auraY: -300,
  auraR: 280,
};

export const CHARACTER_DEFS: Record<CharacterId, CharDef> = {
  hero: heroDef,
  heroine: heroDef,
  person: heroDef,
  lion: { C: Lion, kind: "ground", place: groundPlace(0.86, 0.3, 0.52), shadowW: 260, auraY: -250, auraR: 300 },
  fox: { C: Fox, kind: "ground", place: groundPlace(1.05, 0.3), shadowW: 200, auraY: -200, auraR: 240 },
  owl: heroDef,
  eagle: heroDef,
  wolf: { C: Wolf, kind: "ground", place: groundPlace(1.1, 0.3), shadowW: 210, auraY: -200, auraR: 250 },
  cat: { C: Cat, kind: "ground", place: groundPlace(1.1, 0.3), shadowW: 170, auraY: -180, auraR: 200 },
  dog: { C: Dog, kind: "ground", place: groundPlace(1.05, 0.3), shadowW: 200, auraY: -200, auraR: 240 },
  rabbit: heroDef,
  bear: heroDef,
  elephant: heroDef,
  whale: heroDef,
  fish: heroDef,
  dolphin: heroDef,
  penguin: heroDef,
  butterfly: heroDef,
  deer: heroDef,
};
