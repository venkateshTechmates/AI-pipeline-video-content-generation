/** Small colour helpers shared by the templates (browser-safe, no deps). */

const parseHex = (hex: string): [number, number, number] | null => {
  const m = hex.trim().replace(/^#/, "");
  const full = m.length === 3 ? m.replace(/./g, (c) => c + c) : m.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const luminance = (hex: string): number => {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Black or white, whichever reads better on `background`. */
export const readableOn = (background: string): string =>
  luminance(background) > 0.4 ? "#000000" : "#FFFFFF";

/** `#RRGGBB` + alpha (0..1) -> rgba(); falls back to the input for non-hex colours. */
export const withAlpha = (color: string, alpha: number): string => {
  const rgb = parseHex(color);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color;
};
