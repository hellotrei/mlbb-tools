# Architecture Decisions

---

## ADR-001: Separate worker from the main VPS deployment

**Date:** 2026-03-09
**Status:** Accepted

### Context

The monorepo originally ran three processes together on a single VPS using a
blue-green Docker stack:

- `mlbb-web` — SvelteKit frontend (blue/green slot)
- `mlbb-api` — Hono API (blue/green slot)
- `mlbb-worker` — background job processor (shared/singleton)

The worker runs long-lived BullMQ queues and a `node-cron` scheduler. These
are persistent processes — they must stay alive between requests and across
deployments. Hosting them alongside the blue-green web+api stack caused two
concrete problems:

1. **Deployment coupling.** Every web or API deploy triggered a worker restart
   (the shared stack pulled a new worker image and restarted the container).
   This interrupted in-flight jobs and unnecessarily recycled the scheduler.

2. **Nginx startup dependency.** `docker-compose.shared.yml` had
   `nginx depends_on: worker`, meaning nginx would not start until the worker
   container became healthy. A worker crash or slow boot blocked the entire
   public-facing stack.

### Decision

Move the worker to a standalone host with its own Docker Compose stack and its
own CI/CD pipeline.

**New topology:**

```
┌──────────────────────────────────────┐   ┌──────────────────────────────┐
│  Main VPS  (blue-green)              │   │  Worker Host  (standalone)   │
│  ──────────────────────              │   │  ──────────────────────────  │
│  nginx           (shared)            │   │  mlbb-worker container       │
│  mlbb-api-blue / mlbb-api-green      │   │    BullMQ workers ×4         │
│  mlbb-web-blue / mlbb-web-green      │   │    node-cron scheduler       │
│  postgres        (shared)  ◄─────────┼───┤    GMS API client            │
│  redis           (shared)  ◄─────────┼───┘                              │
└──────────────────────────────────────┘
```

The worker connects to the **same Postgres and Redis** as the API using
`DATABASE_URL` and `REDIS_URL` environment variables.

### Consequences

**Positive:**
- Web and API deployments no longer restart the worker.
- Nginx startup is not gated on worker health.
- Worker image build and deploy have an independent cadence — only triggered by
  changes in `apps/worker/`, `packages/db/`, `packages/shared/`, `infra/worker/`,
  or `data/`.
- The worker can be scaled, restarted, or re-provisioned without touching the
  public-facing stack.

**Trade-offs:**
- A second host and a second set of SSH secrets (`WORKER_HOST`, `WORKER_USER`,
  `WORKER_SSH_KEY`) are required.
- Operators must ensure the worker host has network access to Postgres and Redis
  on the main VPS (firewall rule or VPC peering).
- If the worker host is unavailable, hero stats and tier data become stale, but
  the web and API remain fully operational (they read the last-written DB rows).

### Files changed

| File | Change |
|------|--------|
| `.github/workflows/deploy.yml` | Removed worker image build step |
| `.github/workflows/deploy-worker.yml` | New — standalone worker CI/CD |
| `infra/bluegreen/docker-compose.shared.yml` | Removed `worker` service; removed nginx `depends_on: worker` |
| `infra/worker/Dockerfile` | New — builds and runs compiled worker |
| `infra/worker/docker-compose.yml` | New — standalone worker compose |
| `infra/worker/.env.example` | New — env var template for worker host |
| `scripts/dev.mjs` | `pnpm dev` now starts api + web only |
| `package.json` | Added `worker:dev` script for local worker development |
| `scripts/start-services.sh` | Updated log message to reflect split |
| `docs/worker-deployment.md` | New — full worker deployment guide |

### Alternatives considered

**Keep worker in shared stack, just remove nginx dependency.**
Rejected — deployment coupling (worker restarts on every web/api deploy)
remains, and a mis-configured worker can still block the stack from starting.

**Use a managed job runner (e.g. Render cron jobs, Railway).**
Not pursued at this stage. The existing Docker/VPS workflow is well-understood
by the team; introducing a third platform would add operational surface area
without clear benefit given the current scale.
