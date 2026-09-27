/**
 * Render procedural animated scenes (the `scene` composition) in one process:
 *
 *   npm run scene -- --jobs jobs.json [--concurrency 4] [--crf 20] [--bundle dir]
 *
 * jobs.json = [{ "prompt", "seed", "durationInSeconds", "width", "height", "out" }, ...]
 *
 * Bundles once (build/bundle when it already contains `scene`, else a
 * content-hashed cache dir), opens the browser once, renders every job
 * (h264, no audio) and prints one JSON line per finished job to stdout:
 *   {"out":"/abs/clip.mp4","ok":true,"ms":12345,"frames":150}
 * Logs go to stderr. Exit code is 1 if any job failed.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, getCompositions, openBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { z } from "zod";
import { sceneSchema } from "./scenes/schema";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENTRY = path.join(ROOT, "src/index.ts");
const PREBUILT = path.join(ROOT, "build/bundle");
const CACHE = path.join(ROOT, "node_modules/.cache/clipforge-scene-bundle");
const BROWSER = process.env.REMOTION_BROWSER_EXECUTABLE || null;

const jobSchema = sceneSchema.extend({ out: z.string().min(1) });
type Job = z.infer<typeof jobSchema>;

const err = (msg: string, extra: Record<string, unknown> = {}) =>
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), msg, ...extra }) + "\n");

const argValue = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq?.slice(name.length + 3);
};

/** Hash of every file that goes into the bundle, so the cache is invalidated on edits. */
const sourceHash = (): string => {
  const h = createHash("sha256");
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(tsx?|json|css)$/.test(name)) h.update(p).update(readFileSync(p));
    }
  };
  walk(path.join(ROOT, "src"));
  h.update(readFileSync(path.join(ROOT, "package.json")));
  return h.digest("hex").slice(0, 16);
};

const hasScene = async (serveUrl: string, puppeteerInstance: Awaited<ReturnType<typeof openBrowser>>): Promise<boolean> => {
  try {
    const comps = await getCompositions(serveUrl, { puppeteerInstance, browserExecutable: BROWSER, logLevel: "error" });
    return comps.some((c) => c.id === "scene");
  } catch {
    return false;
  }
};

const resolveBundle = async (browser: Awaited<ReturnType<typeof openBrowser>>): Promise<string> => {
  const explicit = argValue("bundle") || process.env.REMOTION_BUNDLE;
  if (explicit) return explicit;
  if (existsSync(path.join(PREBUILT, "index.html")) && (await hasScene(PREBUILT, browser))) {
    err("using prebuilt bundle", { dir: PREBUILT });
    return PREBUILT;
  }
  const dir = path.join(CACHE, sourceHash());
  if (existsSync(path.join(dir, "index.html"))) {
    err("using cached bundle", { dir });
    return dir;
  }
  await mkdir(CACHE, { recursive: true });
  const started = Date.now();
  err("bundling", { entry: ENTRY, outDir: dir });
  const url = await bundle({ entryPoint: ENTRY, outDir: dir });
  err("bundle ready", { ms: Date.now() - started });
  return url;
};

const main = async (): Promise<number> => {
  const jobsPath = argValue("jobs");
  if (!jobsPath) {
    process.stderr.write("usage: npm run scene -- --jobs jobs.json [--concurrency N] [--crf 20] [--bundle dir]\n");
    return 2;
  }
  const jobsFile = path.resolve(jobsPath);
  const raw: unknown = JSON.parse(await readFile(jobsFile, "utf8"));
  const jobs: Job[] = z.array(jobSchema).parse(Array.isArray(raw) ? raw : [raw]);
  const concurrency = Number(argValue("concurrency") ?? process.env.REMOTION_CONCURRENCY ?? Math.max(1, Math.min(8, os.cpus().length)));
  const crf = Number(argValue("crf") ?? process.env.RENDER_CRF ?? 20);
  const chromiumOptions = process.env.REMOTION_GL ? { gl: process.env.REMOTION_GL as "swangle" } : {};

  await ensureBrowser({ browserExecutable: BROWSER });
  const browser = await openBrowser("chrome", { browserExecutable: BROWSER, chromiumOptions, logLevel: "error" });
  let failed = 0;
  try {
    const serveUrl = await resolveBundle(browser);
    for (const job of jobs) {
      const { out, ...props } = job;
      const outPath = path.resolve(path.dirname(jobsFile), out);
      const started = Date.now();
      try {
        await mkdir(path.dirname(outPath), { recursive: true });
        const composition = await selectComposition({ serveUrl, id: "scene", inputProps: props, puppeteerInstance: browser, browserExecutable: BROWSER, logLevel: "error" });
        await renderMedia({
          composition,
          serveUrl,
          inputProps: props,
          codec: "h264",
          crf,
          pixelFormat: "yuv420p",
          imageFormat: "jpeg",
          jpegQuality: 88,
          muted: true,
          enforceAudioTrack: false,
          outputLocation: outPath,
          overwrite: true,
          concurrency,
          puppeteerInstance: browser,
          browserExecutable: BROWSER,
          chromiumOptions,
          timeoutInMilliseconds: 120_000,
          logLevel: "error",
        });
        process.stdout.write(JSON.stringify({ out: outPath, ok: true, ms: Date.now() - started, frames: composition.durationInFrames }) + "\n");
      } catch (e) {
        failed++;
        process.stdout.write(JSON.stringify({ out: outPath, ok: false, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) }) + "\n");
      }
    }
  } finally {
    await browser.close({ silent: true });
  }
  return failed ? 1 : 0;
};

main().then(
  (code) => process.exit(code),
  (e) => {
    err("scene render failed", { error: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  },
);
