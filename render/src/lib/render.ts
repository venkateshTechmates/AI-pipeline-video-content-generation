/** Remotion bundling/rendering + ffmpeg loudness normalisation. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { type CancelSignal, renderMedia, selectComposition } from "@remotion/renderer";
import { type Aspect, aspectSlug, compositionId, type CompositionProps, type RenderSpec } from "../types";
import { log } from "./log";

const ENTRY_POINT = fileURLToPath(new URL("../index.ts", import.meta.url));
const PREBUILT_BUNDLE = fileURLToPath(new URL("../../build/bundle", import.meta.url));

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const CRF = Number(process.env.RENDER_CRF ?? 20);
/** Browser tabs per render (Remotion's own concurrency); null lets Remotion decide. */
const REMOTION_CONCURRENCY = process.env.REMOTION_CONCURRENCY ? Number(process.env.REMOTION_CONCURRENCY) : null;
/** Use an existing Chrome / headless shell instead of Remotion's downloaded one. */
export const BROWSER_EXECUTABLE = process.env.REMOTION_BROWSER_EXECUTABLE || null;
export const LOUDNORM_FILTER = "loudnorm=I=-16:TP=-1.5:LRA=11";

/**
 * Serve URL for the Remotion project: REMOTION_BUNDLE, else the prebuilt
 * `npm run build` output, else bundle now (once per process).
 */
export const getServeUrl = async (): Promise<string> => {
  const explicit = process.env.REMOTION_BUNDLE;
  if (explicit) return explicit;
  if (existsSync(path.join(PREBUILT_BUNDLE, "index.html"))) {
    log.info("using prebuilt bundle", { dir: PREBUILT_BUNDLE });
    return PREBUILT_BUNDLE;
  }
  log.info("bundling remotion project", { entry: ENTRY_POINT });
  const started = Date.now();
  const url = await bundle({ entryPoint: ENTRY_POINT });
  log.info("bundle ready", { ms: Date.now() - started });
  return url;
};

export const runFfmpeg = (args: string[], signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ["-hide_banner", "-nostdin", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"], signal });
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${stderr.trim().split("\n").slice(-5).join(" | ")}`)),
    );
  });

/** Normalise integrated loudness to -16 LUFS; video stream is copied untouched. */
export const loudnorm = (input: string, output: string, signal?: AbortSignal): Promise<void> =>
  runFfmpeg(
    ["-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy", "-af", LOUDNORM_FILTER,
     "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", output],
    signal,
  );

export type RenderedFile = { aspect: Aspect; file: string; width: number; height: number; duration: number };

export type RenderOptions = {
  serveUrl: string;
  /** Spec whose asset paths are already browser-loadable URLs. */
  spec: RenderSpec;
  outDir: string;
  cancelSignal?: CancelSignal;
  abortSignal?: AbortSignal;
  logFields?: Record<string, unknown>;
};

/** Renders every aspect of `spec` into `${outDir}/${9x16}.mp4` (loudness-normalised). */
export const renderSpecToFiles = async (opts: RenderOptions): Promise<RenderedFile[]> => {
  const { spec, serveUrl, outDir } = opts;
  const results: RenderedFile[] = [];

  for (const aspect of spec.aspects) {
    const id = compositionId(spec.template, aspect);
    if (!id.startsWith(`${spec.template}-`)) {
      log.warn("unknown template, falling back to default", { ...opts.logFields, template: spec.template });
    }
    const inputProps: CompositionProps = { spec, aspect };
    const composition = await selectComposition({ serveUrl, id, inputProps, browserExecutable: BROWSER_EXECUTABLE, logLevel: "warn" });

    const slug = aspectSlug(aspect);
    const raw = path.join(outDir, `${slug}.raw.mp4`);
    const final = path.join(outDir, `${slug}.mp4`);
    const started = Date.now();
    let lastPct = -1;

    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: "h264",
      audioCodec: "aac",
      crf: CRF,
      pixelFormat: "yuv420p",
      imageFormat: "jpeg",
      jpegQuality: 90,
      outputLocation: raw,
      overwrite: true,
      concurrency: REMOTION_CONCURRENCY,
      browserExecutable: BROWSER_EXECUTABLE,
      cancelSignal: opts.cancelSignal,
      timeoutInMilliseconds: 120_000,
      chromiumOptions: process.env.REMOTION_GL ? { gl: process.env.REMOTION_GL as "swangle" } : {},
      logLevel: "warn",
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 10) * 10;
        if (pct !== lastPct) {
          lastPct = pct;
          log.debug("render progress", { ...opts.logFields, aspect, pct });
        }
      },
    });

    await loudnorm(raw, final, opts.abortSignal);
    await rm(raw, { force: true });

    const duration = Math.round((composition.durationInFrames / composition.fps) * 1000) / 1000;
    log.info("rendered aspect", { ...opts.logFields, aspect, ms: Date.now() - started, duration });
    results.push({ aspect, file: final, width: composition.width, height: composition.height, duration });
  }
  return results;
};
