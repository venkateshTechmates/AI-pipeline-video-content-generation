# ClipForge Review UI

Vite + React 18 + TypeScript front-end for the ClipForge approval gate: review
runs awaiting approval, watch renders, inspect QA/cost, and approve,
regenerate a stage, edit the script, or reject.

## Screens

A dark-first operator console (light theme via the sidebar toggle or the OS
setting) with a sidebar (drawer + bottom nav on mobile), a brand switcher that
scopes every page (persisted in `localStorage`), and a live "spent today vs
daily budget" pill.

| Route | What |
| --- | --- |
| `/` | **Review queue** — on wide screens a triage layout: queue rail on the left, the focused run on the right (9:16 phone preview, title/hook, QA score ring + failed-check chips, cost-vs-budget meter, script beats, platforms/schedule, decision bar). Narrow screens get stacked cards. Decisions remove the card optimistically and confirm with a toast; errors put it back. Live via Supabase Realtime, else polls every 10 s. |
| `/runs/:id` | **Run detail** — header (status, tier, brand, age, wall time, platforms, Retry for failed/aborted/dead-letter), cost/QA/publish summary, decision panel while awaiting review, an 11-stage pipeline (live via SSE: status, duration, provider, cost, attempts, errors). Tabs: **Preview** (9:16 / 1:1 / 16:9 players, word-timed caption track synced to the player in the brand's caption style, VO + music license, generated clips), **Script** (beats timeline, VO/caption text, hook candidates with score + dedupe similarity, shot list with clip thumbnails), **QA** (checks table), **Publish** (per-platform metadata cards: thumbnail, char counts vs limits, AI-disclosure badge, post status/links), **Costs** (per-stage breakdown + ledger), **Lineage** (brief → hook → prompts → assets → renders → posts, linked). |
| `/runs` | **Runs** — status-group chips with counts, search, brand filter, auto-refresh (4 s while runs are active). Rows open the detail page. |
| `/runs/new` | **New run** — brand (with tier/budget), brief, tier cards with a 40 s cost estimate vs the run budget, platform toggles, calendar-slot or explicit schedule. |
| `/costs`, `/brands/:id/costs` | **Costs** — KPI tiles (total, runs, avg per run vs the $3 target, avg per day), stacked daily spend (one series per brand in scope; hover tooltips, table view), by provider / stage. Ranges 7/14/30/90 d or custom (UTC days). |
| `/brands`, `/brands/:id` | **Brands** — kit summary: trust score vs auto-approve threshold, budgets, colour swatches, caption-style preview, voice/tone, banned topics, negative prompts, AI-disclosure per platform, weekly posting calendar. |

### Keyboard

`?` opens the shortcut sheet. In the queue: `J`/`K` move, `A` approve, `R`
regenerate (then `1`–`6` picks the stage), `E` edit script, `X` reject with a
note, `O`/`Enter` open the run, `Space` play/pause. Anywhere: `G` then
`Q`/`R`/`N`/`C`/`B` to navigate.

### Screenshots

Taken with Playwright against `clipforge dev` (fake providers). Playwright's
Chromium has no H.264, so the screenshot script served short VP8 transcodes of
the same assets (hence the 0:06 durations in the players).

| | |
| --- | --- |
| ![Review queue](docs/screenshots/queue-desktop.png) | ![Review queue, light](docs/screenshots/queue-desktop-light.png) |
| ![Run detail — preview](docs/screenshots/run-preview-desktop.png) | ![Run detail — script](docs/screenshots/run-script-desktop.png) |
| ![Run detail — QA](docs/screenshots/run-qa-desktop.png) | ![Run detail — publish](docs/screenshots/run-publish-desktop.png) |
| ![Run detail — costs](docs/screenshots/run-costs-desktop.png) | ![Run detail — lineage](docs/screenshots/run-lineage-desktop.png) |
| ![Runs](docs/screenshots/runs-desktop.png) | ![New run](docs/screenshots/new-run-desktop.png) |
| ![Costs](docs/screenshots/costs-desktop.png) | ![Brands](docs/screenshots/brands-desktop.png) |
| ![Shortcut sheet](docs/screenshots/shortcuts-desktop.png) | ![Run detail, light](docs/screenshots/run-preview-desktop-light.png) |

Mobile (390 × 844):

<p>
<img src="docs/screenshots/queue-mobile.png" width="195" alt="Queue on mobile" />
<img src="docs/screenshots/run-preview-mobile.png" width="195" alt="Run detail on mobile" />
<img src="docs/screenshots/runs-mobile.png" width="195" alt="Runs on mobile" />
<img src="docs/screenshots/costs-mobile.png" width="195" alt="Costs on mobile" />
<img src="docs/screenshots/menu-mobile.png" width="195" alt="Navigation drawer on mobile" />
</p>

## Configuration

Copy `.env.example` to `.env`:

| Var | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `/api` | Backend base URL seen by the browser. |
| `API_PROXY_TARGET` | `http://localhost:8000` | Dev-server target for `/api` (prefix stripped). |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | empty | Enable Supabase login (password or magic link), `Authorization: Bearer <jwt>` on API calls, `?token=<jwt>` on the SSE stream, and Realtime queue refresh. Empty = dev mode: no auth, polling. |

## Develop

```bash
cd ui
npm install
npm run dev        # http://localhost:5173, /api -> http://localhost:8000
# demo backend with fake providers + demo runs (from the repo root):
#   ASSET_ROOT=/tmp/uiassets clipforge dev --port 8000 --runs 4
npm run typecheck
npm run build      # outputs dist/
```

## Docker

```bash
docker build -t clipforge-ui \
  --build-arg VITE_SUPABASE_URL=... --build-arg VITE_SUPABASE_ANON_KEY=... ui
docker run -p 8080:80 -e API_UPSTREAM=http://api:8000 clipforge-ui
```

nginx serves the SPA (history fallback) and proxies `/api/*` to
`$API_UPSTREAM` with the `/api` prefix stripped; buffering is off so the SSE
stream (`/runs/{id}/events`) flows through. `VITE_*` values are baked in at
build time.

## API client

`src/api.ts` is a typed client for the FastAPI contract (`/queue`, `/runs`,
`/runs/{id}`, `/runs/{id}/approve`, `/runs/{id}/retry`, `/runs/{id}/events`,
`/brands`, `/brands/{id}`, `/brands/{id}/costs`). Types in `src/types.ts`
mirror `clipforge/models.py` and the view shapes in `clipforge/api/app.py`.

## Code layout

| Path | What |
| --- | --- |
| `src/styles.css` | Design tokens (spacing, radii, type, elevation, semantic + chart colours for dark/light) and all component styles. No UI framework; icons from `lucide-react`, fonts self-hosted via `@fontsource-variable`. |
| `src/state.tsx` | Brand scope (persisted), shared queue (count badge + queue page), spend-today, toasts. |
| `src/components/` | `Shell` (sidebar/topbar/drawer/bottom nav/shortcut sheet), `DecisionBar`, `ScriptEditor`, `ui` primitives (status pill, score ring, cost meter, phone frame, tabs, modal, …), `icons` (platform glyphs, stage metadata). |
| `src/pages/` | One file per screen; run-detail pieces in `pages/run/`. |
