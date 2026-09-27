# ClipForge Review UI

Vite + React 18 + TypeScript front-end for the ClipForge approval gate: review
runs awaiting approval, watch renders, inspect QA/cost, and approve,
regenerate a stage, edit the script, or reject.

## Screens

| Route | What |
| --- | --- |
| `/` | **Queue** — runs awaiting approval: 9:16 preview, brand, title/hook, QA score + failed checks, cost vs budget, Approve / Regenerate (stage) / Edit script / Reject (note). Focus a card and press `A` approve, `R` regenerate, `E` edit, `J`/`K` next/prev. Live via Supabase Realtime, else polls every 10 s. |
| `/runs/:id` | **Run detail** — stage timeline (live via SSE), renders per aspect, script beats/VO/captions, hook candidates, shot list, QA table, per-platform metadata (AI disclosure flag), posts, cost ledger, assets, decision + script editor. |
| `/runs` | **Runs** list with status / brand filters. |
| `/runs/new` | **New run** — brand, brief, tier, schedule, platforms. |
| `/costs`, `/brands/:id/costs` | **Costs** — date range, totals, by provider / stage, daily SVG bar chart vs daily budget. |

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
`/runs/{id}`, `/runs/{id}/approve`, `/runs/{id}/events`, `/brands`,
`/brands/{id}/costs`). Types in `src/types.ts` mirror `clipforge/models.py`.
