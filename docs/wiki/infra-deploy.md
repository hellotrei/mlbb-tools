# Infra & Deploy

## Local dev services

- `infra/docker-compose.yml` runs:
  - Postgres 16 (`mlbb-postgres`) exposed on `5432`
  - Redis 7 (`mlbb-redis`) exposed on `6379`

`pnpm dev` uses this compose file and waits for both services before running migrations.

## Production: blue/green (web + api)

The VPS blue/green stack lives under `infra/bluegreen/`:

- `docker-compose.shared.yml` — shared services and Nginx
- `docker-compose.blue.yml` / `docker-compose.green.yml` — blue/green slots for API+Web
- `nginx.conf` / `nginx.ssl.conf` — edge routing and TLS termination
- `active-upstream.conf` — points Nginx to the currently active slot
- `.deploy/releases.jsonl` — append-only release log (written by deploy workflows/scripts)

Deploy helpers:

- `scripts/deploy-bluegreen.sh`
  - Requires `IMAGE_PREFIX` + `IMAGE_TAG`
  - Pulls the inactive slot, health-checks it, then flips `active-upstream.conf` and reloads Nginx
  - Writes active slot state to `infra/bluegreen/.active-slot`
- `scripts/rollback-release.sh [full|api-only] [image_tag]`
  - Resolves rollback tag from `releases.jsonl` if not provided, then redeploys

## Production: worker host

Worker is intentionally deployed separately (ADR-001). The canonical guide is:

- `docs/worker-deployment.md`

Related files:

- `infra/worker/docker-compose.yml` + `infra/worker/Dockerfile`
- `.github/workflows/deploy-worker.yml` (build/push + restart on worker host)

## Vercel

The API and the Vercel API proxy both expose Vercel-compatible handlers (serverless mode is typically gated by `VERCEL === "1"` in the apps).

