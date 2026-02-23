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
2. Place your hero metadata file at:
   - `data/hero-meta-final.json`
3. Install deps:
   - `pnpm i`
4. Start everything:
   - `pnpm dev`

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

- If GMS env vars are empty, worker falls back to deterministic mock stats and keeps running.
- Hero import is idempotent via upsert on `mlid`.
- Replace the placeholder `data/hero-meta-final.json` with your real dataset.
