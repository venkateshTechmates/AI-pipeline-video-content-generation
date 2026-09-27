/**
 * Render worker: claims jobs from `render_jobs` (FOR UPDATE SKIP LOCKED),
 * renders every aspect with Remotion, loudness-normalises with ffmpeg,
 * uploads the mp4s and writes a RenderResult into `render_jobs.output`.
 *
 * Env: DATABASE_URL (required), RENDER_CONCURRENCY (1), POLL_INTERVAL_MS (3000),
 * MAX_ATTEMPTS (3), SHUTDOWN_GRACE_SECONDS (30), ASSET_ROOT | SUPABASE_URL +
 * SUPABASE_SERVICE_KEY + STORAGE_BUCKET, plus the render knobs in lib/render.ts.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureBrowser, makeCancelSignal } from "@remotion/renderer";
import pg from "pg";
import { z, ZodError } from "zod";
import { resolveSpecAssets } from "./lib/assets";
import { LocalFileServer } from "./lib/fileServer";
import { errorMessage, log } from "./lib/log";
import { BROWSER_EXECUTABLE, getServeUrl, renderSpecToFiles } from "./lib/render";
import { assetStoreFromEnv, type AssetStore } from "./lib/storage";
import { aspectSlug, parseRenderSpec, type RenderResult } from "./types";

const DATABASE_URL = process.env.DATABASE_URL;
const CONCURRENCY = Math.max(1, Number(process.env.RENDER_CONCURRENCY ?? 1));
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 3000);
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? 3);
const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_SECONDS ?? 30) * 1000;
const HEARTBEAT_MS = 60_000;
const WORKER_ID = process.env.WORKER_ID || `${os.hostname()}:${process.pid}`;

type JobRow = { id: string; run_id: string | null; spec: unknown; attempts: number };

/** Errors that retrying can't fix (bad spec). */
class PermanentError extends Error {}

const CLAIM_SQL = `
update render_jobs
   set status = 'running', locked_by = $1, locked_at = now(), attempts = attempts + 1, updated_at = now()
 where id = (
   select id from render_jobs
    where status = 'queued'
       or (status = 'running' and locked_at < now() - interval '15 minutes')
    order by created_at
    for update skip locked
    limit 1)
returning id, run_id, spec, attempts`;

class Worker {
  private stopping = false;
  private readonly wakers = new Set<() => void>();
  private readonly inFlight = new Map<string, () => void>();

  constructor(
    private readonly pool: pg.Pool,
    private readonly store: AssetStore,
    private readonly server: LocalFileServer,
    private readonly serveUrl: string,
  ) {}

  async run(): Promise<void> {
    await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => this.loop(`${WORKER_ID}:${i}`)));
  }

  /** Stop claiming; after the grace period, cancel in-flight renders and requeue them. */
  stop(immediate: boolean): void {
    if (!this.stopping) log.info("shutting down", { inFlight: this.inFlight.size, graceMs: immediate ? 0 : SHUTDOWN_GRACE_MS });
    this.stopping = true;
    this.wakers.forEach((w) => w());
    const cancelAll = () => this.inFlight.forEach((cancel) => cancel());
    if (immediate) cancelAll();
    else setTimeout(cancelAll, SHUTDOWN_GRACE_MS).unref();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wakers.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      this.wakers.add(done);
    });
  }

  private async loop(lockId: string): Promise<void> {
    while (!this.stopping) {
      let job: JobRow | undefined;
      try {
        job = (await this.pool.query<JobRow>(CLAIM_SQL, [lockId])).rows[0];
      } catch (err) {
        log.error("claim failed", { lockId, error: errorMessage(err) });
        await this.sleep(POLL_INTERVAL_MS * 2);
        continue;
      }
      if (!job) {
        await this.sleep(POLL_INTERVAL_MS);
        continue;
      }
      const ok = await this.process(job, lockId);
      // Back off briefly after a failure so a requeued job isn't retried in a hot loop.
      if (!ok) await this.sleep(POLL_INTERVAL_MS * 2);
    }
  }

  private async process(job: JobRow, lockId: string): Promise<boolean> {
    const fields = { jobId: job.id, runId: job.run_id, attempt: job.attempts, lockId };
    const started = Date.now();
    const { cancelSignal, cancel } = makeCancelSignal();
    const abort = new AbortController();
    let shutdownCancelled = false;
    this.inFlight.set(job.id, () => {
      shutdownCancelled = true;
      cancel();
      abort.abort();
    });
    const heartbeat = setInterval(() => {
      this.pool
        .query("update render_jobs set locked_at = now(), updated_at = now() where id = $1 and locked_by = $2", [job.id, lockId])
        .catch((err) => log.warn("heartbeat failed", { ...fields, error: errorMessage(err) }));
    }, HEARTBEAT_MS);

    let workDir: string | undefined;
    let release: (() => void) | undefined;
    try {
      if (job.attempts > MAX_ATTEMPTS) throw new PermanentError(`exceeded ${MAX_ATTEMPTS} attempts`);
      let spec;
      try {
        spec = parseRenderSpec(job.spec);
      } catch (err) {
        throw new PermanentError(err instanceof ZodError ? `invalid spec: ${z.prettifyError(err)}` : errorMessage(err));
      }
      log.info("job claimed", { ...fields, aspects: spec.aspects, template: spec.template });

      workDir = await mkdtemp(path.join(os.tmpdir(), `clipforge-render-${job.id}-`));
      const resolved = await resolveSpecAssets(spec, { store: this.store, server: this.server, workDir });
      release = resolved.release;

      const files = await renderSpecToFiles({
        serveUrl: this.serveUrl,
        spec: resolved.spec,
        outDir: workDir,
        cancelSignal,
        abortSignal: abort.signal,
        logFields: fields,
      });

      const prefix = spec.output_prefix.replace(/\/+$/, "");
      const outputs: RenderResult["outputs"] = [];
      for (const f of files) {
        const key = `${prefix}/${aspectSlug(f.aspect)}.mp4`;
        await this.store.put(f.file, key, "video/mp4");
        outputs.push({ aspect: f.aspect, path: key, width: f.width, height: f.height, duration: f.duration });
      }
      const result: RenderResult = { outputs, renderer: "remotion" };

      const res = await this.pool.query(
        `update render_jobs set status = 'done', output = $2, error = null, locked_by = null, locked_at = null, updated_at = now()
          where id = $1 and locked_by = $3`,
        [job.id, JSON.stringify(result), lockId],
      );
      if (res.rowCount === 0) log.warn("lost lock before completion; result not recorded", fields);
      else log.info("job done", { ...fields, ms: Date.now() - started, outputs: outputs.map((o) => o.path) });
      return true;
    } catch (err) {
      await this.handleFailure(job, lockId, err, shutdownCancelled, fields);
      return false;
    } finally {
      clearInterval(heartbeat);
      this.inFlight.delete(job.id);
      release?.();
      if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async handleFailure(
    job: JobRow,
    lockId: string,
    err: unknown,
    shutdownCancelled: boolean,
    fields: Record<string, unknown>,
  ): Promise<void> {
    try {
      if (shutdownCancelled) {
        // Interrupted by shutdown, not the job's fault: requeue without burning an attempt.
        await this.pool.query(
          `update render_jobs set status = 'queued', attempts = greatest(attempts - 1, 0), locked_by = null, locked_at = null, updated_at = now()
            where id = $1 and locked_by = $2`,
          [job.id, lockId],
        );
        log.warn("job interrupted by shutdown; requeued", fields);
        return;
      }
      const message = errorMessage(err).slice(0, 4000);
      const permanent = err instanceof PermanentError;
      const res = await this.pool.query<{ status: string }>(
        `update render_jobs
            set status = case when $3 or attempts >= $4 then 'failed' else 'queued' end,
                error = $2, locked_by = null, locked_at = null, updated_at = now()
          where id = $1 and locked_by = $5
        returning status`,
        [job.id, message, permanent, MAX_ATTEMPTS, lockId],
      );
      log.error("job failed", { ...fields, error: message, status: res.rows[0]?.status ?? "lock lost" });
    } catch (dbErr) {
      log.error("could not record job failure", { ...fields, error: errorMessage(dbErr) });
    }
  }
}

const main = async (): Promise<void> => {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
  const store = assetStoreFromEnv();
  if (!store) throw new Error("configure ASSET_ROOT or SUPABASE_URL + SUPABASE_SERVICE_KEY");

  await ensureBrowser({ browserExecutable: BROWSER_EXECUTABLE });
  const serveUrl = await getServeUrl();
  const server = await LocalFileServer.start();
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: CONCURRENCY * 2 + 1 });
  pool.on("error", (err) => log.error("pg pool error", { error: errorMessage(err) }));

  const worker = new Worker(pool, store, server, serveUrl);
  let signals = 0;
  const onSignal = (sig: NodeJS.Signals) => {
    signals += 1;
    log.info("signal received", { signal: sig });
    worker.stop(signals > 1);
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  log.info("worker started", { workerId: WORKER_ID, concurrency: CONCURRENCY, store: store.name });
  await worker.run();
  await Promise.allSettled([pool.end(), server.close()]);
  log.info("worker stopped");
};

main().then(
  () => process.exit(0),
  (err) => {
    log.error("worker crashed", { error: errorMessage(err), stack: err instanceof Error ? err.stack : undefined });
    process.exit(1);
  },
);
