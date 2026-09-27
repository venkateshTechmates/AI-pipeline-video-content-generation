# ClipForge

A self-owned, provider-agnostic pipeline that turns a brief into a finished 9:16 short-form video
(plus 1:1 and 16:9) and publishes it on a schedule. It posts to YouTube Shorts, Instagram Reels,
TikTok, Facebook Reels, LinkedIn, X, Threads, Pinterest, Bluesky and Reddit. Platforms are set per brand
in the review UI. It has a human approval gate, per-run cost caps and full lineage.

**Stack:** FastAPI · LangGraph (Postgres checkpointer) · Pydantic AI (Claude) · Supabase ·
ffmpeg / Remotion · React review UI.

```
brief ─▶ 1 ideate ─▶ 2 script+shots ─▶ 3 tts ─▶ 4 gen_shots (parallel) ─▶ 5 music ─▶ 6 render ×3 aspects
                                                                                        │
  11 metrics @24h/7d ◀─ 10 publish ◀─ 9 metadata ◀─ 8 approve ⏸ ◀─ 7 qa ◀─────────────────┘
                                                        │ regenerate(stage) / edit(script) / reject
```

## Quick start (no API keys)

`PROVIDER_MODE=fake` swaps every provider for deterministic offline fakes that still produce real
media through ffmpeg. The full graph runs end to end: ideation, captions, QA, approval and publishing.

```bash
pip install -e ".[dev]"          # needs ffmpeg on PATH
clipforge dev --runs 3           # API + embedded worker on :8000, demo brand + 3 runs
cd ui && npm install && npm run dev   # review UI on :5173 (proxies /api -> :8000)
```

For a nicer offline demo, set `DEMO_VIDEO_STYLE=gradients` (or `cosmic`) for animated backgrounds.
Set `TTS_PROVIDER=espeak` for a real spoken voice through the local `espeak-ng` engine. Both are
stand-ins for Kling video and ElevenLabs voice when you have no keys.

Other entry points:

```bash
clipforge run --brief "sleep better tonight" --approve   # one run in-process (M1 path), prints mp4 paths
docker compose up --build                                 # postgres + api + worker + render + ui (fake mode)
```

## Going live

1. `cp .env.example .env` and set `PROVIDER_MODE=live`. You need at least:
   - an LLM key: `ANTHROPIC_API_KEY`
   - a video key: `FAL_KEY`
   - a voice key: `ELEVENLABS_API_KEY`
   - a publisher key: `UPLOAD_POST_API_KEY`
2. Create a Supabase project and run both migrations in `supabase/migrations/`:
   - `0001_core.sql` is portable Postgres.
   - `0002_supabase.sql` adds RLS, pgsodium token encryption, Realtime, the Storage bucket and pg_cron schedules.

   Set `app.api_url` and `app.cron_secret` as described in that file.
3. Set `PUBLIC_API_URL` to a URL that fal and Replicate can reach, so their webhooks arrive. Set
   `ENV=prod` to enforce webhook signatures and the cron secret.
4. Deploy `api`, `worker` (scale horizontally) and, with `RENDERER=remotion`, `render/` workers.
5. Add brands with `POST /brands` (brand kit, tier, budgets, calendar, publisher). Per-brand publisher
   profile keys go through `POST /brands/{id}/credentials` and are stored encrypted.

## Platforms

| Platform | Default on | Needs in the brand kit | AI label | Video |
|---|---|---|---|---|
| YouTube Shorts, Instagram Reels, TikTok | ✓ | none | always (platform policy) | 9:16 |
| Facebook Reels | ✓ | `page_id` (Upload-Post only) | always (platform policy) | 9:16 |
| LinkedIn | ✓ | none | per brand (UI toggle) | 1:1 |
| X | ✓ | none | per brand (UI toggle) | 9:16 |
| Threads | opt-in | none | always (platform policy) | 9:16 |
| Pinterest | opt-in | `board_id` | per brand (UI toggle) | 9:16 |
| Bluesky | opt-in | none | per brand (UI toggle) | 9:16 |
| Reddit | opt-in | `subreddit` | per brand (UI toggle) | 9:16 |

Turn platforms on and fill in their account details on the **Brands** page, in the Platforms & publishing
editor, or with `PATCH /brands/{id}`. Title and description length and hashtag count are fitted to each
platform's limits, and posts past a platform's daily cap roll to the next calendar slot. If a platform is on
but missing a required field, the run records a failed post with the reason and still publishes everywhere
else. Connect the social accounts themselves in Upload-Post or Ayrshare.

## Architecture

| Layer | Default | Fallbacks | Code |
|---|---|---|---|
| Video (economy) | Kling 3.0 via fal queue + webhooks | Seedance → Hailuo → Replicate Kling → Veo Lite | `providers/fal.py`, `replicate.py` |
| Video (premium) | Veo 3.1 (Gemini API or Vertex) | Veo Fast → Kling | `providers/veo.py` |
| Script / metadata / moderation | Claude via Pydantic AI (structured output + validators) | OpenAI (`FallbackModel`) | `agents/llm.py` |
| TTS | ElevenLabs with word timestamps | OpenAI TTS (estimated timings) | `providers/tts.py` |
| Music | Licensed library (`manifest.json` with license IDs) | Epidemic Sound API | `providers/music.py` |
| Render | ffmpeg in-process, or Remotion workers (`render_jobs`, SKIP LOCKED) | Creatomate overflow | `providers/render.py`, `render/` |
| Publish / metrics | Upload-Post | Ayrshare (per-brand Profile-Key) | `providers/publish.py` |

The graph talks only to the protocols in `providers/base.py`. No provider-specific state is
checkpointed, so changing a provider never touches the graph. Tier chains are built in
`providers/registry.py`.

**Orchestration.** The API only writes rows. It creates a run with status `queued`, or with approval
it stores the decision and sets `resume_requested`. Workers claim runs with
`FOR UPDATE SKIP LOCKED` and drive the LangGraph graph with `thread_id = run_id` on the Postgres
checkpointer. Any worker can therefore resume any run, including across processes; this is tested
in `tests/test_postgres.py`. The approval gate uses `interrupt()`, and resuming passes
`Command(resume=decision)`.

**Long-running generation.** Jobs are submitted with a webhook URL. `/webhooks/fal` and
`/webhooks/replicate` wake the waiting coroutine. If no webhook arrives, the worker polls every
20 s and gives up after 10 min (`providers/jobs.py`). Webhooks are signature-checked and processed
only once.

**Idempotency and cost.**
- **Content-addressed outputs:** clips are keyed on prompt, duration, reference frame, tier and
  regenerate nonce. Renders are keyed on the full render spec. Re-runs and edits reuse outputs
  instead of paying again, and the budget check counts only uncached clips.
- **Ledger:** every provider call writes a `cost_ledger` row.
- **Budget checks:** before generating, `ensure_budget` compares the estimate with the run's budget
  and the brand's daily cap.
  - If a premium run won't fit, it is downgraded to economy and its timeline re-planned for Kling.
  - If it still won't fit, the run is aborted.
  - Alerts fire at 80 % of a budget.
- **Billing-aware timeline** (`timeline.py`): Kling bills 5 s or 10 s clips and Veo bills 4/6/8 s,
  so screen time is shifted between shots. A clip can be slowed by up to 1.25x or trimmed. A 34 s
  video bills 30 s on Kling instead of 40 s (about $2.52 against the $3 target).

**Reliability.**
- **Retries:** jittered exponential backoff, 1 try + 2 retries per provider, then the next provider
  in the chain.
- **Failure handling:** a failed run is re-queued by `/cron/recover` and resumes from its checkpoint.
  After `MAX_RUN_ATTEMPTS` it goes to the dead-letter queue and an alert fires.
- **Rate limits:** per-provider token buckets and per-platform daily posting caps. Posts beyond a cap
  roll to the next calendar slot.

**QA** (`qa.py`):
- duration 28–62 s
- 1080×1920 at 30 fps, H.264
- loudness −16 ±1.5 LUFS
- caption sync drift under 150 ms
- no black segments of 0.5 s or more, no freezes of 2 s or more
- moderation of the script and prompts, plus 6 sampled frames reviewed by a vision LLM

**Auto-approve:** a run skips the human gate when the brand has at least N consecutive human
approvals and the QA score is at least 0.9 with no blocking failure. Regenerating, editing or
rejecting resets the streak.

**Compliance.**
- **AI-content disclosure:** set per platform, following each platform's rules and the brand's policy.
- **Music licensing:** only licensed music is used, and each track's license ID is stored with its asset.
- **Moderation:** prompts and outputs are both checked.
- **Lineage:** brief → hook → prompts → assets → renders → posts → metrics. It's recorded in
  `assets`, `stages`, `posts` and `post_metrics`.

## API (FastAPI)

| Method | Path | Purpose |
|---|---|---|
| POST | `/runs` | `{brand_id, brief?, tier?, schedule?, platforms?, budget?}` → `{run_id}` |
| GET | `/runs`, `/runs/{id}` | list; state, stages, assets (with URLs), ledger, posts |
| GET | `/runs/{id}/events` | SSE: stage / status / cost updates |
| POST | `/runs/{id}/approve` | `{decision: approve\|regenerate\|edit\|reject, stage?, patch?, note?}` |
| POST | `/runs/{id}/retry` | re-queue a failed, aborted or dead-lettered run |
| GET | `/queue` | runs awaiting approval (scoped to the caller's brands) |
| GET/POST | `/brands`, `/brands/{id}`, `/brands/{id}/credentials` | brand kits, encrypted publisher keys (GET shows only whether a key is set) |
| PATCH | `/brands/{id}` | partial update: `kit.platforms`, `kit.platform_options`, disclosure, publisher, budgets, calendar |
| GET | `/brands/{id}/costs?from&to` | ledger report by provider / stage / day |
| POST | `/webhooks/fal`, `/webhooks/replicate`, `/webhooks/publisher` | provider callbacks (signature-verified) |
| POST | `/cron/{calendar,metrics,refresh-tokens,recover}` | pg_cron targets (`x-cron-secret`) |

**Auth:** Supabase JWTs (HS256, `SUPABASE_JWT_SECRET`). Callers see only the brands of orgs
they belong to. `API_TOKEN` is a service token for automation and the MCP server.

## MCP

`clipforge mcp` runs an MCP server over stdio. Its tools are `create_run`, `get_run`,
`approve_run`, `list_queue` and `list_brands`, and it acts as a thin client of the API
(`CLIPFORGE_API_URL`, `CLIPFORGE_API_TOKEN`):

```bash
claude mcp add clipforge -e CLIPFORGE_API_URL=https://api.example.com -e CLIPFORGE_API_TOKEN=... -- clipforge mcp
```

## Observability

With `OTEL_EXPORTER_OTLP_ENDPOINT` and/or `LANGFUSE_*` set (and the `.[otel]` extra installed),
you get:
- a span per run and per stage, tagged with run and brand IDs
- Pydantic AI prompt, output and token traces in Langfuse
- FastAPI request traces

Stage durations and costs are also in the `stages` and `cost_ledger` tables for Grafana dashboards.

## Repository layout

```
clipforge/        Python: models, graph (nodes/builder/state), providers, agents, API, orchestrator, ops, MCP, CLI
render/           Remotion templates + render worker (Node 22)
ui/               React review UI (Vite)
supabase/         SQL migrations
tests/            unit, API, end-to-end pipeline (fake providers), Postgres integration
```

## Tests

```bash
pytest -q                                   # 43 tests; pipeline tests need ffmpeg (~5 min); Postgres tests need the env var below
CLIPFORGE_TEST_DATABASE_URL=postgresql://... pytest tests/test_postgres.py
ruff check clipforge tests
```

To check the Python ↔ Remotion contract, run the Node worker from `render/` against the same database
and asset root. Then run a fake-mode pipeline with `RENDERER=remotion`: the graph enqueues `render_jobs`,
the worker renders all three aspects, and QA runs on the Remotion output.

The end-to-end tests cover:
- approve → publish to 5 platforms → metrics at +24 h
- regenerate music, edit the script, reject
- auto-approve after trust is earned
- budget abort, and premium → economy downgrade
- provider fallback
- crash, then resume from the checkpoint without paying for clips again
- calendar scheduling
- banned-topic blocking

## Status and limits

- **Live adapters:** Kling, Seedance, Hailuo, Veo, Replicate, ElevenLabs, OpenAI TTS, Epidemic,
  Creatomate, Upload-Post and Ayrshare are written against each provider's public API.
  - They have not been run against the real services, since that needs keys and paid calls.
  - Model IDs and endpoints are configuration (for example `FAL_MODEL_KLING_3_0`) because
    providers rename them.
  - Check the Upload-Post and Ayrshare field names and the Epidemic endpoints against your account's
    API version before launch.
- **Tokens:** platform OAuth tokens live in the publisher aggregator. `/cron/refresh-tokens` alerts
  operators before per-brand profile keys expire; it does not refresh them itself.
- **Out of scope (v2, per the PRD):** long-form video, avatars, dubbing, and feeding metrics back into
  ideation (metrics are already collected into `post_metrics`).
