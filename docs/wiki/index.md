# MLBB Tools — Code Wiki

This wiki documents the internal architecture of the MLBB Tools monorepo (TypeScript), focusing on module boundaries, runtime responsibilities, and how data flows between services.

## Quick map

```text
            (local dev / production)
┌───────────────────────────────────────────────────────────┐
│ Web (SvelteKit)  ───────→  API (Hono)                     │
│ apps/web                   apps/api                       │
│                         ↙            ↘                    │
│                    Redis (cache + BullMQ)  Postgres        │
│                    infra/docker-compose    packages/db     │
│                         ↑                                   │
│                         │                                   │
│               Worker (BullMQ + cron)                         │
│               apps/worker                                    │
└───────────────────────────────────────────────────────────┘
```

## Pages

- [Architecture](./architecture.md)
- Apps
  - [API](./apps-api.md)
  - [Web](./apps-web.md)
  - [Worker](./apps-worker.md)
  - [Vercel API Proxy](./apps-vercel-api-proxy.md)
- Packages
  - [DB](./packages-db.md)
  - [Shared](./packages-shared.md)
  - [UI](./packages-ui.md)
  - [Config](./packages-config.md)
- Operations
  - [Running & Setup](./running.md)
  - [Infra & Deploy](./infra-deploy.md)

## Repo structure (high level)

```text
apps/
  api/               Hono API + Vercel entrypoints
  web/               SvelteKit UI
  worker/            BullMQ workers + cron scheduler
  vercel-api-proxy/  Liquipedia wikitext proxy with retry/cache headers
packages/
  db/                Drizzle schema + Postgres client + migrations
  shared/            Domain types, Zod schemas, scoring/draft logic
  ui/                Shared Svelte UI components
  config/            Shared tsconfig/eslint/prettier presets
infra/               Local dev services + VPS blue/green + worker host stack
scripts/             Dev orchestration + deploy/rollback helpers
docs/                Operator docs + ADRs
```

