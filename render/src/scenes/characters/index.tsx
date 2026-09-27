/** Character registry: component, placement in the frame, shadows and aura anchors. */
import type React from "react";
import type { Ctx } from "../ctx";
import type { Action, CharacterId } from "../parse";
import { generatorX } from "../settings/interior";
import { Dolphin, FishSchool, Whale } from "./aquatic";
import { Bear, Deer, Elephant } from "./big";
import { Eagle, Owl, Penguin } from "./birds";
import { Dog, Fox, Wolf } from "./canines";
import { Cat, Lion } from "./felines";
import { Hero, heroLift } from "./hero";
import { Person, PERSON_REACH } from "./person";
import { Butterfly, Rabbit } from "./small";
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

/** Standard ground placement: centred, extra copies further back, smaller and to the sides. */
export const groundPlace = (s: number, spread = 0.3, xBias = 0.5) => (ctx: Ctx, idx: number, n: number): Placement => {
  // groups: everyone a bit smaller, copies further back; offsets limited so they stay in frame
  const k = Math.pow(0.74, idx) * (n > 1 ? 0.84 : 1);
  const side = idx === 0 ? 0 : idx % 2 === 1 ? -1 : 1;
  const off = Math.min(ctx.VW * spread, 330 * s);
  return {
    x: ctx.VW * xBias + side * off + (n > 1 ? Math.min(ctx.VW * 0.1, 120 * s) : 0),
    y: ctx.groundY - idx * 60,
    s: s * k,
    z: -idx,
    t: idx * 0.37,
  };
};

const airPlace = (s: number, y: number, spreadX = 0.28) => (ctx: Ctx, idx: number): Placement => ({
  x: ctx.VW * (0.5 + (idx === 0 ? 0 : idx % 2 ? -spreadX : spreadX)),
  y: ctx.VH * (y + (idx === 0 ? 0 : idx % 2 ? -0.14 : 0.1)),
  s: s * Math.pow(0.72, idx),
  z: -idx,
  t: idx * 0.61,
});

const heroDef: CharDef = {
  C: Hero,
  kind: "ground",
  place: (ctx, idx, n) => {
    if (ctx.spec.action === "fly") return { x: ctx.VW * 0.5 + (idx ? -ctx.VW * 0.25 : 0), y: ctx.VH * (0.45 + idx * 0.12), s: 1.2 * Math.pow(0.8, idx), z: -idx, t: idx * 0.5 };
    return groundPlace(1.12, 0.28)(ctx, idx, n);
  },
  lift: heroLift,
  shadowW: 110,
  auraY: -300,
  auraR: 280,
};

const personDef: CharDef = {
  C: Person,
  kind: "ground",
  place: (ctx, idx, n) => {
    const s = 1.15;
    if (ctx.spec.setting === "power" && ctx.spec.action === "zap" && idx === 0) return { x: generatorX(ctx) - PERSON_REACH * s + 6, y: ctx.groundY, s, z: 0 };
    return groundPlace(s, 0.26, ctx.spec.action === "gesture" ? 0.42 : 0.5)(ctx, idx, n);
  },
  shadowW: 90,
  auraY: -280,
  auraR: 260,
};

export const CHARACTER_DEFS: Record<CharacterId, CharDef> = {
  hero: heroDef,
  heroine: heroDef,
  person: personDef,
  lion: { C: Lion, kind: "ground", place: groundPlace(0.86, 0.3, 0.52), shadowW: 260, auraY: -250, auraR: 300 },
  cat: { C: Cat, kind: "ground", place: groundPlace(1.15, 0.3), shadowW: 170, auraY: -180, auraR: 200 },
  fox: { C: Fox, kind: "ground", place: groundPlace(1.2, 0.3), shadowW: 200, auraY: -200, auraR: 240 },
  wolf: { C: Wolf, kind: "ground", place: groundPlace(1.15, 0.3), shadowW: 210, auraY: -200, auraR: 250 },
  dog: { C: Dog, kind: "ground", place: groundPlace(1.15, 0.3), shadowW: 200, auraY: -200, auraR: 240 },
  bear: { C: Bear, kind: "ground", place: groundPlace(0.95, 0.3), shadowW: 270, auraY: -250, auraR: 300 },
  elephant: { C: Elephant, kind: "ground", place: groundPlace(0.95, 0.3, 0.46), shadowW: 300, auraY: -300, auraR: 360 },
  deer: { C: Deer, kind: "ground", place: groundPlace(1.05, 0.3), shadowW: 200, auraY: -250, auraR: 260 },
  rabbit: { C: Rabbit, kind: "ground", place: groundPlace(1.25, 0.28), shadowW: 120, auraY: -120, auraR: 180 },
  penguin: { C: Penguin, kind: "ground", place: groundPlace(1.15, 0.26), shadowW: 110, auraY: -200, auraR: 220 },
  owl: {
    C: Owl, kind: "air",
    place: (ctx, idx) => ({ x: ctx.VW * (0.55 - idx * 0.3), y: ctx.VH * (0.66 - idx * 0.2), s: 1.1 * Math.pow(0.75, idx), z: -idx, t: idx * 0.8 }),
    shadowW: 0, auraY: -220, auraR: 220,
  },
  eagle: { C: Eagle, kind: "air", place: airPlace(1.0, 0.42), shadowW: 0, auraY: 0, auraR: 300 },
  butterfly: { C: Butterfly, kind: "air", place: airPlace(0.9, 0.48, 0.3), shadowW: 0, auraY: 0, auraR: 160 },
  whale: {
    C: Whale, kind: "water",
    place: (ctx, idx) => ({
      x: ctx.VW * 0.5 - idx * ctx.VW * 0.2,
      y: ctx.spec.setting === "ocean" ? ctx.groundY - 10 - idx * 40 : ctx.VH * (0.5 - idx * 0.16),
      s: 0.82 * Math.pow(0.6, idx), z: -idx, t: idx * 1.1,
    }),
    shadowW: 0, auraY: 0, auraR: 420,
  },
  fish: { C: FishSchool, kind: "water", place: (ctx) => ({ x: ctx.VW * 0.5, y: ctx.VH * 0.46, s: 1 }), shadowW: 0, auraY: 0, auraR: 400 },
  dolphin: {
    C: Dolphin, kind: "water",
    place: (ctx, idx) => ({
      x: ctx.VW * (0.5 + (idx === 0 ? 0 : idx % 2 ? -0.26 : 0.26)),
      y: ctx.spec.setting === "underwater" ? ctx.VH * (0.5 + (idx % 2 ? -0.15 : idx ? 0.15 : 0)) : ctx.groundY - idx * 30,
      s: 0.9 * Math.pow(0.8, idx), z: -idx, t: idx * 0.77,
    }),
    shadowW: 0, auraY: 0, auraR: 260,
  },
};
