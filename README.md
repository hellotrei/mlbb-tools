# MLBB Tools

TypeScript monorepo for Mobile Legends: Bang Bang analysis tools — hero stats
ingestion, tier rankings, counter/synergy matrices, and a Draft Master
recommendation engine.

---

## Table of contents

1. [Architecture](#architecture)
2. [Repository structure](#repository-structure)
3. [Prerequisites](#prerequisites)
4. [Local development](#local-development)
5. [Environment variables](#environment-variables)
6. [Database operations](#database-operations)
7. [VPS fresh install](#vps-fresh-install)
8. [CI/CD](#cicd)
9. [Scripts reference](#scripts-reference)
10. [Troubleshooting](#troubleshooting)
11. [Draft Master](#draft-master)

---

## Architecture

```
┌────────────────────────────────┐        ┌──────────────────────────────────────┐
│ Vercel                         │        │ VPS (Docker network: mlbb_net)       │
│ ------------------------------ │        │ ------------------------------------ │
│ @mlbb/api (Hono)               │─redis─▶│ mlbb-redis    Redis 7      :6379     │
│ @mlbb/web (SvelteKit)          │──db───▶│ mlbb-postgres PostgreSQL 16 :5432    │
└────────────────────────────────┘        │ mlbb-worker   BullMQ + cron          │
                                          │   reads mlbb-redis                   │
                                          │   reads mlbb-postgres                │
                                          └──────────────────────────────────────┘
```

- **Vercel** hosts the API and Web
- **VPS** hosts PostgreSQL, Redis, and the background worker
- Vercel connects to VPS Redis and PostgreSQL over the public internet
- Worker connects to Redis/PostgreSQL inside `mlbb_net`
- No external Redis (Upstash) or managed database (Supabase) required

**Cache layers:**
- L1: in-process `Map` (30 s TTL) — cuts Redis round-trips for hot keys
- L2: Redis — BullMQ queues + persistent cache

---

## Repository structure

```
mlbb-tools/
├── apps/
│   ├── api/          @mlbb/api     Hono API → Vercel
│   ├── web/          @mlbb/web     SvelteKit → Vercel
│   └── worker/       @mlbb/worker  BullMQ workers → VPS Docker
├── packages/
│   ├── db/           @mlbb/db      Drizzle schema + migrations
│   ├── shared/       @mlbb/shared  Types, Zod schemas, scoring functions
│   └── config/                     Shared tsconfig/eslint/prettier
├── infra/
│   ├── docker-compose.yml          Local dev: Postgres + Redis
│   ├── bluegreen/                  VPS shared services + blue-green slots
│   │   ├── docker-compose.shared.yml   Postgres + Redis (mlbb_net)
│   │   ├── docker-compose.blue.yml     API + Web blue slot (optional)
│   │   ├── docker-compose.green.yml    API + Web green slot (optional)
│   │   ├── Dockerfile.api
│   │   ├── Dockerfile.web
│   │   └── nginx.conf
│   └── worker/                     Worker Docker stack
│       ├── Dockerfile
│       ├── docker-compose.yml      Joins mlbb_net
│       └── .env.example
├── data/
│   └── hero-meta-final.json        Hero metadata snapshot (bundled)
├── .env.example                    Local dev env template
├── .env.production.example         VPS production env template
└── .github/workflows/
    ├── ci.yml                      Lint + typecheck + build
    ├── deploy.yml                  Optional blue-green API/Web deploy workflow
    └── deploy-worker.yml           Build+push worker image → deploy to VPS
```

---

## Prerequisites

### Required versions

| Tool | Minimum | Check |
|------|---------|-------|
| Docker | 24.0+ | `docker --version` |
| Docker Compose | v2.20+ | `docker compose version` |
| Node.js | 22 LTS | local dev only — `node --version` |
| pnpm | 10.6.2 | local dev only — `pnpm --version` |
| Git | 2.x | `git --version` |

### Install if command not found (Ubuntu/Debian)

**Docker + Docker Compose v2:**
```bash
apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

**Git:**
```bash
apt-get update && apt-get install -y git
git --version
```

**Node.js 22 LTS (local dev only):**
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node --version
```

**pnpm (local dev only):**
```bash
corepack enable
corepack prepare pnpm@10.6.2 --activate
pnpm --version
```

---

## Local development

### Quick start

```bash
git clone <repo-url> mlbb-tools && cd mlbb-tools
pnpm install
cp .env.example .env
pnpm dev
```

`pnpm dev` starts Postgres + Redis, runs DB migrations, then starts API and Web in parallel.

| Service | URL |
|---------|-----|
| Web | http://localhost:5173 |
| API health | http://localhost:8787/health |
| API full health | http://localhost:8787/health/full |

### Worker (separate terminal)

```bash
pnpm worker:dev
```

---

## Environment variables

### Local — `.env`

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/mlbb_tools` | Postgres |
| `REDIS_URL` | `redis://localhost:6379` | Redis |
| `API_PORT` | `8787` | API port |
| `WEB_PORT` | `5173` | Web port |
| `CORS_ORIGINS` | `*` | Allowed origins |
| `VERCEL_API` | `https://<upstream-api-domain>/api.php` | Upstream endpoint or proxy URL |
| `VERCEL_API_PROXY_TOKEN` | _(blank)_ | Optional token sent as `x-proxy-token` |
| `WEB_APP_BASE_URL` | `http://localhost:5173` | Base URL used in Telegram event links |
| `TELEGRAM_BOT_TOKEN` | _(blank)_ | Telegram bot token for webhook flow |
| `TELEGRAM_WEBHOOK_SECRET` | _(blank)_ | Secret token validated from Telegram webhook header |
| `INGEST_CRON` | `*/30 * * * *` | Worker schedule |
| `ACTIVE_TIMEFRAMES` | `7d,15d,30d` | Timeframes to compute |
| `GMS_API_KEY` | _(blank)_ | GMS bearer token (optional) |
| `SUPABASE_URL` | _(blank)_ | Community counters (optional) |
| `SUPABASE_ANON_KEY` | _(blank)_ | Community counters (optional) |

---

## Tournament bot notes

- Telegram bot create flow now uses: event name, event date, event mode, round or BO configuration, total teams, then team names.
- `Regular Season` supports `Round Robin`, `Double Round Robin`, `5 Round`, and `Custom Round`.
- `Playoffs` uses separate BO settings for `early rounds`, `semifinal`, and `final`.
- Standing points are `win = 1`, `draw = 0.5`, `loss = 0`, `bye = 1`.
- `Regular Season BO1` supports `Draw (20m+)`.
- `Regular Season` ends in standings with `Top N teams advance to playoffs` (default Top 4, configurable per event).
- `5 Round`, `Custom Round`, and `Playoffs` now use pairing preview before a round is created: admins can choose `Default Match` or `Shuffle Match`, review the pairings, then confirm or reshuffle again.
- The detailed operator guide stays on the web tutorial page at `/tournaments/tutorial`.

### Vercel — API environment variables

Set in Vercel dashboard → Project Settings → Environment Variables:

| Variable | Value | Description |
|----------|-------|-------------|
| `DATABASE_URL` | `postgresql://postgres:<pw>@<VPS_IP>:5432/mlbb_tools` | VPS PostgreSQL |
| `REDIS_URL` | `redis://:<redis-pw>@<VPS_IP>:6379` | VPS Redis (with password) |
| `CORS_ORIGINS` | `https://yourdomain.com` | Your Vercel web domain |
| `VERCEL_API` | `https://<vercel-api-proxy-domain>/api.php` | Vercel API proxy URL |
| `VERCEL_API_PROXY_TOKEN` | Same token as proxy project | Optional auth header for proxy |

### Vercel — API proxy project (new)

Deploy `apps/vercel-api-proxy` as a separate Vercel project.

| Variable | Value | Description |
|----------|-------|-------------|
| `VERCEL_API_PROXY_TOKEN` | strong random string | If set, requires `x-proxy-token` from API |
| `VERCEL_API_UPSTREAM_URL` | `https://<upstream-api-domain>/api.php` | Upstream endpoint (required) |

### Vercel — Web environment variables

| Variable | Value | Description |
|----------|-------|-------------|
| `PUBLIC_API_BASE_URL` | URL of deployed API, e.g. `https://mlbb-api.vercel.app` | Required API origin |
| `PUBLIC_API_PROXY_ENABLED` | `true` or `false` | Optional. When `true`, browser requests go through same-origin `/api/*` proxy on the web app |

Operational notes:

- Leave `PUBLIC_API_PROXY_ENABLED=false` to preserve the current direct web-to-API flow.
- Set `PUBLIC_API_PROXY_ENABLED=true` when you want browser requests to stay on the same web origin first, then be proxied to `PUBLIC_API_BASE_URL`.
- This proxy mode is intended to reduce cross-origin overhead and make request routing more consistent between page loads and interactive actions.

### VPS — `.env.production`

Used by `docker-compose.shared.yml` for Postgres + Redis containers.

| Variable | Description |
|----------|-------------|
| `POSTGRES_USER` | Postgres user (e.g. `postgres`) |
| `POSTGRES_PASSWORD` | Strong password |
| `POSTGRES_DB` | Database name (e.g. `mlbb_tools`) |
| `REDIS_PASSWORD` | Strong password for Redis auth |

### VPS Worker — `/opt/mlbb-worker/infra/worker/.env.worker`

| Variable | Value | Description |
|----------|-------|-------------|
| `DATABASE_URL` | `postgresql://postgres:<pw>@mlbb-postgres:5432/mlbb_tools` | Container name |
| `REDIS_URL` | `redis://:<redis-pw>@mlbb-redis:6379` | Container name + password |
| `INGEST_CRON` | `*/30 * * * *` | Worker schedule |
| `ACTIVE_TIMEFRAMES` | `7d,15d,30d` | Valid: `1d,3d,7d,15d,30d` |
| `GMS_API_KEY` | _(your key)_ | GMS bearer token (optional) |
| `SUPABASE_URL` | _(optional)_ | Community counters |
| `SUPABASE_ANON_KEY` | _(optional)_ | Community counters |

---

## Database operations

```bash
pnpm db:migrate         # run pending migrations (dev)
pnpm db:studio          # open Drizzle Studio
pnpm meta:refresh       # re-fetch hero metadata snapshot

# Generate migration after schema edit
pnpm --filter @mlbb/db db:generate

# Run migrations against remote DB (e.g. VPS)
DATABASE_URL="postgresql://postgres:<pw>@<VPS_IP>:5432/mlbb_tools" pnpm db:migrate
```

### Production migration for tournament tables

If the Telegram bot webhook is active but `/start` still returns `500`, the production database is usually missing the latest tournament tables such as `telegram_sessions`, `tournament_events`, `tournament_rounds`, and `tournament_matches`.

Run the migration from your local machine against the same PostgreSQL database used by the API deployment:

```bash
DATABASE_URL="postgresql://postgres:<pw>@<DB_HOST>:5432/mlbb_tools" pnpm db:migrate
```

Notes:

- `pnpm db:migrate` applies all SQL files in [packages/db/migrations](/Users/treido/Desktop/mlbb-tools/packages/db/migrations).
- DB tooling now auto-loads `/.env`, `/.env.local`, and `/.env.production`, so you can also place the production `DATABASE_URL` in one of those files before running the command.
- For Vercel deployments, use the same `DATABASE_URL` value configured in the API project's environment variables.
- Tournament bot features require migration `0004_tournament_events.sql`.

### Production migration for configurable playoff advance

Migration `0010_tournament_advance_to_playoffs.sql` adds column `advance_to_playoffs` to `tournament_events` with default value `4`.

Apply migration:

```bash
DATABASE_URL="postgresql://postgres:<pw>@<DB_HOST>:5432/mlbb_tools" pnpm db:migrate
```

Verify schema and data:

```bash
psql "postgresql://postgres:<pw>@<DB_HOST>:5432/mlbb_tools" -c "\d+ tournament_events"
psql "postgresql://postgres:<pw>@<DB_HOST>:5432/mlbb_tools" -c "SELECT code, name, total_teams, advance_to_playoffs FROM tournament_events ORDER BY created_at DESC LIMIT 10;"
```

Expected:

- `advance_to_playoffs` exists in `tournament_events`
- Column is `NOT NULL` with default `4`
- Existing events have `advance_to_playoffs = 4` unless updated manually later

---

## VPS fresh install

Execute all steps via SSH. Goal: PostgreSQL + Redis + Worker running on VPS, Vercel API and Web connected.

---

### Step 1 — Install Docker and Git

```bash
# Install Docker
apt-get update
apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER
newgrp docker

# Verify
docker --version          # Docker version 24.x or higher
docker compose version    # Docker Compose version v2.x

# Install Git
apt-get install -y git
git --version
```

---

### Step 2 — Clone repo

```bash
git clone <repo-url> /opt/mlbb-tools
cd /opt/mlbb-tools
```

---

### Step 3 — Configure VPS environment file

```bash
cp /opt/mlbb-tools/.env.production.example /opt/mlbb-tools/.env.production
nano /opt/mlbb-tools/.env.production
```

Set these values (replace placeholders):

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<strong-db-password>
POSTGRES_DB=mlbb_tools
REDIS_PASSWORD=<strong-redis-password>
```

Save and close.

---

### Step 4 — Configure worker environment file

CI/CD copies `infra/worker/docker-compose.yml` to `/opt/mlbb-worker/infra/worker/` on each deploy.
Create the directory and env file now so CI/CD can use them immediately:

```bash
mkdir -p /opt/mlbb-worker/infra/worker
cp /opt/mlbb-tools/infra/worker/.env.example /opt/mlbb-worker/infra/worker/.env.worker
nano /opt/mlbb-worker/infra/worker/.env.worker
```

Set these values:

```env
DATABASE_URL=postgresql://postgres:<strong-db-password>@mlbb-postgres:5432/mlbb_tools
REDIS_URL=redis://:<strong-redis-password>@mlbb-redis:6379
INGEST_CRON=*/30 * * * *
ACTIVE_TIMEFRAMES=7d,15d,30d
GMS_API_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<strong-db-password>
POSTGRES_DB=mlbb_tools
```

> Both `<strong-db-password>` and `<strong-redis-password>` must match what you set in Step 3.

---

### Step 5 — Start PostgreSQL and Redis

`docker-compose.shared.yml` creates the `mlbb_net` Docker network automatically on first run.

```bash
cd /opt/mlbb-tools

docker compose \
  -f infra/bluegreen/docker-compose.shared.yml \
  --env-file .env.production \
  up -d postgres redis
```

Wait ~10 seconds, then verify:

```bash
# PostgreSQL
docker exec mlbb-postgres pg_isready -U postgres -d mlbb_tools
# Expected: /var/run/postgresql:5432 - accepting connections

# Redis
REDIS_PASS=$(grep ^REDIS_PASSWORD /opt/mlbb-tools/.env.production | cut -d= -f2)
docker exec mlbb-redis redis-cli -a "$REDIS_PASS" --no-auth-warning ping
# Expected: PONG

# Check both containers are healthy
docker ps --filter "name=mlbb-postgres" --filter "name=mlbb-redis" \
  --format "table {{.Names}}\t{{.Status}}"
```

---

### Step 6 — Open firewall ports

Vercel connects to VPS over the public internet. Both ports must be reachable.

```bash
# Keep SSH access
ufw allow 22/tcp

# PostgreSQL — accessed by Vercel API
ufw allow 5432/tcp

# Redis — accessed by Vercel API
ufw allow 6379/tcp

# Enable firewall
ufw --force enable
ufw status
```

Expected output:
```
To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       Anywhere
5432/tcp                   ALLOW       Anywhere
6379/tcp                   ALLOW       Anywhere
```

> If your VPS provider has a separate network firewall panel (e.g. Hetzner Firewall, DigitalOcean Firewall), open ports 5432 and 6379 there as well.

---

### Step 7 — Run database migrations

Run from your **dev machine** (Node.js + pnpm required — see [Prerequisites](#prerequisites)).
Port 5432 is now open, so you can connect directly to the VPS:

```bash
# On dev machine
cd /path/to/mlbb-tools
DATABASE_URL="postgresql://postgres:<strong-db-password>@<VPS_IP>:5432/mlbb_tools" pnpm db:migrate
```

Expected output: `All migrations applied` or a list of applied migration files.

**Verify tables were created:**
```bash
# On VPS
docker exec -it mlbb-postgres psql -U postgres -d mlbb_tools -c "\dt"
# Expected: list of tables (heroes, hero_stats_latest, tier_results, etc.)
```

---

### Step 8 — Pull and start worker

The worker image is built and pushed to GHCR by CI/CD (`deploy-worker.yml`). Pull and start it manually for the first time:

```bash
# Login to GHCR (use your GitHub Personal Access Token with read:packages scope)
echo "<GHCR_TOKEN>" | docker login ghcr.io -u <GHCR_USERNAME> --password-stdin

# Copy compose file to worker directory (CI/CD does this automatically on subsequent deploys)
cp /opt/mlbb-tools/infra/worker/docker-compose.yml \
   /opt/mlbb-worker/infra/worker/docker-compose.yml

# Pull latest worker image
export IMAGE_PREFIX=ghcr.io/<github-owner>/mlbb-tools
export IMAGE_TAG=latest
docker pull "$IMAGE_PREFIX/worker:$IMAGE_TAG"

# Start worker
cd /opt/mlbb-worker/infra/worker
IMAGE_PREFIX="ghcr.io/<github-owner>/mlbb-tools" IMAGE_TAG=latest docker compose up -d
```

Verify worker started and can reach Redis and PostgreSQL:

```bash
# Wait ~15 seconds for bootstrap to complete
sleep 15
docker logs mlbb-worker | tail -30
```

Expected: logs showing hero meta import, role pool sync, and ingest jobs being enqueued — no `ECONNREFUSED` or auth errors.

---

### Step 9 — Update Vercel environment variables

Go to **Vercel dashboard → Project (API) → Settings → Environment Variables** and set:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `postgresql://postgres:<strong-db-password>@<VPS_IP>:5432/mlbb_tools` |
| `REDIS_URL` | `redis://:<strong-redis-password>@<VPS_IP>:6379` |
| `CORS_ORIGINS` | Your web domain, e.g. `https://mlbb.yourdomain.com` |
| `VERCEL_API` | `https://<vercel-api-proxy-domain>/api.php` |
| `VERCEL_API_PROXY_TOKEN` | Same token as Vercel API proxy project (optional) |

Then **redeploy** the API project so the new env vars take effect:
```
Vercel dashboard → Deployments → three-dot menu on latest → Redeploy
```

---

### Step 10 — Verify end-to-end

```bash
# 1. API health (DB only)
curl -sf https://<your-api-domain>/health
# Expected: {"ok":true,"service":"api"}

# 2. API full health (DB + Redis)
curl -sf https://<your-api-domain>/health/full
# Expected: {"ok":true,"service":"api","checks":{"db":true,"redis":true}}

# 3. Heroes endpoint (tests DB query + Redis cache)
curl -sf https://<your-api-domain>/heroes | head -c 200
# Expected: {"items":[...]}

# 4. Worker is ingesting data (wait up to 30 min for first ingest cycle)
docker logs mlbb-worker | grep -i "ingest\|tier\|counter"
```

If `/health/full` returns `redis: false`, check [Troubleshooting](#troubleshooting).

---

### Management commands

```bash
# All container statuses
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Worker logs (live)
docker logs -f mlbb-worker

# Redis CLI with auth
REDIS_PASS=$(grep ^REDIS_PASSWORD /opt/mlbb-tools/.env.production | cut -d= -f2)
docker exec -it mlbb-redis redis-cli -a "$REDIS_PASS" --no-auth-warning

# Check mlbb_net members
docker network inspect mlbb_net --format '{{range .Containers}}{{.Name}} {{end}}'

# Restart a single service
docker compose \
  -f /opt/mlbb-tools/infra/bluegreen/docker-compose.shared.yml \
  --env-file /opt/mlbb-tools/.env.production \
  restart redis

# Stop all VPS services
docker compose \
  -f /opt/mlbb-tools/infra/bluegreen/docker-compose.shared.yml \
  --env-file /opt/mlbb-tools/.env.production \
  stop postgres redis
cd /opt/mlbb-worker/infra/worker && docker compose stop

# Pull latest changes and restart worker (manual deploy)
cd /opt/mlbb-tools && git pull
cp infra/worker/docker-compose.yml /opt/mlbb-worker/infra/worker/docker-compose.yml
REDIS_PASS=$(grep ^REDIS_PASSWORD /opt/mlbb-tools/.env.production | cut -d= -f2)
cd /opt/mlbb-worker/infra/worker
IMAGE_PREFIX=ghcr.io/<github-owner>/mlbb-tools IMAGE_TAG=latest docker compose pull
IMAGE_PREFIX=ghcr.io/<github-owner>/mlbb-tools IMAGE_TAG=latest docker compose up -d
docker image prune -f
```

---

## API health endpoints

| Endpoint | Purpose | Used by |
|----------|---------|---------|
| `GET /health` | Liveness — DB check only | Docker healthcheck, load balancer |
| `GET /health/full` | Readiness — DB + Redis | Monitoring, uptime checks |

`/health` returns 200 even if Redis is down. Cache degrades gracefully (L1 still works).

---

## CI/CD

### Workflows

| Workflow | File | Trigger | What it does |
|----------|------|---------|--------------|
| CI | `.github/workflows/ci.yml` | push / PR | lint + typecheck + build |
| Deploy blue-green | `.github/workflows/deploy.yml` | manual (`workflow_dispatch`) | optional API/Web blue-green deploy workflow |
| Deploy worker | `.github/workflows/deploy-worker.yml` | push to `main` (worker/db/shared paths) | build+push worker image to GHCR → SSH deploy to VPS |

Primary production flow in this repository keeps `api` and `web` on Vercel, while the VPS is used for Redis, PostgreSQL, and the worker. The manual blue-green workflow is available only when that deployment mode is explicitly used.

The worker CI/CD:
1. Builds `infra/worker/Dockerfile` and pushes to GHCR as `ghcr.io/<owner>/mlbb-tools/worker:<sha>` and `:latest`
2. SCPs `infra/worker/docker-compose.yml` to `/opt/mlbb-worker/infra/worker/` on VPS
3. SSHes in, pulls new image, runs `docker compose up -d worker`, verifies container is running

### Required GitHub secrets

| Secret | Description |
|--------|-------------|
| `WORKER_HOST` | VPS IP or hostname |
| `WORKER_USER` | SSH user (e.g. `ubuntu` or `root`) |
| `WORKER_SSH_KEY` | Private ed25519 key for `WORKER_USER` |
| `GHCR_USERNAME` | GitHub username |
| `GHCR_TOKEN` | PAT with `read:packages` + `write:packages` scope |

### First-time SSH key setup

```bash
# On dev machine
ssh-keygen -t ed25519 -f ~/.ssh/mlbb_deploy -N "" -C "mlbb-deploy"

# Add public key to VPS
ssh-copy-id -i ~/.ssh/mlbb_deploy.pub <user>@<vps-ip>

# Add private key content to GitHub secret WORKER_SSH_KEY
cat ~/.ssh/mlbb_deploy
```

---

## Scripts reference

| Script | Command | Description |
|--------|---------|-------------|
| Dev (foreground) | `pnpm dev` | Start Postgres+Redis+api+web locally |
| Dev worker | `pnpm worker:dev` | Start worker with hot-reload |
| Background start | `pnpm services:start` | Launch dev stack in background |
| Background stop | `pnpm services:stop` | Stop background dev stack |
| DB migrate | `pnpm db:migrate` | Run pending migrations |
| DB studio | `pnpm db:studio` | Open Drizzle Studio |
| Meta refresh | `pnpm meta:refresh` | Re-fetch hero metadata |
| Build all | `pnpm build` | Compile all packages |
| Lint all | `pnpm lint` | Lint all packages |
| Typecheck all | `pnpm typecheck` | Type-check all packages |
| Deploy checklist | `bash scripts/deploy-checklist.sh` | Post-deploy guardrail for env, containers, Telegram, tournament web, and draft engines |

---

## Deploy checklist

Run this on the VPS after `git pull` and after the relevant deploy step has completed:

```bash
cd /opt/mlbb-tools
bash scripts/deploy-checklist.sh
```

Optional:

```bash
CHECK_TOURNAMENT_CODE=evt-61c5c8a9 bash scripts/deploy-checklist.sh
```

What it checks:
- required production env vars
- Docker compose config for shared, blue, green, and worker stacks
- shared containers, active slot API/Web containers, and worker container
- API `/health` and `/health/full`
- draft engine readiness for `m7`, `mpl-ph`, and `mpl-id`
- community vote cache when Supabase env is configured
- public web root, public API, and tournament detail/bracket route
- Telegram `getMe` and `getWebhookInfo`, including webhook URL mismatch and `last_error_message`

---

## Troubleshooting

### Worker cannot connect to Redis or PostgreSQL

**Symptom:** `ECONNREFUSED` or auth error in worker logs.

```bash
# 1. Verify shared services are running
docker ps --filter "name=mlbb-redis" --filter "name=mlbb-postgres" \
  --format "table {{.Names}}\t{{.Status}}"

# 2. If not running, start them
cd /opt/mlbb-tools
docker compose \
  -f infra/bluegreen/docker-compose.shared.yml \
  --env-file .env.production \
  up -d postgres redis

# 3. Verify mlbb_net members
docker network inspect mlbb_net --format '{{range .Containers}}{{.Name}} {{end}}'
# Expected includes: mlbb-postgres mlbb-redis mlbb-worker

# 4. Restart worker
cd /opt/mlbb-worker/infra/worker && docker compose up -d
```

### Vercel API cannot connect to VPS Redis or PostgreSQL

**Symptom:** `/health/full` returns `redis: false` or DB errors in Vercel logs.

```bash
# 1. Confirm ports are open on VPS
ufw status
# Must show 5432/tcp and 6379/tcp as ALLOW

# 2. Test from outside (on dev machine)
nc -zv <VPS_IP> 6379
nc -zv <VPS_IP> 5432

# 3. Test Redis auth
redis-cli -h <VPS_IP> -p 6379 -a <redis-password> --no-auth-warning ping
# Expected: PONG

# 4. If VPS provider has a cloud firewall, open ports 5432 and 6379 there too
```

### `/health/full` returns `redis: false` but Redis container is running

**Symptom:** Redis is healthy inside VPS but Vercel can't reach it.

Causes:
- Cloud firewall blocking port 6379 (separate from `ufw`)
- Wrong password in Vercel `REDIS_URL`
- `REDIS_URL` still points to Upstash — redeploy after updating env vars

### Worker fails to sync community votes

```bash
docker logs mlbb-worker | grep -i "community\|supabase"
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are optional. If missing, API uses 0.5 flat weight for community voting — this is expected behavior, not an error.

### Redis healthcheck fails after adding password

**Symptom:** `mlbb-redis` container stuck in `starting` or `unhealthy`.

```bash
# Check container logs
docker logs mlbb-redis

# Verify REDIS_PASSWORD is set correctly in .env.production
grep REDIS_PASSWORD /opt/mlbb-tools/.env.production

# Restart Redis with correct env file
cd /opt/mlbb-tools
docker compose \
  -f infra/bluegreen/docker-compose.shared.yml \
  --env-file .env.production \
  up -d redis
```

### Deployment fails with "image not found"

```bash
echo "<GHCR_TOKEN>" | docker login ghcr.io -u "<GHCR_USERNAME>" --password-stdin
docker pull ghcr.io/<owner>/mlbb-tools/worker:latest
```

Verify `GHCR_TOKEN` has `read:packages` scope and the image was pushed by CI/CD.

### ioredis hangs on startup

Already handled in codebase: `retryStrategy: () => null`, `connectTimeout: 3000`, `lazyConnect: true`.
If still hanging, verify the Redis URL format is correct:
```
redis://:<password>@<host>:6379   ← note the colon before password
```

---

## Draft Master

The Draft Master (`/draft`) provides intelligent hero recommendations during
MLBB draft phases, combining tier data, counter matrices, synergy scores, and
community pick data.

### Recommendation channels

- **Recommended Heroes** — balanced score across tier, counters, synergies, and lane
- **Meta Picks** — highest tier/stat power for the current timeframe
- **Counter Picks** — enemy-context driven, blending computed counters with community votes

### Tournament engines

- `community` uses ranked/community stats pipeline
- `m7` uses upstream wiki M7 World Championship pages
- `mpl_ph` uses upstream wiki MPL PH regular-season pages
- `mpl_id` uses upstream wiki MPL ID regular-season pages
- Tournament page/season configuration is centralized in `apps/api/src/lib/tournament-engine-config.ts`

### Configuration

```bash
COUNTERS_BLEND_WEIGHTS=community=55%,counter=25%,tier=20%
COUNTERS_BLEND_SOURCES=community,counter,tier
DRAFT_COUNTER_LANE_SATURATION_PENALTY_MAX=18%
DRAFT_COUNTER_FLEX_EARLY_BONUS=10%
DRAFT_COUNTER_UNCERTAINTY_MAX=35%
DRAFT_COUNTER_COMMUNITY_DAMPING_MIN=45%
DRAFT_COUNTER_COMMUNITY_VOTE_REF=250
DRAFT_COUNTER_DIVERSITY_ROLE_PENALTY=6%
DRAFT_COUNTER_DIVERSITY_ARCHETYPE_PENALTY=4%
DRAFT_COUNTER_DIVERSITY_LANE_PENALTY=5%
DRAFT_COUNTER_DIVERSITY_FLOOR=35%
```

### Data pipeline

```
GMS API (every 30 min via worker)
  └─ heroStatsLatest + heroStatsSnapshots
       └─ tierResults (42 segments per timeframe)
            ├─ counterMatrix (top-40 counters per hero)
            └─ synergyMatrix (top-30 synergies per hero)

POST /draft/analyze
  ├─ tier map + hero stats       (L1 cache → Redis → DB)
  ├─ counter matrix + synergy    (L1 cache → Redis → DB)
  ├─ hero role pool              (L1 cache → Redis → DB)
  └─ community votes             (L1 cache → Redis; fallback: 0.5 flat weight)
       └─ per-hero score → phase weights → Recommended / Meta / Counter picks
```

### Community votes sync

Worker syncs at startup and every hour:
1. Fetches from Supabase `counter_pick_votes` table
2. Stores in Redis key `community:votes` with 3-hour TTL
3. API reads from Redis (L1 → L2); falls back to 0.5 flat weight if missing

Requires `SUPABASE_URL` + `SUPABASE_ANON_KEY` in `.env.worker`. Optional — omitting disables community blend channel.

---

## Notes

- Stats ingest uses GMS `POST /api/gms/source/{sourceId}/{endpoint}` per timeframe.
- `bigrank` from GMS is normalised to `rankScope`; priority: `all_rank → mythic_glory → … → warrior`.
- If GMS fetch fails, worker falls back to deterministic seeded stats and keeps running.
- Hero import is idempotent (upsert on `mlid`).
- `mlbb_net` is created automatically when `docker-compose.shared.yml` starts. Worker and blue/green compose files use `external: true` — start shared services first.
