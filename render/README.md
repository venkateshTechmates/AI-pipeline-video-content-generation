# ClipForge render worker

Remotion (4.x) templates plus a Postgres-backed worker that turns a
`RenderSpec` (see `clipforge/render_spec.py`) into loudness-normalised MP4s,
one per aspect ratio.

```
render_jobs (status=queued, spec=RenderSpec)
   └─ worker claims (FOR UPDATE SKIP LOCKED)
        ├─ resolve assets: storage key → ASSET_ROOT or Supabase Storage → loopback file server
        ├─ Remotion renderMedia per aspect (h264, crf 20, aac)
        ├─ ffmpeg loudnorm I=-16:TP=-1.5:LRA=11
        ├─ upload → ${output_prefix}/9x16.mp4 | 1x1.mp4 | 16x9.mp4
        └─ render_jobs.output = RenderResult, status=done
```

## Layout

| Path | What |
| --- | --- |
| `src/index.ts`, `src/Root.tsx` | Remotion entry; registers `<template>-<aspect>` compositions (`default-9x16`, `bold-16x9`, …). Size, fps and duration come from input props via `calculateMetadata`. |
| `src/templates/Default.tsx` | Clean template: clips, captions, logo top-right, lower-third CTA card. |
| `src/templates/Bold.tsx` | Punchy template: Ken Burns zoom, boxed word highlight, progress bar, logo top-left, full-frame CTA wipe. |
| `src/components/Captions.tsx` | Word-highlight burned-in captions driven by `words` + `caption_style`. |
| `src/types.ts` | TS mirror of `RenderSpec` / `RenderResult` + zod schema (same defaults as Pydantic). |
| `src/worker.ts` | Postgres job loop. |
| `src/cli.ts` | Render a spec file without the DB. |
| `src/lib/*` | Asset store (local/Supabase), loopback file server, render + loudnorm, logging. |

Input props for every composition are `{ spec: RenderSpec, aspect: "9:16" | "1:1" | "16:9" }`;
the worker rewrites every asset path in `spec` to a URL before rendering. An
unknown `spec.template` falls back to `default`.

## Running

```bash
npm install
npm run studio                                  # preview templates with sample props
npm run render:local -- spec.json out/          # render without the DB → out/9x16.mp4 …, out/result.json
DATABASE_URL=postgres://… ASSET_ROOT=/data npm run worker
npm run typecheck
```

`npm run build` pre-bundles the Remotion project into `build/bundle`; the worker
uses it when present and otherwise bundles once at startup.

For `render:local`, storage keys resolve against `ASSET_ROOT`, else Supabase
(if configured), else the directory containing the spec file.

### Docker

```bash
docker build -t clipforge-render render/
docker run --rm -e DATABASE_URL=… -e SUPABASE_URL=… -e SUPABASE_SERVICE_KEY=… clipforge-render
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — (required for worker) | Postgres with the `render_jobs` table. |
| `ASSET_ROOT` | — | Local asset store root. Takes precedence over Supabase. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | — | Supabase Storage for inputs and outputs. |
| `STORAGE_BUCKET` | `clipforge` | Storage bucket. |
| `RENDER_CONCURRENCY` | `1` | Jobs rendered in parallel by one process. |
| `REMOTION_CONCURRENCY` | Remotion default | Browser tabs per render. |
| `POLL_INTERVAL_MS` | `3000` | Idle poll interval. |
| `MAX_ATTEMPTS` | `3` | A job is marked `failed` once `attempts` reaches this. |
| `SHUTDOWN_GRACE_SECONDS` | `30` | After SIGTERM, in-flight renders get this long before they are cancelled and requeued (a second signal cancels immediately). |
| `RENDER_CRF` | `20` | x264 CRF. |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg binary for loudnorm. |
| `REMOTION_BUNDLE` | — | Use an existing serve URL / bundle dir. |
| `REMOTION_BROWSER_EXECUTABLE` | — | Use an existing Chrome / headless shell instead of downloading one. |
| `REMOTION_GL` | Remotion default | Chromium GL backend (`swangle`, `angle`, …). |
| `WORKER_ID` | `hostname:pid` | Prefix for `render_jobs.locked_by`. |
| `LOG_LEVEL` | `info` | `debug` adds render progress. |

## Job semantics

- Claim: `queued` jobs, or `running` jobs whose lock is older than 15 minutes
  (crashed worker). Claiming increments `attempts`. A heartbeat refreshes
  `locked_at` every minute so long renders are not stolen.
- Success: `status='done'`, `output` = `{"outputs":[{aspect,path,width,height,duration}],"renderer":"remotion"}`
  where `path` is the storage key `${output_prefix}/${aspect with ':'→'x'}.mp4`.
- Failure: `error` is set; `status='failed'` once `attempts >= MAX_ATTEMPTS`
  (or immediately for an invalid spec), else back to `queued`.
- Shutdown: SIGTERM stops claiming; interrupted jobs are requeued without
  consuming an attempt.

## Notes

- Brand/caption fonts are loaded from Google Fonts by family name at render
  time; if a family can't be loaded the render continues with a system
  fallback stack.
- Clip audio is muted; sound is the voice-over plus the music bed (looped, gain
  from `music_gain_db`, 1 s fade-out).
- Caption `font_size` is authored for a 1080-wide vertical frame and scaled by
  the frame's short edge.
- Uploads use Supabase's single-request upload endpoint (fine for typical
  short-form output sizes; the project's upload size limit applies).
