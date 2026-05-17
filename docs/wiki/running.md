# Running & Setup

This page focuses on how to run the repo locally and which environment variables matter for the runtime services.

## Prerequisites

- Docker + Docker Compose v2
- Node.js 22 LTS
- pnpm (via Corepack; repo expects pnpm 10.6.2)

## Local development

Quick start:

```bash
pnpm install
cp .env.example .env
pnpm dev
```

What `pnpm dev` does (`scripts/dev.mjs`):

- Starts Postgres + Redis via `infra/docker-compose.yml`
- Waits for both services to become reachable
- Runs workspace migrations (`pnpm -w db:migrate`)
- Starts `@mlbb/api` and `@mlbb/web` in parallel

Worker runs in a separate terminal:

```bash
pnpm worker:dev
```

## Common scripts (root)

- `pnpm services:start` / `pnpm services:stop` — start/stop local Postgres+Redis only
- `pnpm db:migrate` — apply SQL migrations from `packages/db/migrations`
- `pnpm db:studio` — run Drizzle Studio (package script)
- `pnpm meta:refresh` — refresh local hero meta snapshot (writes into `data/`)

## Environment variables

Local development uses `.env` (see `.env.example` for the full list). Key variables:

- `DATABASE_URL` — Postgres connection string
- `REDIS_URL` — Redis connection string
- `API_PORT`, `WEB_PORT` — local ports
- `CORS_ORIGINS` — API CORS policy
- `VERCEL_API` (+ optional `VERCEL_API_PROXY_TOKEN`) — upstream Liquipedia/MediaWiki API endpoint (direct or via `apps/vercel-api-proxy`)
- `INGEST_CRON`, `ACTIVE_TIMEFRAMES` — worker scheduling and which timeframes to compute
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` — tournament bot webhook flow
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — optional community counters source

## Worker separation (production)

The worker is designed to be independently deployed from the web/api blue-green stack (ADR-001: `docs/architecture-decisions.md`). It still connects to the same Postgres + Redis using `DATABASE_URL` and `REDIS_URL`.

