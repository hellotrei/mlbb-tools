# App: API (`apps/api`)

## Responsibility

The API service provides read/write endpoints for:

- Hero metadata, latest stats, tier results, and counter recommendations.
- Draft Master: feasibility + analysis + matchup support built on shared scoring logic.
- Tournament management (events, rounds, bracket/standings) and Telegram bot webhook flow.

It is implemented as a Hono app with Node server and Vercel-compatible handlers.

## Entry points

- Main app + routes: `apps/api/src/index.ts`
- Vercel function wrapper: `apps/api/api/index.ts` (delegates to the exported handler)
- Telegram webhook wrapper: `apps/api/api/telegram-webhook.ts`

## Major internal modules

- Cache wrapper (Redis + helpers): `apps/api/src/lib/cache.ts`
- Tournament engines (Liquipedia-backed):
  - `apps/api/src/lib/tournament-engine.ts` (core)
  - `apps/api/src/lib/m7-engine.ts`, `mpl-id-engine.ts`, `mpl-ph-engine.ts` (configuration wrappers)
- Draft/playoffs logic:
  - Playoffs bracket utilities: `apps/api/src/tournaments/playoffs-engine.ts`
- Optional community counters integration: `apps/api/src/lib/supabase-counters.ts`

## Dependencies

- `@mlbb/db` — Postgres schema + query helpers; API reads/writes:
  - hero metadata, latest stats, computed tier/counter artifacts
  - tournament entities (events/teams/rounds/matches/draft logs)
- `@mlbb/shared` — request schemas + scoring/draft utilities (Zod + pure functions)
- Redis — caching layer and shared store used by API and worker (BullMQ queues are owned by worker)

## Route surface (high level)

Health:

- `GET /health`
- `GET /health/full`

Meta and stats:

- `GET /heroes`
- `GET /heroes/:mlid`
- `GET /stats` (query validated by shared Zod schema)
- `GET /tier` (query validated by shared Zod schema)

Draft Master:

- `GET /draft/meta-snapshot`
- `POST /draft/feasibility`
- `POST /draft/analyze`
- `POST /draft/matchup`

Counters:

- `POST /counters` (request validated by shared Zod schema)

Tournaments (created/operated by the web UI + Telegram bot):

- `POST /events`
- `GET /events`
- `GET /events/:id`
- `GET /events/:id/banner`
- `GET /events/:id/bracket`
- `GET /events/:id/standings`
- `GET /events/:id/overview`
- `GET /events/:id/postmatch-intelligence`
- `POST /events/:id/generate-next-round`
- `POST /events/:id/playoff-flow/repair`
- `GET /events/:id/playoff-flow/debug`

Telegram:

- `POST /telegram/webhook` (main webhook receiver)
- `POST /telegram/webhook-probe`, `POST /telegram/body-probe` (debug/support endpoints)

## Notes on caching

- The repo documents two cache layers:
  - L1: in-process Map (short TTL) to avoid Redis round-trips for hot keys.
  - L2: Redis persistent cache.
- Tournament engines may materialize upstream wiki-derived data into Redis to avoid repeatedly scraping/parsing.

