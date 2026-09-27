/**
 * Turns every asset path in a RenderSpec into a URL the headless browser can
 * load: http(s) URLs pass through, absolute local paths and storage keys are
 * materialised locally and served by the loopback file server.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RenderSpec } from "../types";
import type { LocalFileServer } from "./fileServer";
import type { AssetStore } from "./storage";

export type ResolvedSpec = {
  spec: RenderSpec;
  /** Stop serving this job's files. */
  release: () => void;
};

const isRemote = (p: string) => /^https?:\/\//i.test(p);

export const resolveSpecAssets = async (
  spec: RenderSpec,
  opts: { store: AssetStore | null; server: LocalFileServer; workDir: string },
): Promise<ResolvedSpec> => {
  const tokens: string[] = [];
  const cache = new Map<string, Promise<string>>();

  const toLocal = async (p: string): Promise<string> => {
    if (p.startsWith("file://")) return fileURLToPath(p);
    if (path.isAbsolute(p) && existsSync(p)) return p;
    if (!opts.store) throw new Error(`no asset store configured to resolve storage key: ${p}`);
    return opts.store.fetch(p, opts.workDir);
  };

  const resolve = (p: string): Promise<string> => {
    if (isRemote(p)) return Promise.resolve(p);
    let pending = cache.get(p);
    if (!pending) {
      pending = toLocal(p).then((file) => {
        const { url, token } = opts.server.register(file);
        tokens.push(token);
        return url;
      });
      cache.set(p, pending);
    }
    return pending;
  };
  const resolveOptional = (p: string | null) => (p ? resolve(p) : Promise.resolve(null));

  try {
    const [clips, voice, music, logo] = await Promise.all([
      Promise.all(spec.clips.map(async (c) => ({ ...c, path: await resolve(c.path) }))),
      resolve(spec.audio.voice_path),
      resolveOptional(spec.audio.music_path),
      resolveOptional(spec.brand.logo_path),
    ]);
    return {
      spec: {
        ...spec,
        clips,
        audio: { ...spec.audio, voice_path: voice, music_path: music },
        brand: { ...spec.brand, logo_path: logo },
      },
      release: () => opts.server.unregister(tokens),
    };
  } catch (err) {
    // Let in-flight downloads settle before the caller removes workDir.
    await Promise.allSettled(cache.values());
    opts.server.unregister(tokens);
    throw err;
  }
};
