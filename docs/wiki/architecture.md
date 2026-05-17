# Architecture

## Monorepo model

- Tooling: pnpm workspaces + Turborepo (`pnpm-workspace.yaml`, `turbo.json`).
- Deliverables:
  - `apps/api` — Hono API server (also exports Vercel handlers).
  - `apps/web` — SvelteKit frontend.
  - `apps/worker` — BullMQ background workers + cron scheduling.
  - `apps/vercel-api-proxy` — token-gated, cached/retried upstream API proxy.
- Shared libraries:
  - `packages/db` — Postgres/Drizzle schema + DB client + migrations.
  - `packages/shared` — shared domain contracts, Zod request schemas, scoring functions.
  - `packages/ui` — reusable Svelte components.
  - `packages/config` — shared lint/tsconfig/prettier presets.

## Runtime topology

### Local development

- Postgres + Redis: `infra/docker-compose.yml`.
- API + Web: started together by `pnpm dev` (`scripts/dev.mjs`).
- Worker: runs separately (`pnpm worker:dev`) and connects to the same Postgres/Redis as the API.

### Production (VPS + blue/green)

The intended production layout is described in `README.md` and uses:

- Nginx as public edge (TLS termination, `/` → web, `/api/*` → api).
- Blue/green slots for API and Web containers.
- Shared singleton services: Postgres + Redis.
- Worker is intentionally decoupled (see ADR-001) and can run on a separate host connecting back to Postgres/Redis.

## Data flow (stats → rankings → API)

1. Worker ingests hero stats snapshots and normalizes into “latest” tables in Postgres.
2. Worker computes derived artifacts (tier results, counter matrix, synergy matrix) and writes them to Postgres.
3. API serves these artifacts to the web client and third parties, optionally caching responses in Redis (and an in-process Map).

Key persistence layers:

- Postgres: source of truth (hero metadata, latest stats, computed matrices, tournament entities).
- Redis: BullMQ queues + persistent cache for API + tournament engine materialization.
- API in-process cache: small TTL Map for hot keys (L1 cache).

## Dependency relationships (conceptual)

```text
apps/web  ──────→  apps/api  ──────→  packages/db  ───→ Postgres
                    │   │
                    │   └──────────→ Redis (cache)
                    │
apps/worker ────────┴──────────────→ packages/db  ───→ Postgres
                    │
                    └──────────────→ Redis (BullMQ queues)

apps/vercel-api-proxy  (optional upstream helper for the API tournament engine)
```

## Cross-cutting concerns

- Input validation: API uses Zod + `@hono/zod-validator`; shared schemas live in `packages/shared`.
- DB access: Drizzle queries in API/worker use schema exports from `packages/db`.
- Background scheduling: worker uses `node-cron` and queues follow-up compute jobs via BullMQ.

