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
7. [Production deployment](#production-deployment)
8. [CI/CD](#cicd)
9. [Scripts reference](#scripts-reference)
10. [Troubleshooting](#troubleshooting)
11. [Draft Master](#draft-master)

---

## Architecture

Three independent deployment targets share two external services:

```
┌─────────────────────┐     ┌─────────────────────┐
│  Vercel             │     │  Worker VPS          │
│  ─────────────────  │     │  ─────────────────── │
│  @mlbb/api          │     │  mlbb-worker         │
│  (Hono + tsup)      │     │  (BullMQ + cron)     │
│                     │     │  - ingest stats       │
│  @mlbb/web          │     │  - compute tiers      │
│  (SvelteKit)        │     │  - compute counters   │
│                     │     │  - sync community     │
└──────────┬──────────┘     │    votes              │
           │                └──────────┬────────────┘
           │ reads/writes             │ reads/writes
           ▼                          ▼
┌──────────────────────────────────────────────────┐
│  Supabase PostgreSQL    Upstash Redis             │
│  (database)             (cache + job queue)       │
└──────────────────────────────────────────────────┘
```

**API** (`apps/api`) and **Web** (`apps/web`) are deployed to **Vercel** —
separate from the **Worker** (`apps/worker`), which runs on a **standalone VPS**
via Docker. This separation ensures that API/web deploys never interrupt
background jobs.

See [docs/architecture-decisions.md](docs/architecture-decisions.md) for the
rationale.

---

## Repository structure

```
mlbb-tools/
├── apps/
│   ├── api/          @mlbb/api     Hono API → Vercel
│   │   ├── api/index.ts            Vercel function entrypoint (pre-reads POST body)
│   │   ├── src/                    App source (bundled by tsup)
│   │   ├── vercel.json             Vercel config
│   │   └── package.json
│   ├── web/          @mlbb/web     SvelteKit → Vercel
│   └── worker/       @mlbb/worker  BullMQ workers → VPS Docker
│       ├── src/
│       ├── package.json
│       └── Dockerfile
├── packages/
│   ├── db/           @mlbb/db      Drizzle schema + Supabase client
│   │   └── migrations/             SQL migration files
│   ├── shared/       @mlbb/shared  Types, Zod schemas, scoring functions
│   └── config/                     Shared tsconfig/eslint/prettier
├── infra/
│   ├── docker-compose.yml          Local dev: Postgres + Redis
│   └── worker/                     Worker VPS Docker stack
│       ├── Dockerfile              Worker image
│       ├── docker-compose.yml      Worker compose (VPS)
│       └── .env.example            Worker env template
├── data/
│   └── hero-meta-final.json        Hero metadata snapshot (bundled)
├── .env.example                    Local dev env template
├── .github/workflows/
│   ├── ci.yml                      Lint + typecheck + build
│   ├── deploy-worker.yml           Auto: build+push worker image → deploy to VPS
│   └── deploy.yml                  Manual-only: Vercel builds (obsolete)
└── docs/
    ├── architecture-decisions.md   ADR-001: worker separation rationale
    ├── worker-deployment.md        Full worker deployment guide
    └── worker-separation-checklist.md  Rollout verification
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
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/mlbb_tools` | Postgres connection (local) |
| `DATABASE_POOL_MAX` | `10` | Connection pool size |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection (local) |
| `WEB_PORT` | `5173` | Vite dev server port |
| `API_PORT` | `8787` | Hono API port |
| `CORS_ORIGINS` | `*` | Allowed CORS origins |
| `INGEST_CRON` | `*/30 * * * *` | Worker cron schedule |
| `ACTIVE_TIMEFRAMES` | `7d,15d,30d` | Timeframes to compute |
| `HERO_META_SOURCE` | `gms` | Hero meta source (`gms` or `file`) |
| `GMS_API_KEY` | _(blank)_ | Optional GMS Bearer token |
| `SUPABASE_URL` | _(blank)_ | Community counters (optional) |
| `SUPABASE_ANON_KEY` | _(blank)_ | Community counters (optional) |

GMS endpoint IDs (`GMS_STATS_ENDPOINT_*`, `GMS_META_ENDPOINT`) and counter
blend weights have working defaults — see `.env.example` for the full list.

### Production — Vercel (API)

Set these environment variables in Vercel dashboard under project settings:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Supabase transaction pooler URL (port 6543) |
| `REDIS_URL` | Upstash Redis URL (`rediss://...`) |
| `CORS_ORIGINS` | Comma-separated allowed origins (e.g. `https://example.com`) |

**Note:** `VERCEL=1` is set automatically by Vercel. Pool size is 3 on serverless.

### Production — Vercel (Web)

Set this environment variable in Vercel dashboard:

| Variable | Description |
|----------|-------------|
| `PUBLIC_API_BASE_URL` | URL of the deployed API (e.g. `https://mlbb-tools-api.vercel.app`) |

### Production — Worker VPS (`.env.worker`)

Copy `infra/worker/.env.example` to `/opt/mlbb-worker/infra/worker/.env.worker`
on the worker host.

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Supabase transaction pooler URL (port 6543) |
| `REDIS_URL` | Upstash Redis URL (`rediss://...`, same as API) |
| `SUPABASE_URL` | Supabase project URL for community votes sync |
| `SUPABASE_ANON_KEY` | Supabase anon key for community votes sync |

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

For production (Supabase), run migrations with the Supabase `DATABASE_URL`:

```bash
DATABASE_URL="postgresql://..." pnpm db:migrate
```

---

## Production deployment

### Vercel (API + Web)

Vercel builds and deploys are **fully automated**:

1. **API** (`apps/api`):
   - Builds via `pnpm turbo run build --filter=@mlbb/api...` (tsup bundling)
   - Deploys to Vercel serverless with `api/index.ts` as entrypoint
   - Vercel automatically sets `VERCEL=1` environment variable
   - Environment variables configured in Vercel dashboard

2. **Web** (`apps/web`):
   - Builds via SvelteKit's Vercel adapter
   - Deploys to Vercel edge/serverless
   - Environment variables configured in Vercel dashboard

**No manual deployment needed** — pushes to `main` trigger automatic builds.

#### Vercel quirks and workarounds

**POST body handling:**
The Vercel rewrite layer doesn't close the request body stream after passing to
the function, causing the body to hang if not pre-read. Solution: `apps/api/api/index.ts`
pre-reads the entire body as a Buffer before passing to Hono:

```typescript
// api/index.ts
if (req.method !== "GET" && req.method !== "HEAD" && req.rawBody === undefined) {
  req.rawBody = await readBody(req).catch(() => Buffer.alloc(0));
}
```

This is the **actual fix**. The `bodyParser: false` config export (if present) is
a no-op for non-Next.js frameworks and does nothing.

### Worker VPS

The worker runs on a standalone VPS via Docker + GitHub Actions CI/CD.

#### First-time setup

**1. Provision the host (one-time)**

```bash
# On the worker host (Ubuntu/Debian, run as root or with sudo)
bash scripts/provision-worker.sh
```

This installs Docker, creates `/opt/mlbb-worker/`, copies deployment files, and
sets up GHCR login.

**2. Set up SSH key for GitHub Actions**

Generate an SSH key for deploying from GitHub Actions:

```bash
# On your dev machine
ssh-keygen -t ed25519 -f ~/.ssh/mlbb_worker -N "" -C "mlbb-worker-deploy"

# Add public key to VPS authorized_keys
cat ~/.ssh/mlbb_worker.pub | ssh <vps-user>@<vps-host> \
  "cat >> ~/.ssh/authorized_keys"

# Copy private key to GitHub Secrets
cat ~/.ssh/mlbb_worker | pbcopy  # macOS
# Add to GitHub: Settings → Secrets → WORKER_SSH_KEY
```

**3. Configure environment file**

```bash
vim /opt/mlbb-worker/infra/worker/.env.worker
```

Set these values:

```bash
DATABASE_URL=postgresql://postgres:<password>@<api-vps-or-supabase-ip>:6543/mlbb_tools
REDIS_URL=rediss://<username>:<password>@<upstash-host>:<port>
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<public-key>
```

**4. Open firewall (if using separate VPS for Postgres/Redis)**

Allow the worker host IP to reach services:

```bash
# On Postgres/Redis host (ufw example)
ufw allow from <WORKER_HOST_IP> to any port 6543
ufw allow from <WORKER_HOST_IP> to any port 6379
```

(If using Supabase + Upstash, skip this — they're public.)

**5. Verify connectivity**

```bash
docker run --rm postgres:16-alpine pg_isready \
  -h <db-host> -p 6543 -U postgres

docker run --rm redis:7-alpine redis-cli -u rediss://<redis-url> ping
```

#### Deployment flow

The worker deploys automatically via GitHub Actions (`deploy-worker.yml`):

1. **Trigger:** push to `main` with changes in:
   - `apps/worker/**`
   - `packages/db/**`
   - `packages/shared/**`
   - `infra/worker/**`
   - `data/**`

2. **Build:** Builds `infra/worker/Dockerfile` and pushes to GHCR as:
   - `ghcr.io/<owner>/mlbb-tools/worker:<sha>`
   - `ghcr.io/<owner>/mlbb-tools/worker:latest`

3. **Deploy:** SSH into worker host and:
   - Logs in to GHCR with credentials
   - Pulls new image
   - Runs `docker compose up -d worker`
   - Waits (max 60 sec) for container to reach "running" state

#### Required GitHub secrets

| Secret | Description |
|--------|-------------|
| `WORKER_HOST` | IP or hostname of worker VPS |
| `WORKER_USER` | SSH user on worker VPS (e.g. `ubuntu`) |
| `WORKER_SSH_KEY` | Private SSH key (ed25519) for WORKER_USER |
| `GHCR_USERNAME` | GitHub username (for GHCR login) |
| `GHCR_TOKEN` | Personal access token with `read:packages` scope |

---

## CI/CD

### Workflows

| Workflow | File | Trigger | What it does |
|----------|------|---------|--------------|
| CI | `.github/workflows/ci.yml` | push / PR | lint + typecheck + build |
| Deploy worker | `.github/workflows/deploy-worker.yml` | push to `main` (worker paths) | build+push worker image → deploy to VPS |
| Deploy blue-green | `.github/workflows/deploy.yml` | **manual only** (`workflow_dispatch`) | _(obsolete)_ was blue-green VPS deploy; now disabled |

**Note:** The `deploy.yml` workflow is **manual-only** and primarily for reference.
API and Web now deploy via Vercel automatically on push to `main`.

---

## Scripts reference

| Script | Command | Description |
|--------|---------|-------------|
| Dev (foreground) | `pnpm dev` | Start Postgres+Redis+api+web |
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

### POST requests hang on Vercel

**Symptom:** POST requests to the API timeout or hang.

**Root cause:** Vercel's rewrite layer doesn't close the request body stream.

**Solution:** Already implemented in `apps/api/api/index.ts` — the body is
pre-read as a Buffer before passing to Hono. If this stops working:

1. Verify `api/index.ts` includes the `readBody()` function
2. Check that `req.rawBody` is being set before calling `honoHandler()`

### Worker fails to sync community votes

**Symptom:** Community votes don't appear in the counter recommendations.

**Root cause:** Missing or incorrect `SUPABASE_URL` + `SUPABASE_ANON_KEY` in worker env.

**Solution:**

1. Check worker logs:
   ```bash
   docker logs mlbb-worker | grep -i "community\|supabase"
   ```

2. Verify `.env.worker` on VPS has both keys set (not blank)

3. Verify Supabase anon key has read access to `counter_pick_votes` table

4. Check Redis key:
   ```bash
   redis-cli -u "$REDIS_URL" get community:votes
   ```

If missing, the API falls back to 0.5 flat weight for community voting.

### ioredis connection hangs

**Symptom:** Application freezes or takes 30+ seconds to start.

**Root cause:** ioredis retrying connection indefinitely on connection failure.

**Solution:** ioredis clients must set `retryStrategy: () => null`:

```typescript
// Prevent infinite reconnect attempts
const redis = new Redis(process.env.REDIS_URL, {
  retryStrategy: () => null,  // Don't retry; fail fast
  commandTimeout: 5000,       // Command timeout
  connectTimeout: 5000,       // Connection timeout
  lazyConnect: true,          // Defer connection until first command
});
```

This is configured in `packages/db` — verify if you encounter hangs.

### Cannot connect to database on VPS

**Symptom:** "Error: connect ECONNREFUSED" or "FATAL: no pg_hba.conf entry".

**Solution:**

1. Verify `DATABASE_URL` uses the correct host and port (6543 for Supabase pooler)
2. Verify IP allowlist on Postgres/Supabase (if using separate VPS)
3. Check firewall rules:
   ```bash
   # Test from worker VPS
   nc -zv <db-host> 6543
   ```

### Deployment fails with "image not found"

**Symptom:** Worker deployment fails with "docker pull: image not found".

**Root cause:** GHCR login failed or token is invalid/expired.

**Solution:**

1. Verify GitHub secrets (`GHCR_USERNAME`, `GHCR_TOKEN`) are set correctly
2. Verify token has `read:packages` scope
3. Manually test login on VPS:
   ```bash
   echo "$GHCR_TOKEN" | docker login ghcr.io \
     -u "$GHCR_USERNAME" --password-stdin
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

### Community votes sync

The worker syncs community votes at startup and every hour (via node-cron):

1. Fetches from Supabase third-party `counter_pick_votes` table
2. Translates vote counts to `VotePair[]` structure
3. Stores in Redis key `community:votes` with 3-hour TTL
4. API reads from Redis; if key missing, falls back to 0.5 flat weight

Requires `SUPABASE_URL` and `SUPABASE_ANON_KEY` in worker `.env.worker`.

---

## Notes

- Stats ingest uses GMS `POST /api/gms/source/{sourceId}/{endpoint}` per timeframe.
- `bigrank` from GMS is normalised to `rankScope`; priority: `all_rank → mythic_glory → … → warrior`.
- If GMS fetch fails the worker falls back to deterministic seeded stats and keeps running.
- Hero import is idempotent (upsert on `mlid`).
- Community counters require `SUPABASE_URL` + `SUPABASE_ANON_KEY`; omitting them disables the community blend channel.
