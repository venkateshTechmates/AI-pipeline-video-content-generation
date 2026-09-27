/** Hex colour maths for palettes and lighting (browser-safe). */
type RGB = [number, number, number];

const parse = (hex: string): RGB => {
  const m = hex.replace("#", "");
  const f = m.length === 3 ? m.replace(/./g, (c) => c + c) : m;
  const n = parseInt(f.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = ([r, g, b]: RGB): string =>
  "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");

/** Linear mix a→b by t. */
export const mix = (a: string, b: string, t: number): string => {
  const x = parse(a), y = parse(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
};
export const lighten = (c: string, t: number): string => mix(c, "#ffffff", t);
export const darken = (c: string, t: number): string => mix(c, "#000000", t);
/** Multiply blend (tinting by light colour). */
export const multiply = (c: string, light: string): string => {
  const x = parse(c), y = parse(light);
  return toHex([(x[0] * y[0]) / 255, (x[1] * y[1]) / 255, (x[2] * y[2]) / 255]);
};
export const rgba = (c: string, a: number): string => {
  const [r, g, b] = parse(c);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
};
