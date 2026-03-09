# Worker Deployment Guide

The worker is a standalone Node.js service responsible for all background data
processing: ingesting hero stats from the GMS API, computing tier rankings,
counter matrices, and synergy matrices on a configurable cron schedule.

It runs on a **separate host** from the web and API services (which live on the
main VPS behind the blue-green Nginx stack).

---

## Architecture overview

```
┌─────────────────────────────────┐     ┌──────────────────────────────────┐
│  Main VPS (blue-green)          │     │  Worker Host                     │
│  ─────────────────────          │     │  ─────────────                   │
│  nginx (reverse proxy)          │     │  mlbb-worker container           │
│  mlbb-api-blue / green          │     │    └─ node dist/index.js         │
│  mlbb-web-blue / green          │     │         ├─ BullMQ workers (×4)   │
│  postgres (shared DB)  ◄────────┼─────┤         ├─ node-cron scheduler   │
│  redis (shared cache)  ◄────────┼─────┘         └─ GMS API client        │
└─────────────────────────────────┘
```

The worker shares the **same Postgres database and Redis instance** as the API.
It never serves HTTP traffic.

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Docker + Docker Compose v2 | Must be installed on the worker host |
| Reachable Postgres endpoint | Same DB as the API (`DATABASE_URL`) |
| Reachable Redis endpoint | Same Redis as the API (`REDIS_URL`) |
| `data/hero-meta-final.json` | Bundled in the Docker image at `/app/data/` |

---

## First-time setup on the worker host

```bash
# 1. Create the deployment directory
mkdir -p /opt/mlbb-worker/infra/worker
cd /opt/mlbb-worker/infra/worker

# 2. Create the env file from the example
cp .env.example .env.worker
# Edit .env.worker and fill in DATABASE_URL, REDIS_URL, and any GMS credentials

# 3. Log in to GHCR so Docker can pull the image
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
```

---

## Environment variables

Copy `infra/worker/.env.example` to `infra/worker/.env.worker` on the worker
host and fill in the values.

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DATABASE_URL` | — | **Yes** | Full Postgres connection string |
| `REDIS_URL` | `redis://localhost:6379` | **Yes** | BullMQ/Redis connection |
| `INGEST_CRON` | `*/30 * * * *` | No | Cron expression for ingest cycle |
| `ACTIVE_TIMEFRAMES` | `7d,15d,30d` | No | Comma-separated timeframes to process |
| `GMS_SOURCE_BASE_URL` | _(baked in)_ | No | GMS API base URL |
| `GMS_SOURCE_ID` | `2669606` | No | GMS source identifier |
| `GMS_API_KEY` | _(none)_ | No | Bearer token; leave blank if endpoint is public |
| `GMS_LANG` | `en` | No | Language header sent to GMS API |
| `GMS_STATS_PAGE_SIZE` | `500` | No | Pagination page size (1–500) |
| `POSTGRES_USER` | `postgres` | No | Used by the `@mlbb/db` connection pool |
| `POSTGRES_PASSWORD` | — | No | |
| `POSTGRES_DB` | `mlbb_tools` | No | |

---

## Build and start

### Manual (one-off)

```bash
# From the monorepo root
pnpm --filter @mlbb/worker build        # compile TypeScript → dist/
pnpm --filter @mlbb/worker start        # run node dist/index.js
```

### Docker (production)

```bash
# Build the image
docker build -f infra/worker/Dockerfile -t mlbb-worker:local .

# Run with the env file
cd infra/worker
docker compose up -d
```

### CI/CD (automated)

Push to `main` with any change under `apps/worker/`, `packages/db/`,
`packages/shared/`, `infra/worker/`, or `data/` — the
`.github/workflows/deploy-worker.yml` workflow will:

1. Build and push `ghcr.io/<owner>/mlbb-tools/worker:<sha>` + `:latest`
2. SSH into the worker host, pull the new image, and restart the container

**Required GitHub secrets** (in addition to the existing main-VPS secrets):

| Secret | Description |
|--------|-------------|
| `WORKER_HOST` | IP or hostname of the worker host |
| `WORKER_USER` | SSH user on the worker host |
| `WORKER_SSH_KEY` | Private SSH key for `WORKER_USER` |
| `GHCR_USERNAME` | GitHub username for GHCR pull |
| `GHCR_TOKEN` | Personal access token with `read:packages` scope |

---

## Processing pipeline

The worker runs this pipeline on every cron tick (`INGEST_CRON`):

```
Bootstrap (once at startup):
  importHeroMeta()      → populates heroes table from GMS API
  syncHeroRolePool()    → computes lane confidence scores per hero
  cleanupCounterHistory() → deletes counterPickHistory older than 30 days

Every INGEST_CRON tick (default: every 30 min):
  For each ACTIVE_TIMEFRAME:
    ingest-gms job      → fetches win/pick/ban rates → heroStatsLatest + heroStatsSnapshots
    compute-tier job    → 42 tier segments per timeframe → tierResults
    compute-counters job → top-40 counters per hero → counterMatrix
    compute-synergies job → top-30 synergies per hero → synergyMatrix
```

All four BullMQ workers run with **concurrency 1** (strictly serial per queue).

---

## Graceful shutdown

The worker handles `SIGTERM` and `SIGINT` via the `shutdown()` helper in
`apps/worker/src/index.ts`. It closes all four BullMQ workers and queues in
parallel before exiting with code 0.

Docker sends `SIGTERM` when the container stops (`docker compose down` or a
rolling redeploy). The worker will finish any in-progress job before exiting —
no data will be partially written.

```bash
# Safe stop (waits for in-progress jobs to complete)
docker compose -f infra/worker/docker-compose.yml down

# Force stop (not recommended; may leave a job partially run)
docker compose -f infra/worker/docker-compose.yml kill
```

---

## Monitoring and logging

Logs are written to stdout/stderr and captured by Docker's `json-file` driver
(max 50 MB × 5 files, see `docker-compose.yml`).

```bash
# Tail live logs
docker logs -f mlbb-worker

# View last 100 lines
docker logs --tail 100 mlbb-worker
```

**What to watch for:**

| Log pattern | Meaning |
|-------------|---------|
| `[worker] job failed: <queue> <jobId>` | A job failed; BullMQ retains last 100 failures |
| `[dev] Timed out waiting for ...` | Startup readiness probe timed out (infra issue) |
| `importHeroMeta failed` | GMS API unreachable at startup; worker will exit(1) |
| `Invalid cron expression` | `INGEST_CRON` env var is malformed; worker will exit(1) |

Failed jobs are kept in Redis (`removeOnFail: 100`). Inspect them with a
BullMQ dashboard (e.g. Bull Board) connected to the same Redis instance.

---

## Local development

Run the worker independently while `pnpm dev` runs api + web:

```bash
# Terminal 1 — infra + api + web
pnpm dev

# Terminal 2 — worker only (hot-reload)
pnpm worker:dev
```

The worker reads `../../.env` relative to `apps/worker/`, which resolves to the
monorepo-root `.env` file — the same file used by the rest of the dev stack.
