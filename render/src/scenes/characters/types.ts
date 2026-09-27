import type { Ctx } from "../ctx";
import type { Action } from "../parse";

export type CharProps = {
  ctx: Ctx;
  action: Action;
  /** Per-instance seed (varies colours / phase between copies). */
  seed: number;
  /** Instance index when several are drawn. */
  idx: number;
  /** Local time (s), already offset per instance. */
  t: number;
};

/** Where the scene puts a character and how big: feet (or body centre for flyers) at (x, y). */
export type Placement = { x: number; y: number; s: number; flip?: boolean; z?: number; t?: number; opacity?: number };
