/**
 * Loopback HTTP server that exposes local files to the headless browser.
 * Remotion's <OffthreadVideo>/<Audio>/<Img> need URLs, and the bundle is built
 * once per process, so per-job files can't go into its public dir. Files are
 * registered explicitly (random token per file), nothing else is reachable.
 */
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
};

export const contentTypeFor = (file: string): string =>
  MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

export class LocalFileServer {
  private readonly files = new Map<string, string>();

  private constructor(
    private readonly server: http.Server,
    readonly origin: string,
  ) {}

  static async start(): Promise<LocalFileServer> {
    let self: LocalFileServer | undefined;
    const server = http.createServer((req, res) => {
      self!.handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;
    self = new LocalFileServer(server, `http://127.0.0.1:${port}`);
    return self;
  }

  /** Expose `absPath`; returns its URL and a token for `unregister`. */
  register(absPath: string): { url: string; token: string } {
    const token = randomBytes(12).toString("hex");
    this.files.set(token, absPath);
    return { url: `${this.origin}/${token}/${encodeURIComponent(path.basename(absPath))}`, token };
  }

  unregister(tokens: Iterable<string>): void {
    for (const t of tokens) this.files.delete(t);
  }

  close(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const token = (req.url ?? "").split("/")[1] ?? "";
    const file = this.files.get(token);
    if (!file || (req.method !== "GET" && req.method !== "HEAD")) {
      res.writeHead(404).end();
      return;
    }
    const { size } = await stat(file);
    const headers: http.OutgoingHttpHeaders = {
      "Content-Type": contentTypeFor(file),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    };

    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    let start = 0;
    let end = size - 1;
    if (range) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), size - 1);
      } else if (range[2]) {
        start = Math.max(0, size - Number(range[2]));
      }
      if (start > end || start >= size) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
    } else {
      res.writeHead(200, { ...headers, "Content-Length": size });
    }
    if (req.method === "HEAD" || size === 0) {
      res.end();
      return;
    }
    createReadStream(file, { start, end }).on("error", () => res.destroy()).pipe(res);
  }
}
