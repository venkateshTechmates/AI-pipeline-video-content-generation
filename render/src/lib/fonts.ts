/**
 * Loads Google Fonts by family name at render time (brand fonts are free-form
 * strings in the brand kit, so they can't be statically imported). Rendering
 * waits via delayRender until the faces are ready; unknown families fall back
 * to the system stack instead of failing the render.
 */
import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";

const SYSTEM_FONTS = new Set(["sans-serif", "serif", "monospace", "system-ui", "arial", "helvetica"]);
const WEIGHTS = [400, 700, 800, 900];
const FONT_TIMEOUT_MS = 10_000;

const loaded = new Map<string, Promise<void>>();

const injectStylesheet = (href: string): Promise<boolean> =>
  new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve(true);
    link.onerror = () => {
      link.remove();
      resolve(false);
    };
    document.head.appendChild(link);
  });

const loadFamily = (family: string): Promise<void> => {
  const existing = loaded.get(family);
  if (existing) return existing;
  const task = (async () => {
    const encoded = encodeURIComponent(family).replace(/%20/g, "+");
    const base = "https://fonts.googleapis.com/css2?display=block&family=";
    // Not every family ships every weight; retry with the default weight only.
    const ok =
      (await injectStylesheet(`${base}${encoded}:wght@${WEIGHTS.join(";")}`)) ||
      (await injectStylesheet(`${base}${encoded}`));
    if (!ok) return;
    await Promise.all(WEIGHTS.map((w) => document.fonts.load(`${w} 48px "${family}"`).catch(() => [])));
  })();
  loaded.set(family, task);
  return task;
};

export const fontStack = (family: string): string =>
  `"${family}", "Inter", "Helvetica Neue", Arial, sans-serif`;

export const useFonts = (families: string[]): void => {
  const key = [...new Set(families.filter((f) => f && !SYSTEM_FONTS.has(f.toLowerCase())))].sort().join("|");
  const [handle] = useState(() => delayRender(`Loading fonts: ${key || "none"}`));

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      continueRender(handle);
    };
    const timer = setTimeout(finish, FONT_TIMEOUT_MS);
    const fams = key ? key.split("|") : [];
    Promise.all(fams.map(loadFamily))
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        finish();
      });
    return () => {
      clearTimeout(timer);
      finish();
    };
  }, [key, handle]);
};
