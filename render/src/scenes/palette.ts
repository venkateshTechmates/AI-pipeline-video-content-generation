/** Time-of-day / weather lighting: sky colours, sun/moon, haze, character light tint, rim light. */
import { mix, multiply } from "./lib/color";
import type { SettingId, TimeOfDay, Weather } from "./parse";

export type Palette = {
  skyTop: string;
  skyMid: string;
  skyLow: string;
  /** Colour distant layers fade into (atmospheric perspective). */
  haze: string;
  /** Multiplied into character / prop colours. */
  ambient: string;
  /** Rim light colour (edge highlight on the light side). */
  rim: string;
  rimAlpha: number;
  /** -1 light from the left, 1 from the right. */
  lightSide: -1 | 1;
  shadow: string;
  cloud: string;
  cloudShade: string;
  /** Sun or moon. `y` is a fraction of the frame height. */
  orb: { x: number; y: number; r: number; color: string; glow: string; moon: boolean } | null;
  night: boolean;
  stars: number;
  /** Warm light for windows/lamps. */
  lamp: string;
};

const BASE: Record<TimeOfDay, Palette> = {
  day: {
    skyTop: "#3d8fe0", skyMid: "#7cc0f2", skyLow: "#cfeeff", haze: "#b9dcf2", ambient: "#ffffff",
    rim: "#fffbe8", rimAlpha: 0.75, lightSide: -1, shadow: "#1d3557", cloud: "#ffffff", cloudShade: "#c9def0",
    orb: { x: 0.2, y: 0.14, r: 60, color: "#fffbe0", glow: "#fff4b8", moon: false }, night: false, stars: 0, lamp: "#ffd98a",
  },
  sunrise: {
    skyTop: "#3b4d8f", skyMid: "#e98a86", skyLow: "#ffd29a", haze: "#f3b39a", ambient: "#ffe3cf",
    rim: "#ffd08a", rimAlpha: 0.9, lightSide: 1, shadow: "#3b2150", cloud: "#ffc7a8", cloudShade: "#b9739a",
    orb: { x: 0.72, y: 0.6, r: 85, color: "#fff1c2", glow: "#ffb46b", moon: false }, night: false, stars: 0, lamp: "#ffd98a",
  },
  sunset: {
    skyTop: "#2c2c6e", skyMid: "#c4506d", skyLow: "#ffab5c", haze: "#e98a6a", ambient: "#ffc9a3",
    rim: "#ffb35c", rimAlpha: 0.95, lightSide: -1, shadow: "#2a1036", cloud: "#ff9f86", cloudShade: "#7c3a6e",
    orb: { x: 0.3, y: 0.62, r: 95, color: "#ffe29a", glow: "#ff8a3d", moon: false }, night: false, stars: 0, lamp: "#ffcf7a",
  },
  night: {
    skyTop: "#070b24", skyMid: "#15204d", skyLow: "#2e3f78", haze: "#2a3868", ambient: "#8e9ad0",
    rim: "#a9c6ff", rimAlpha: 0.7, lightSide: 1, shadow: "#02040f", cloud: "#34416f", cloudShade: "#1a2248",
    orb: { x: 0.74, y: 0.15, r: 55, color: "#f4f1dc", glow: "#9fb4ff", moon: true }, night: true, stars: 140, lamp: "#ffcf6b",
  },
};

export const makePalette = (time: TimeOfDay, weather: Weather, setting: SettingId): Palette => {
  let p: Palette = { ...BASE[time], orb: BASE[time].orb ? { ...BASE[time].orb! } : null };
  if (weather === "storm") {
    p = {
      ...p,
      skyTop: time === "night" ? "#05070f" : "#2b3140", skyMid: time === "night" ? "#141a2c" : "#4a5263", skyLow: time === "night" ? "#2a3148" : "#707a8a",
      haze: time === "night" ? "#232b42" : "#5c6577", ambient: time === "night" ? "#7a86ad" : "#a9b1c2",
      rim: "#bcd4ff", rimAlpha: 0.55, cloud: time === "night" ? "#262d45" : "#565e70", cloudShade: time === "night" ? "#0d1120" : "#343a48",
      orb: null, stars: 0,
    };
  } else if (weather === "rain" || weather === "fog") {
    p = {
      ...p,
      skyTop: mix(p.skyTop, "#6b7686", 0.55), skyMid: mix(p.skyMid, "#8a94a3", 0.55), skyLow: mix(p.skyLow, "#b5bcc6", 0.5),
      haze: mix(p.haze, "#a8b0bb", weather === "fog" ? 0.6 : 0.4), ambient: mix(p.ambient, "#c5cbd4", 0.4),
      cloud: mix(p.cloud, "#9aa3b0", 0.5), cloudShade: mix(p.cloudShade, "#5d6572", 0.5), stars: Math.round(p.stars * 0.2),
      orb: p.orb && weather === "fog" ? { ...p.orb, glow: mix(p.orb.glow, "#ffffff", 0.5) } : null,
    };
  } else if (weather === "snow") {
    p = { ...p, skyMid: mix(p.skyMid, "#c9d6e6", 0.35), skyLow: mix(p.skyLow, "#eef3fa", 0.5), haze: mix(p.haze, "#e3ebf5", 0.45), ambient: mix(p.ambient, "#eaf1ff", 0.3) };
  }
  if (setting === "space") {
    p = { ...p, skyTop: "#03020c", skyMid: "#0b0a24", skyLow: "#1b1240", haze: "#1b1240", ambient: "#b4b8e0", rim: "#9ad0ff", orb: null, stars: 260 };
  }
  if (setting === "underwater") {
    p = {
      ...p, skyTop: "#43c1e0", skyMid: "#137aa8", skyLow: "#06294f", haze: "#0e5f8c", ambient: "#8fd0e8",
      rim: "#b8f4ff", rimAlpha: 0.7, lightSide: -1, orb: null, stars: 0, night: false,
    };
  }
  if (setting === "hospital" || setting === "lab") {
    p = { ...p, haze: "#cfe3ea", ambient: "#f4fbff", rim: "#ffffff", rimAlpha: 0.55, orb: null, stars: 0, night: false, lightSide: -1 };
  }
  if (setting === "power") {
    p = { ...p, haze: "#1c2638", ambient: time === "day" ? "#d7dde8" : "#9aa6c8", rim: "#9fe3ff", rimAlpha: 0.8, orb: null, stars: 0, lightSide: 1 };
  }
  return p;
};

/** Tint a character/prop colour by the scene light. */
export const litBy = (p: Palette) => (c: string, flash = 0): string => {
  // Subjects keep some of their own colour so they stay readable in dim scenes.
  const base = mix(multiply(c, p.ambient), c, p.night ? 0.28 : 0.2);
  return flash > 0 ? mix(base, mix(c, "#eef4ff", 0.35), flash) : base;
};
