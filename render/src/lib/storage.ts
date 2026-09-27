/**
 * Asset store: storage keys (content-addressed paths from the Python side) are
 * read from / written to either a local directory (ASSET_ROOT) or Supabase
 * Storage (SUPABASE_URL + SUPABASE_SERVICE_KEY, bucket STORAGE_BUCKET).
 */
import { createWriteStream, existsSync, openAsBlob } from "node:fs";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

export interface AssetStore {
  readonly name: string;
  /** Returns a local file path holding `key` (downloading into `workDir` if needed). */
  fetch(key: string, workDir: string): Promise<string>;
  /** Stores the local file `file` under `key`. */
  put(file: string, key: string, contentType: string): Promise<void>;
}

const normalizeKey = (key: string): string => key.replace(/^\/+/, "");

export class LocalAssetStore implements AssetStore {
  readonly name: string;
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.name = `local:${this.root}`;
  }

  private resolve(key: string): string {
    const full = path.resolve(this.root, normalizeKey(key));
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error(`storage key escapes asset root: ${key}`);
    }
    return full;
  }

  async fetch(key: string): Promise<string> {
    const full = this.resolve(key);
    if (!existsSync(full)) throw new Error(`asset not found: ${key} (looked in ${full})`);
    return full;
  }

  async put(file: string, key: string): Promise<void> {
    const dest = this.resolve(key);
    await mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.part`;
    await copyFile(file, tmp);
    await rename(tmp, dest);
  }
}

export class SupabaseAssetStore implements AssetStore {
  readonly name: string;

  constructor(
    private readonly baseUrl: string,
    private readonly serviceKey: string,
    private readonly bucket: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.name = `supabase:${bucket}`;
  }

  private objectUrl(key: string): string {
    const encoded = normalizeKey(key).split("/").map(encodeURIComponent).join("/");
    return `${this.baseUrl}/storage/v1/object/${encodeURIComponent(this.bucket)}/${encoded}`;
  }

  private get authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey };
  }

  async fetch(key: string, workDir: string): Promise<string> {
    const res = await fetch(this.objectUrl(key), { headers: this.authHeaders });
    if (!res.ok || !res.body) {
      throw new Error(`storage download failed for ${key}: HTTP ${res.status} ${await res.text().catch(() => "")}`);
    }
    const dest = path.join(workDir, "assets", normalizeKey(key));
    await mkdir(path.dirname(dest), { recursive: true });
    try {
      await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), createWriteStream(dest));
    } catch (err) {
      await rm(dest, { force: true });
      throw err;
    }
    return dest;
  }

  async put(file: string, key: string, contentType: string): Promise<void> {
    const res = await fetch(this.objectUrl(key), {
      method: "POST",
      headers: { ...this.authHeaders, "Content-Type": contentType, "x-upsert": "true", "Cache-Control": "3600" },
      body: await openAsBlob(file),
    });
    if (!res.ok) {
      throw new Error(`storage upload failed for ${key}: HTTP ${res.status} ${await res.text().catch(() => "")}`);
    }
  }
}

/** ASSET_ROOT wins when set; otherwise Supabase if configured; otherwise null. */
export const assetStoreFromEnv = (env: NodeJS.ProcessEnv = process.env): AssetStore | null => {
  if (env.ASSET_ROOT) return new LocalAssetStore(env.ASSET_ROOT);
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    return new SupabaseAssetStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, env.STORAGE_BUCKET || "clipforge");
  }
  return null;
};
