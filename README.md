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
7. [Production deployment — Main VPS](#production-deployment--main-vps)
8. [Production deployment — Worker host](#production-deployment--worker-host)
9. [CI/CD](#cicd)
10. [Scripts reference](#scripts-reference)
11. [Draft Master](#draft-master)

---

## Architecture

Two independent deployment targets share the same Postgres database and Redis
instance:

```
┌─────────────────────────────────────┐    ┌──────────────────────────────────┐
│  Main VPS  (blue-green)             │    │  Worker Host  (standalone)       │
│  ──────────────────────             │    │  ──────────────────────────────  │
│  nginx  :80 / :443                  │    │  mlbb-worker container           │
│    └─ /api/*  → mlbb-api-{slot}     │    │    BullMQ workers ×4             │
│    └─ /*      → mlbb-web-{slot}     │    │    node-cron (every 30 min)      │
│  mlbb-api-blue   :18787             │    │    GMS API client                │
│  mlbb-api-green  :28787             │    │                                  │
│  mlbb-web-blue   :13000             │    │    reads/writes ──────────────►  │
│  mlbb-web-green  :23000             │    │                                  │
│  postgres        :5432  ◄───────────┼────┤                                  │
│  redis           :6379  ◄───────────┼────┘                                  │
└─────────────────────────────────────┘
```

The worker runs entirely independently — web/API deploys never restart it.
See [docs/architecture-decisions.md](docs/architecture-decisions.md) for the
rationale.

---

## Repository structure

```
mlbb-tools/
├── apps/
│   ├── api/          @mlbb/api     Hono BFF API (Node.js)
│   ├── web/          @mlbb/web     SvelteKit dashboard
│   └── worker/       @mlbb/worker  BullMQ ingest + compute workers
├── packages/
│   ├── db/           @mlbb/db      Drizzle schema, migrations, DB client
│   ├── shared/       @mlbb/shared  Types, Zod schemas, scoring functions
│   ├── ui/           @mlbb/ui      Reusable Svelte components + theme tokens
│   └── config/                     Shared tsconfig / eslint / prettier bases
├── infra/
│   ├── docker-compose.yml          Local dev: Postgres + Redis
│   ├── bluegreen/                  Main VPS blue-green Docker stack
│   └── worker/                     Standalone worker Docker stack
├── scripts/
│   ├── dev.mjs                     One-command local dev launcher
│   ├── start-services.sh           Background service launcher (with PID)
│   ├── stop-services.sh            Stop background services
│   ├── provision-worker.sh         Bootstrap a fresh worker host
│   ├── worker-health.sh            Check worker status (local or remote)
│   ├── deploy-bluegreen.sh         Blue-green VPS deploy script
│   └── refresh-hero-meta.mjs       Re-fetch hero metadata to data/
├── docs/
│   ├── architecture-decisions.md   ADR-001: worker separation rationale
│   ├── worker-deployment.md        Full worker deployment guide
│   └── worker-separation-checklist.md  Rollout verification checklist
├── data/
│   └── hero-meta-final.json        Hero metadata fallback (bundled)
├── .env.example                    Local dev env template
├── .env.production.example         Production env template (main VPS)
└── infra/worker/.env.example       Production env template (worker host)
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20+ |
| pnpm | 10+ (`corepack enable`) |
| Docker + Docker Compose v2 | latest |

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

### Running the worker locally

The worker runs **separately** from `pnpm dev`:

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

### Stopping

```bash
pnpm services:stop    # or Ctrl+C if running in foreground
```

---

## Environment variables

### Local development — `.env`

Copy `.env.example` to `.env`. All values have safe defaults for local use.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/mlbb_tools` | Postgres connection |
| `DATABASE_POOL_MAX` | `10` | Connection pool size |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection (BullMQ + cache) |
| `WEB_PORT` | `5173` | Vite dev server port |
| `API_PORT` | `8787` | Hono API port |
| `CORS_ORIGINS` | `*` | Allowed CORS origins |
| `INGEST_CRON` | `*/30 * * * *` | Worker cron schedule |
| `ACTIVE_TIMEFRAMES` | `7d,15d,30d` | Timeframes to compute |
| `HERO_META_SOURCE` | `gms` | Hero meta source (`gms` or `file`) |
| `GMS_API_KEY` | _(blank)_ | Optional GMS Bearer token |
| `SUPABASE_URL` | _(blank)_ | Community counters (optional) |
| `SUPABASE_ANON_KEY` | _(blank)_ | Community counters (optional) |

> GMS endpoint IDs (`GMS_STATS_ENDPOINT_*`, `GMS_META_ENDPOINT`) and counter
> blend weights (`COUNTERS_BLEND_WEIGHTS`, `DRAFT_COUNTER_*`) have working
> defaults — see `.env.example` for the full list.

### Production — `.env.production` (Main VPS)

Copy `.env.production.example` to `.env.production` on the VPS.

Key values to change from the example:

```bash
POSTGRES_PASSWORD=<strong-password>
DATABASE_URL=postgresql://postgres:<strong-password>@postgres:5432/mlbb_tools
CORS_ORIGINS=https://your-domain.com
```

### Production — `.env.worker` (Worker host)

Copy `infra/worker/.env.example` to `/opt/mlbb-worker/infra/worker/.env.worker`
on the worker host.

Key values:

```bash
DATABASE_URL=postgresql://postgres:<password>@<MAIN_VPS_IP>:5432/mlbb_tools
REDIS_URL=redis://<MAIN_VPS_IP>:6379
```

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

---

## Production deployment — Main VPS

The main VPS runs the web + API using a **blue-green strategy**: traffic is
switched from the old slot to the new slot only after a health check passes.
The old slot is torn down after the switch.

### First-time VPS setup

```bash
# 1. SSH into the VPS and clone/copy the repo
git clone <repo-url> /opt/mlbb-tools
cd /opt/mlbb-tools

# 2. Create the production env file
cp .env.production.example .env.production
# Edit .env.production — set strong passwords, CORS_ORIGINS, GMS_API_KEY, etc.

# 3. Set required environment variables for the deploy script
export IMAGE_PREFIX=ghcr.io/<github-owner>/mlbb-tools
export IMAGE_TAG=latest   # or a specific SHA

# 4. Log in to GHCR (if images are private)
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin

# 5. Run the first deploy
bash scripts/deploy-bluegreen.sh
```

### What the deploy script does

1. Pulls `postgres`, `redis`, `nginx` from the shared stack
2. Pulls the new `api` and `web` images
3. Starts the inactive slot (blue or green)
4. Health-checks the new slot at `/health`
5. Switches nginx upstream to the new slot
6. Tears down the old slot

### Firewall

Expose only ports `80` (HTTP) and `443` (HTTPS) to the internet.
Redis (`:6379`) and Postgres (`:5432`) must be accessible from the
**worker host IP only** — no public access.

### TLS / HTTPS

After obtaining a Let's Encrypt certificate, replace `nginx.conf` with
`infra/bluegreen/nginx.ssl.conf` and reload nginx:

```bash
docker compose -f infra/bluegreen/docker-compose.shared.yml exec nginx nginx -s reload
```

---

## Production deployment — Worker host

The worker runs on a **separate host** so that API/web deploys never restart
background jobs. See [docs/worker-deployment.md](docs/worker-deployment.md)
for the full guide.

### Provision a fresh host

```bash
# On the worker host (Ubuntu/Debian, run as root)
bash scripts/provision-worker.sh
```

The script installs Docker, creates `/opt/mlbb-worker/infra/worker/`, copies
`docker-compose.yml`, seeds `.env.worker`, and logs in to GHCR.

### Fill in the env file

```bash
vim /opt/mlbb-worker/infra/worker/.env.worker
# Set DATABASE_URL and REDIS_URL to the main VPS endpoints
```

### Open firewall on the main VPS

Allow the worker host IP to reach Postgres and Redis:

```bash
# On the main VPS (ufw example)
ufw allow from <WORKER_HOST_IP> to any port 5432
ufw allow from <WORKER_HOST_IP> to any port 6379
```

### Verify connectivity

```bash
docker run --rm postgres:16-alpine pg_isready -h <MAIN_VPS_IP> -p 5432 -U postgres
docker run --rm redis:7-alpine redis-cli -h <MAIN_VPS_IP> ping
```

### Start the worker

```bash
cd /opt/mlbb-worker/infra/worker
IMAGE_PREFIX=ghcr.io/<github-owner>/mlbb-tools IMAGE_TAG=latest docker compose up -d
```

### Check health (from dev machine)

```bash
WORKER_HOST=<ip> WORKER_USER=<user> WORKER_SSH_KEY=~/.ssh/id_rsa \
  bash scripts/worker-health.sh
```

---

## CI/CD

### Workflows

| Workflow | File | Trigger | What it does |
|----------|------|---------|--------------|
| CI | `.github/workflows/ci.yml` | push / PR | lint + typecheck + build |
| Deploy web+api | `.github/workflows/deploy.yml` | push to `main` | build+push `api` and `web` images → blue-green deploy |
| Deploy worker | `.github/workflows/deploy-worker.yml` | push to `main` (worker paths) | build+push `worker` image → deploy to worker host |

The worker workflow triggers only when files under these paths change:
`apps/worker/**`, `packages/db/**`, `packages/shared/**`, `infra/worker/**`, `data/**`

### Required GitHub secrets

**Main VPS deploy:**

| Secret | Description |
|--------|-------------|
| `VPS_HOST` | IP or hostname of the main VPS |
| `VPS_USER` | SSH user on the main VPS |
| `VPS_SSH_KEY` | Private SSH key for `VPS_USER` |
| `GHCR_USERNAME` | GitHub username for GHCR login on the VPS |
| `GHCR_TOKEN` | Personal access token with `read:packages` scope |

**Worker host deploy:**

| Secret | Description |
|--------|-------------|
| `WORKER_HOST` | IP or hostname of the worker host |
| `WORKER_USER` | SSH user on the worker host |
| `WORKER_SSH_KEY` | Private SSH key for `WORKER_USER` |
| `GHCR_USERNAME` | (same token, reused) |
| `GHCR_TOKEN` | (same token, reused) |

---

## Scripts reference

| Script | Command | Description |
|--------|---------|-------------|
| Dev (foreground) | `pnpm dev` | Start Postgres+Redis+api+web |
| Dev worker | `pnpm worker:dev` | Start worker with hot-reload |
| Background start | `pnpm services:start` | Launch dev stack in background |
| Background stop | `pnpm services:stop` | Stop background dev stack |
| Worker health | `pnpm worker:health` | Check worker container status |
| Infra up | `pnpm infra:up` | Start local Docker services only |
| Infra down | `pnpm infra:down` | Stop local Docker services |
| DB migrate | `pnpm db:migrate` | Run pending migrations |
| DB studio | `pnpm db:studio` | Open Drizzle Studio |
| Meta refresh | `pnpm meta:refresh` | Re-fetch hero metadata |
| Build all | `pnpm build` | Compile all packages (Turborepo) |
| Lint all | `pnpm lint` | Lint all packages |
| Typecheck all | `pnpm typecheck` | Type-check all packages |

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
  ├─ tier map + hero stats
  ├─ counter matrix + synergy matrix
  ├─ hero role pool
  └─ Supabase community votes (optional)
       └─ per-hero score → phase weights → Recommended / Meta / Counter picks
```

### Request flow

```mermaid
sequenceDiagram
  autonumber
  participant U as User
  participant P as DraftMaster page
  participant A as POST /draft/analyze
  participant F as POST /draft/feasibility

  U->>P: Open page or change draft state
  P->>P: analyze()
  par
    P->>A: draft context + picks + bans + turn
    P->>F: allyMlids + enemyMlids
  end
  A-->>P: recommendedPicks + metaPicks + counterPicks
  F-->>P: ally/enemy feasibility
  P-->>U: Render recommendation panels
```

---

## Notes

- Stats ingest uses GMS `POST /api/gms/source/{sourceId}/{endpoint}` per timeframe.
- `bigrank` from GMS is normalised to `rankScope`; priority: `all_rank → mythic_glory → … → warrior`.
- If GMS fetch fails the worker falls back to deterministic seeded stats and keeps running.
- Hero import is idempotent (upsert on `mlid`).
- Community counters require `SUPABASE_URL` + `SUPABASE_ANON_KEY`; omitting them disables the community blend channel.
