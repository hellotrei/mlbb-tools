# Worker Separation — Verification Checklist

Use this checklist when rolling out the worker-as-standalone-service topology
(ADR-001). Work through it top-to-bottom; each section must pass before moving
to the next.

---

## 1. Local development

- [ ] `pnpm dev` starts **only** `@mlbb/api` and `@mlbb/web` (no worker process in turbo output)
- [ ] `pnpm worker:dev` starts the worker independently with hot-reload (`tsx watch`)
- [ ] Worker connects to the local Postgres and Redis spun up by `pnpm dev`
- [ ] Hero stats, tier results, counters, and synergies are written to the DB after one cron tick
- [ ] Stopping `pnpm dev` does not affect a running `pnpm worker:dev` process (and vice versa)

---

## 2. Build

- [ ] `pnpm --filter @mlbb/worker build` completes without TypeScript errors
- [ ] `apps/worker/dist/index.js` is produced
- [ ] `pnpm --filter @mlbb/worker start` runs the compiled output and connects to DB + Redis

---

## 3. Docker image

- [ ] `docker build -f infra/worker/Dockerfile -t mlbb-worker:test .` succeeds
- [ ] Container starts and logs show bootstrap sequence:
  - `importHeroMeta()` completes
  - `syncHeroRolePool()` completes
  - First cron tick enqueues ingest + compute jobs
- [ ] `docker stop mlbb-worker-test` triggers graceful shutdown (SIGTERM → `shutdown()` → exit 0)
- [ ] No worker image is built or referenced in `deploy.yml` (web+api pipeline)

---

## 4. Main VPS deployment (web + api)

- [ ] Push to `main` triggers `.github/workflows/deploy.yml`
- [ ] Only `api` and `web` images are built and pushed to GHCR
- [ ] `deploy-bluegreen.sh` starts `postgres redis nginx` — **no worker** in `up -d`
- [ ] `docker-compose.shared.yml` has no `worker` service
- [ ] Nginx starts without waiting for a worker container
- [ ] API health endpoint (`/health`) returns 200 after deploy
- [ ] Web frontend loads and serves hero data from the DB

---

## 5. Worker host provisioning

Run on the worker host (requires root / sudo):

```bash
# From the monorepo root on the worker host
sudo bash scripts/provision-worker.sh
```

- [ ] Script completes without errors
- [ ] Docker is installed and `systemctl is-active docker` returns `active`
- [ ] `/opt/mlbb-worker/infra/worker/` directory exists
- [ ] Main VPS firewall allows inbound `tcp/5432` and `tcp/6379` from the worker host IP
- [ ] `/opt/mlbb-worker/infra/worker/.env.worker` is filled in:
  - `DATABASE_URL` points to main VPS Postgres (`<MAIN_VPS_IP>:5432`)
  - `REDIS_URL` points to main VPS Redis (`<MAIN_VPS_IP>:6379`)
- [ ] Connectivity verified:
  ```bash
  # Postgres reachable
  docker run --rm postgres:16-alpine pg_isready -h <MAIN_VPS_IP> -p 5432 -U postgres
  # Redis reachable
  docker run --rm redis:7-alpine redis-cli -h <MAIN_VPS_IP> ping
  ```

---

## 6. Worker host deployment (CI/CD)

- [ ] GitHub secrets are configured: `WORKER_HOST`, `WORKER_USER`, `WORKER_SSH_KEY`, `GHCR_USERNAME`, `GHCR_TOKEN`
- [ ] Push to `main` with a change in `apps/worker/**` triggers `.github/workflows/deploy-worker.yml`
- [ ] Worker image is built, tagged with `$GITHUB_SHA` and `:latest`, pushed to GHCR
- [ ] Verify step in workflow passes: `mlbb-worker` reaches `running` state within 60 s
- [ ] Worker logs show successful bootstrap:
  ```bash
  WORKER_HOST=<ip> WORKER_USER=<user> WORKER_SSH_KEY=~/.ssh/id_rsa \
    bash scripts/worker-health.sh
  ```
- [ ] `pnpm worker:health` (with env vars set) shows container running and recent cron tick in logs

---

## 7. Integration

- [ ] API reads tier/counter/synergy data written by the standalone worker
- [ ] Hero stats in the web frontend reflect the latest ingest cycle
- [ ] Redeploying web+api does **not** restart or affect the worker container
- [ ] Redeploying the worker does **not** affect web+api availability

---

## 8. Failure handling

- [ ] Stopping the worker container: web and API remain fully operational; data becomes stale but no errors
- [ ] Restarting the worker container: worker re-bootstraps, re-runs `importHeroMeta` + `syncHeroRolePool`, resumes cron schedule
- [ ] A failed ingest job: logged to stdout, retained in Redis (`removeOnFail: 100`); next cron tick retries automatically
