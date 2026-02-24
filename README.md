# MLBB Tools Monorepo

TypeScript-only pnpm + Turborepo starter for MLBB analysis tools.

## Apps

- `apps/web` - SvelteKit dashboard
- `apps/api` - Hono BFF API
- `apps/worker` - BullMQ ingestion/compute workers

## Packages

- `packages/shared` - shared contracts, zod schemas, scoring helpers
- `packages/db` - Drizzle schema + migrations + db client
- `packages/ui` - reusable Svelte UI components + theme tokens
- `packages/config` - shared tsconfig/eslint/prettier base

## Prerequisites

- Node.js 20+
- pnpm latest
- Docker

## Setup

1. Copy env file:
   - `cp .env.example .env`
2. Install deps:
   - `pnpm i`
3. Start everything:
   - `pnpm dev`
   - or `pnpm services:start`
4. Stop everything:
   - `pnpm services:stop`

`pnpm dev` automatically:
1. starts Postgres + Redis from `infra/docker-compose.yml`
2. waits for services to become reachable
3. runs DB migrations
4. runs worker + api + web in parallel

## URLs

- web: http://localhost:5173
- api health: http://localhost:8787/health

## Milestone coverage in this starter

- M0: scaffold + one-command local dev
- M1: hero meta import + heroes endpoints + dashboard shell
- M2: stats ingest fallback + stats endpoint + virtualized stats UI
- M3: tier compute + tier endpoint + tier page
- M4: counters endpoint + counter page
- M5: draft analyze endpoint + draft page

## Notes

- Stats ingest now uses GMS `POST /api/gms/source/{sourceId}/{endpoint}` per timeframe endpoint (configurable via `.env`).
- GMS rank `bigrank` is normalized into `rankScope` snapshots; canonical `/stats` data uses priority: `all_rank(101) -> mythic_glory -> mythic_honor -> mythic -> ...`.
- If GMS fetch fails, worker falls back to deterministic mock stats and keeps running.
- Hero metadata import source uses `HERO_META_SOURCE=gms` (GMS only, no file fallback mode).
- Hero import is idempotent via upsert on `mlid`.
- Refresh local metadata snapshot file: `pnpm meta:refresh`.
