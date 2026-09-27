/**
 * Render a spec file without the database:
 *   npm run render:local -- spec.json outdir
 *
 * Storage keys resolve against ASSET_ROOT, else Supabase (if configured), else
 * the spec file's directory. Writes `${outdir}/<9x16>.mp4` and `result.json`.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureBrowser } from "@remotion/renderer";
import { resolveSpecAssets } from "./lib/assets";
import { LocalFileServer } from "./lib/fileServer";
import { errorMessage, log } from "./lib/log";
import { BROWSER_EXECUTABLE, getServeUrl, renderSpecToFiles } from "./lib/render";
import { assetStoreFromEnv, LocalAssetStore } from "./lib/storage";
import { parseRenderSpec, type RenderResult } from "./types";

const main = async (): Promise<void> => {
  const [specPath, outArg] = process.argv.slice(2);
  if (!specPath || !outArg) {
    console.error("usage: npm run render:local -- <spec.json> <outdir>");
    process.exit(2);
  }
  const specFile = path.resolve(specPath);
  const outDir = path.resolve(outArg);
  const spec = parseRenderSpec(JSON.parse(await readFile(specFile, "utf8")));
  const store = assetStoreFromEnv() ?? new LocalAssetStore(path.dirname(specFile));

  await mkdir(outDir, { recursive: true });
  const workDir = await mkdtemp(path.join(os.tmpdir(), "clipforge-render-cli-"));
  const server = await LocalFileServer.start();
  try {
    await ensureBrowser({ browserExecutable: BROWSER_EXECUTABLE });
    const serveUrl = await getServeUrl();
    const resolved = await resolveSpecAssets(spec, { store, server, workDir });
    const files = await renderSpecToFiles({ serveUrl, spec: resolved.spec, outDir, logFields: { runId: spec.run_id } });
    const result: RenderResult = {
      outputs: files.map((f) => ({ aspect: f.aspect, path: f.file, width: f.width, height: f.height, duration: f.duration })),
      renderer: "remotion",
    };
    await writeFile(path.join(outDir, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await server.close();
    await rm(workDir, { recursive: true, force: true });
  }
};

main().then(
  () => process.exit(0),
  (err) => {
    log.error("render failed", { error: errorMessage(err) });
    process.exit(1);
  },
);
