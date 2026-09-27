/** Per-frame scene context passed to settings, characters and effects. */
import type { Palette } from "./palette";
import type { SceneSpec } from "./parse";

export type Cam = { x: number; y: number; zoom: number; rot: number; shakeX: number; shakeY: number };

export type Ctx = {
  frame: number;
  fps: number;
  /** Seconds since start. */
  t: number;
  /** Clip length in seconds. */
  dur: number;
  /** Virtual canvas: VH is always 1600 units; VW follows the aspect ratio. */
  VW: number;
  VH: number;
  seed: number;
  spec: SceneSpec;
  pal: Palette;
  /** Tint a colour by scene light (+ lightning flash). */
  lit: (c: string) => string;
  /** Lightning flash intensity 0..1. */
  flash: number;
  /** Horizon / ground line in world units. */
  groundY: number;
  /** World units travelled (treadmill scrolling for moving subjects). */
  scroll: number;
  cam: Cam;
  /** Unique id prefix for SVG defs. */
  uid: string;
};
