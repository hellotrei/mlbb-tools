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
7. [Production deployment — VPS](#production-deployment--vps)
8. [CI/CD](#cicd)
9. [Scripts reference](#scripts-reference)
10. [Troubleshooting](#troubleshooting)
11. [Draft Master](#draft-master)

---

## Architecture

All services share one VPS. Redis runs self-hosted in Docker — no external metered Redis needed.

```
┌─────────────────────────────────────────────────────────────┐
│  VPS  (Docker network: mlbb_net)                            │
│                                                             │
│  mlbb-api       mlbb-web       mlbb-worker                  │
│  (Hono)         (SvelteKit)    (BullMQ + cron)              │
│     │               │              │                        │
│     └───────────────┴──────────────┘                        │
│                     │                                       │
│            mlbb-postgres    mlbb-redis                      │
│            (PostgreSQL 16)  (Redis 7)                       │
└─────────────────────────────────────────────────────────────┘
```

**Deployment model:**
- `mlbb-api` and `mlbb-web` run as Docker containers on the VPS (blue-green slot)
- `mlbb-worker` runs as a separate Docker container on the same VPS, on the same `mlbb_net` network
- All containers resolve each other by container name (`mlbb-redis`, `mlbb-postgres`)
- No external Redis (Upstash) required

**Cache architecture:**
- L1: in-process `Map` (30 s TTL) — eliminates Redis round-trips for hot keys (`/heroes`, tier-map, community votes)
- L2: self-hosted Redis — BullMQ queues, persistent cache
- API degrades gracefully if Redis is temporarily unavailable

---

## Repository structure

```
mlbb-tools/
├── apps/
│   ├── api/          @mlbb/api     Hono API → Docker (VPS)
│   │   ├── src/                    App source (bundled by tsup)
│   │   └── package.json
│   ├── web/          @mlbb/web     SvelteKit → Docker (VPS)
│   └── worker/       @mlbb/worker  BullMQ workers → Docker (VPS)
│       ├── src/
│       └── package.json
├── packages/
│   ├── db/           @mlbb/db      Drizzle schema + migrations
│   │   └── migrations/
│   ├── shared/       @mlbb/shared  Types, Zod schemas, scoring functions
│   └── config/                     Shared tsconfig/eslint/prettier
├── infra/
│   ├── docker-compose.yml          Local dev: Postgres + Redis
│   └── bluegreen/                  VPS blue-green stack
│       ├── docker-compose.shared.yml   Postgres + Redis + Nginx (mlbb_net)
│       ├── docker-compose.blue.yml     API + Web blue slot
│       ├── docker-compose.green.yml    API + Web green slot
│       ├── Dockerfile.api
│       ├── Dockerfile.web
│       └── nginx.conf
│   └── worker/                     Worker VPS Docker stack
│       ├── Dockerfile
│       ├── docker-compose.yml      Joins mlbb_net
│       └── .env.example
├── data/
│   └── hero-meta-final.json        Hero metadata snapshot (bundled)
├── .env.example                    Local dev env template
├── .env.production.example         VPS production env template
├── .github/workflows/
│   ├── ci.yml                      Lint + typecheck + build
│   └── deploy-worker.yml           Auto: build+push worker image → deploy to VPS
└── docs/
    ├── architecture-decisions.md
    ├── worker-deployment.md
    └── worker-separation-checklist.md
```

---

## Prerequisites

### Required versions

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Docker | 24.0+ | `docker --version` |
| Docker Compose | v2.20+ | Bundled with Docker Desktop; CLI: `docker compose version` |
| Node.js | 22 LTS | Local dev only; not needed on VPS |
| pnpm | 10.6.2 | Local dev only; `corepack enable && corepack prepare pnpm@10.6.2 --activate` |
| Git | 2.x | `git --version` |

### Install if command not found (Ubuntu/Debian)

**Docker + Docker Compose v2:**
```bash
# Remove old versions
apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Install
curl -fsSL https://get.docker.com | sh

# Add current user to docker group (re-login required)
usermod -aG docker $USER

# Verify
docker --version          # Docker version 24.x or higher
docker compose version    # Docker Compose version v2.x
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
node --version    # v22.x.x
```

**pnpm (local dev only):**
```bash
corepack enable
corepack prepare pnpm@10.6.2 --activate
pnpm --version    # 10.6.2
```

---

## Local development

### Quick start

```bash
# 1. Clone and install
git clone <repo-url> mlbb-tools && cd mlbb-tools
pnpm install

# 2. Create env file
cp .env.example .env

# 3. Start everything (Postgres + Redis + API + Web)
pnpm dev
```

`pnpm dev` automatically:
1. Starts Postgres + Redis via `infra/docker-compose.yml`
2. Waits for both services to be reachable
3. Runs DB migrations
4. Starts `@mlbb/api` and `@mlbb/web` in parallel (via Turborepo)

| Service | URL |
|---------|-----|
| Web dashboard | http://localhost:5173 |
| API health | http://localhost:8787/health |
| API full health | http://localhost:8787/health/full |

### Running the worker locally

```bash
# Terminal 1
pnpm dev          # starts Postgres + Redis + api + web

# Terminal 2
pnpm worker:dev   # starts the worker with hot-reload (tsx watch)
```

### Background mode

```bash
pnpm services:start   # launches pnpm dev in background, writes PID to .runtime/
pnpm services:stop    # stops the background process and docker services
```

---

## Environment variables

### Local development — `.env`

Copy `.env.example` to `.env`. All values have safe defaults for local use.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/mlbb_tools` | Postgres connection |
| `DATABASE_POOL_MAX` | `10` | Connection pool size |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `WEB_PORT` | `5173` | Vite dev server port |
| `API_PORT` | `8787` | Hono API port |
| `CORS_ORIGINS` | `*` | Allowed CORS origins |
| `INGEST_CRON` | `*/30 * * * *` | Worker cron schedule |
| `ACTIVE_TIMEFRAMES` | `7d,15d,30d` | Timeframes to compute |
| `HERO_META_SOURCE` | `gms` | Hero meta source (`gms` or `file`) |
| `GMS_API_KEY` | _(blank)_ | Optional GMS Bearer token |
| `SUPABASE_URL` | _(blank)_ | Community counters (optional) |
| `SUPABASE_ANON_KEY` | _(blank)_ | Community counters (optional) |

### Production VPS — `.env.production`

Copy `.env.production.example` to `.env.production` at the repo root on the VPS.

| Variable | Example value | Description |
|----------|--------------|-------------|
| `DATABASE_URL` | `postgresql://postgres:<pw>@mlbb-postgres:5432/mlbb_tools` | Uses container name |
| `DATABASE_POOL_MAX` | `10` | Connection pool size |
| `REDIS_URL` | `redis://mlbb-redis:6379` | Uses container name (same `mlbb_net`) |
| `POSTGRES_USER` | `postgres` | Postgres user |
| `POSTGRES_PASSWORD` | _(strong password)_ | Postgres password |
| `POSTGRES_DB` | `mlbb_tools` | Database name |
| `API_PORT` | `8787` | API container port |
| `WEB_PORT` | `3000` | Web container port |
| `CORS_ORIGINS` | `https://yourdomain.com` | Allowed CORS origins |
| `GMS_API_KEY` | _(your key)_ | GMS Bearer token |
| `SUPABASE_URL` | _(optional)_ | Community counters |
| `SUPABASE_ANON_KEY` | _(optional)_ | Community counters |

### Worker VPS — `infra/worker/.env.worker`

Copy `infra/worker/.env.example` to `infra/worker/.env.worker` on the VPS.

| Variable | Example value | Description |
|----------|--------------|-------------|
| `DATABASE_URL` | `postgresql://postgres:<pw>@mlbb-postgres:5432/mlbb_tools` | Container name (same VPS) |
| `REDIS_URL` | `redis://mlbb-redis:6379` | Container name (same VPS + `mlbb_net`) |
| `INGEST_CRON` | `*/30 * * * *` | Worker schedule |
| `ACTIVE_TIMEFRAMES` | `7d,15d,30d` | Valid: `1d,3d,7d,15d,30d` |
| `HERO_META_SOURCE` | `gms` | `gms` or `file` |
| `GMS_API_KEY` | _(your key)_ | Optional GMS Bearer token |
| `SUPABASE_URL` | _(optional)_ | Community counters |
| `SUPABASE_ANON_KEY` | _(optional)_ | Community counters |

> **Cross-VPS note:** If the worker runs on a separate host, replace container names with the main VPS IP:
> `DATABASE_URL=postgresql://postgres:<pw>@<MAIN_VPS_IP>:5432/mlbb_tools`
> `REDIS_URL=redis://<MAIN_VPS_IP>:6379`
> Then open ports 5432 and 6379 in your firewall for the worker IP only.

---

## Database operations

```bash
# Run pending migrations (dev)
pnpm db:migrate

# Open Drizzle Studio (visual DB browser)
pnpm db:studio

# Refresh hero metadata snapshot file (data/hero-meta-final.json)
pnpm meta:refresh
```

Migrations live in `packages/db/migrations/`. To generate a new migration after
editing the schema:

```bash
pnpm --filter @mlbb/db db:generate
```

For production, run migrations with the VPS Postgres URL:

```bash
DATABASE_URL="postgresql://postgres:<pw>@<vps-ip>:5432/mlbb_tools" pnpm db:migrate
```

---

## Production deployment — VPS

All steps below run **on the VPS via SSH** unless noted otherwise.

### Overview of services

| Container | Role | Network |
|-----------|------|---------|
| `mlbb-postgres` | PostgreSQL 16 | `mlbb_net` |
| `mlbb-redis` | Redis 7 | `mlbb_net` |
| `mlbb-nginx` | Reverse proxy | `mlbb_net` |
| `mlbb-api-blue` / `mlbb-api-green` | Hono API | `mlbb_net` |
| `mlbb-web-blue` / `mlbb-web-green` | SvelteKit Web | `mlbb_net` |
| `mlbb-worker` | BullMQ worker | `mlbb_net` |

All containers communicate by container name. No external Redis needed.

---

### Step 1 — Clone and prepare repo on VPS

```bash
git clone <repo-url> /opt/mlbb-tools
cd /opt/mlbb-tools
```

---

### Step 2 — Create the shared Docker network

Must be created once before starting any containers. All compose files reference it as `external: true` (except `docker-compose.shared.yml` which creates it).

```bash
docker network create mlbb_net
```

Verify:
```bash
docker network ls | grep mlbb_net
```

---

### Step 3 — Configure environment files

```bash
# Main env (API + Web)
cp .env.production.example .env.production
nano .env.production    # fill in passwords, CORS_ORIGINS, GMS_API_KEY

# Worker env
cp infra/worker/.env.example infra/worker/.env.worker
nano infra/worker/.env.worker    # fill in passwords, GMS_API_KEY
```

Minimum required values to change:
- `POSTGRES_PASSWORD` — use a strong password (same in both files)
- `CORS_ORIGINS` — your domain, e.g. `https://mlbb.example.com`
- `GMS_API_KEY` — your GMS bearer token (leave blank if endpoint is public)

---

### Step 4 — Build Docker images

Images are built locally or via GitHub Actions CI/CD (see [CI/CD](#cicd) section).

**Manual build on VPS:**
```bash
cd /opt/mlbb-tools

# API image
docker build -f infra/bluegreen/Dockerfile.api -t mlbb/api:latest .

# Web image
docker build -f infra/bluegreen/Dockerfile.web -t mlbb/web:latest .

# Worker image
docker build -f infra/worker/Dockerfile -t mlbb/worker:latest .
```

**Pull from GHCR (if using CI/CD):**
```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
docker pull ghcr.io/<owner>/mlbb-tools/api:latest
docker pull ghcr.io/<owner>/mlbb-tools/web:latest
docker pull ghcr.io/<owner>/mlbb-tools/worker:latest
```

---

### Step 5 — Start shared services (Postgres + Redis + Nginx)

```bash
cd /opt/mlbb-tools/infra/bluegreen

docker compose -f docker-compose.shared.yml up -d

# Wait for healthy status
docker compose -f docker-compose.shared.yml ps
```

Verify Redis is running:
```bash
docker exec mlbb-redis redis-cli ping
# Expected: PONG
```

Verify Postgres is running:
```bash
docker exec mlbb-postgres pg_isready -U postgres -d mlbb_tools
# Expected: /var/run/postgresql:5432 - accepting connections
```

---

### Step 6 — Run database migrations

```bash
cd /opt/mlbb-tools

# Install Node.js dependencies (needed for migration runner)
# If node/pnpm not on VPS, run migrations from your dev machine pointing to VPS IP:
#   DATABASE_URL="postgresql://postgres:<pw>@<vps-ip>:5432/mlbb_tools" pnpm db:migrate

DATABASE_URL="postgresql://postgres:<pw>@localhost:5432/mlbb_tools" pnpm db:migrate
```

---

### Step 7 — Start API + Web (blue slot)

```bash
cd /opt/mlbb-tools/infra/bluegreen

export IMAGE_PREFIX=mlbb
export IMAGE_TAG=latest

docker compose \
  -f docker-compose.shared.yml \
  -f docker-compose.blue.yml \
  up -d api web
```

Check health:
```bash
# Wait ~30 s for containers to reach healthy state
docker ps --filter "name=mlbb-api-blue" --format "table {{.Names}}\t{{.Status}}"

# Liveness probe (DB only)
curl -sf http://localhost:18787/health
# {"ok":true,"service":"api"}

# Full readiness probe (DB + Redis)
curl -sf http://localhost:18787/health/full
# {"ok":true,"service":"api","checks":{"db":true,"redis":true}}
```

---

### Step 8 — Start worker

```bash
cd /opt/mlbb-tools/infra/worker

export IMAGE_PREFIX=mlbb
export IMAGE_TAG=latest

docker compose up -d
```

Verify worker is connected to `mlbb_net` and can reach Redis:
```bash
docker logs mlbb-worker | head -30
# Should NOT show Redis connection errors
```

---

### Step 9 — Configure Nginx

Edit `infra/bluegreen/nginx.conf` to match your domain and SSL certificate paths,
then reload:

```bash
docker exec mlbb-nginx nginx -s reload
```

---

### Blue-green deploy (rolling update)

To deploy a new version without downtime:

```bash
cd /opt/mlbb-tools/infra/bluegreen

# Pull new images
docker pull ghcr.io/<owner>/mlbb-tools/api:<new-tag>
docker pull ghcr.io/<owner>/mlbb-tools/web:<new-tag>

export IMAGE_PREFIX=ghcr.io/<owner>/mlbb-tools
export IMAGE_TAG=<new-tag>

# Start green slot
docker compose -f docker-compose.shared.yml -f docker-compose.green.yml up -d api web

# Wait for green to be healthy (ports 28787, 23000)
curl -sf http://localhost:28787/health

# Switch Nginx upstream to green
cp upstream-green.conf active-upstream.conf
docker exec mlbb-nginx nginx -s reload

# Stop blue slot
docker compose -f docker-compose.shared.yml -f docker-compose.blue.yml stop api web
docker compose -f docker-compose.shared.yml -f docker-compose.blue.yml rm -f api web
```

---

### Useful management commands

```bash
# View all container statuses
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Follow worker logs
docker logs -f mlbb-worker

# Follow API logs
docker logs -f mlbb-api-blue

# Redis CLI
docker exec -it mlbb-redis redis-cli

# Inspect mlbb_net members
docker network inspect mlbb_net --format '{{range .Containers}}{{.Name}} {{end}}'

# Stop everything
docker compose -f infra/bluegreen/docker-compose.shared.yml \
  -f infra/bluegreen/docker-compose.blue.yml \
  -f infra/worker/docker-compose.yml \
  down
```

---

## API health endpoints

| Endpoint | Purpose | Used by |
|----------|---------|---------|
| `GET /health` | Liveness — DB check only | Docker healthcheck, load balancer probe |
| `GET /health/full` | Readiness — DB + Redis | Internal monitoring, uptime checks |

`/health` returns 200 even if Redis is down. The API cache degrades gracefully (L1 still works, Redis misses fall through to DB).

---

## CI/CD

### Workflows

| Workflow | File | Trigger | What it does |
|----------|------|---------|--------------|
| CI | `.github/workflows/ci.yml` | push / PR | lint + typecheck + build |
| Deploy worker | `.github/workflows/deploy-worker.yml` | push to `main` (worker/db/shared paths) | build+push worker image to GHCR → SSH deploy to VPS |

#### Required GitHub secrets

| Secret | Description |
|--------|-------------|
| `WORKER_HOST` | IP or hostname of VPS |
| `WORKER_USER` | SSH user on VPS (e.g. `ubuntu`) |
| `WORKER_SSH_KEY` | Private SSH key (ed25519) for `WORKER_USER` |
| `GHCR_USERNAME` | GitHub username |
| `GHCR_TOKEN` | Personal access token with `read:packages` + `write:packages` scope |

#### First-time SSH key setup

```bash
# On dev machine
ssh-keygen -t ed25519 -f ~/.ssh/mlbb_deploy -N "" -C "mlbb-deploy"

# Copy public key to VPS
ssh-copy-id -i ~/.ssh/mlbb_deploy.pub <user>@<vps-ip>

# Add private key to GitHub Secrets as WORKER_SSH_KEY
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
| Infra up | `pnpm infra:up` | Start local Docker services only |
| Infra down | `pnpm infra:down` | Stop local Docker services |
| DB migrate | `pnpm db:migrate` | Run pending migrations |
| DB studio | `pnpm db:studio` | Open Drizzle Studio |
| Meta refresh | `pnpm meta:refresh` | Re-fetch hero metadata |
| Build all | `pnpm build` | Compile all packages (Turborepo) |
| Lint all | `pnpm lint` | Lint all packages |
| Typecheck all | `pnpm typecheck` | Type-check all packages |

---

## Troubleshooting

### Worker cannot connect to Redis or Postgres

**Symptom:** `ECONNREFUSED` or Redis timeout in worker logs.

**Root cause:** Worker container not on `mlbb_net`, or shared services not started yet.

**Solution:**
```bash
# 1. Verify network exists
docker network ls | grep mlbb_net

# 2. Create if missing
docker network create mlbb_net

# 3. Verify all containers are on the network
docker network inspect mlbb_net --format '{{range .Containers}}{{.Name}} {{end}}'
# Expected: mlbb-postgres mlbb-redis mlbb-nginx mlbb-api-blue mlbb-worker (etc.)

# 4. Restart shared services first, then worker
cd /opt/mlbb-tools/infra/bluegreen
docker compose -f docker-compose.shared.yml up -d
cd /opt/mlbb-tools/infra/worker
docker compose up -d
```

### Health check returns 503

**`GET /health` → 503:** Postgres is down or unreachable.
```bash
docker exec mlbb-postgres pg_isready -U postgres -d mlbb_tools
docker logs mlbb-postgres | tail -20
```

**`GET /health/full` → 503 with `redis: false`:** Redis is down but API is still serving requests (cache degraded, not broken).
```bash
docker exec mlbb-redis redis-cli ping
docker logs mlbb-redis | tail -20
```

### Worker fails to sync community votes

**Symptom:** Community votes don't appear in counter recommendations.

**Solution:**
```bash
docker logs mlbb-worker | grep -i "community\|supabase"
```
Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set in `.env.worker`.
If missing, the API falls back to 0.5 flat weight for community voting.

### ioredis connection hangs on startup

**Symptom:** Application freezes or takes 30+ seconds to start.

**Root cause:** ioredis retrying indefinitely. Already mitigated in this codebase with:
```typescript
retryStrategy: () => null,  // fail fast, don't retry
connectTimeout: 3000,
commandTimeout: 3000,
lazyConnect: true,
```
If you still see hangs, verify `REDIS_URL` is reachable from inside the container:
```bash
docker exec mlbb-worker wget -qO- --timeout=3 http://mlbb-redis:6379 2>&1 || echo "not HTTP but Redis"
docker exec mlbb-worker ping -c1 mlbb-redis
```

### Deployment fails with "image not found"

**Symptom:** `docker pull: image not found`.

**Solution:**
```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
docker pull ghcr.io/<owner>/mlbb-tools/worker:latest
```
Verify `GHCR_TOKEN` has `read:packages` scope.

### Cannot connect to Postgres from outside VPS

**Symptom:** `FATAL: no pg_hba.conf entry` or timeout from dev machine.

**Solution:** Postgres port 5432 is exposed on the VPS host. Allow your IP:
```bash
ufw allow from <YOUR_IP> to any port 5432
```
Or use an SSH tunnel instead of exposing the port:
```bash
ssh -L 5432:localhost:5432 <user>@<vps-ip>
# Then connect to localhost:5432
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

### Configuration

Blend weights and scoring parameters are tunable via env without code changes:

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

The worker syncs community votes at startup and every hour (via node-cron):

1. Fetches from Supabase `counter_pick_votes` table
2. Translates vote counts to `VotePair[]` structure
3. Stores in Redis key `community:votes` with 3-hour TTL
4. API reads from Redis (L1 → L2); if missing, falls back to 0.5 flat weight

Requires `SUPABASE_URL` and `SUPABASE_ANON_KEY` in worker `.env.worker`.

---

## Notes

- Stats ingest uses GMS `POST /api/gms/source/{sourceId}/{endpoint}` per timeframe.
- `bigrank` from GMS is normalised to `rankScope`; priority: `all_rank → mythic_glory → … → warrior`.
- If GMS fetch fails the worker falls back to deterministic seeded stats and keeps running.
- Hero import is idempotent (upsert on `mlid`).
- Community counters require `SUPABASE_URL` + `SUPABASE_ANON_KEY`; omitting them disables the community blend channel.
- The `mlbb_net` Docker network must exist before starting any containers. Create it once with `docker network create mlbb_net`.
