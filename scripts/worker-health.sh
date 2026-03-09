#!/usr/bin/env bash
# worker-health.sh
#
# Check the health of the standalone worker — either locally or on a remote host.
#
# Local usage (run on the worker host itself):
#   bash scripts/worker-health.sh
#
# Remote usage (run from your dev machine):
#   WORKER_HOST=<ip> WORKER_USER=<user> WORKER_SSH_KEY=~/.ssh/id_rsa \
#     bash scripts/worker-health.sh
set -euo pipefail

DEPLOY_DIR="/opt/mlbb-worker/infra/worker"
CONTAINER="mlbb-worker"
TAIL_LINES=30

log()  { printf '\e[36m[health]\e[0m %s\n' "$1"; }
ok()   { printf '\e[32m[health][ok]\e[0m %s\n' "$1"; }
fail() { printf '\e[31m[health][fail]\e[0m %s\n' "$1"; FAILED=1; }
FAILED=0

run_check() {
  # If WORKER_HOST is set, run the inner script over SSH; otherwise run locally.
  if [[ -n "${WORKER_HOST:-}" ]]; then
    local ssh_opts=(-o StrictHostKeyChecking=no -o ConnectTimeout=10)
    if [[ -n "${WORKER_SSH_KEY:-}" ]]; then
      ssh_opts+=(-i "$WORKER_SSH_KEY")
    fi
    ssh "${ssh_opts[@]}" "${WORKER_USER:-root}@${WORKER_HOST}" bash -s
  else
    bash -s
  fi
}

# ── Build the inner check script ──────────────────────────────────────────────
INNER_SCRIPT=$(cat <<INNER
set -euo pipefail
CONTAINER="$CONTAINER"
DEPLOY_DIR="$DEPLOY_DIR"
TAIL_LINES="$TAIL_LINES"

echo "=== Container status ==="
if docker ps --format '{{.Names}}\t{{.Status}}' | grep -q "^\$CONTAINER"; then
  docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.RunningFor}}' \
    | grep -E "^(NAMES|\$CONTAINER)"
  echo "RUNNING=yes"
else
  echo "RUNNING=no"
  echo "[fail] Container \$CONTAINER is not running."
  docker ps -a --format 'table {{.Names}}\t{{.Status}}' | grep "\$CONTAINER" || true
fi

echo ""
echo "=== Recent logs (last \$TAIL_LINES lines) ==="
docker logs --tail "\$TAIL_LINES" "\$CONTAINER" 2>&1 || echo "[warn] Could not fetch logs."

echo ""
echo "=== Resource usage ==="
docker stats --no-stream --format \
  'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}' \
  "\$CONTAINER" 2>/dev/null || echo "[warn] Stats unavailable."

echo ""
echo "=== Env sanity (non-secret keys) ==="
docker exec "\$CONTAINER" env 2>/dev/null \
  | grep -E '^(NODE_ENV|ACTIVE_TIMEFRAMES|INGEST_CRON|HERO_META_SOURCE)=' \
  || echo "[warn] Could not read env."

echo ""
echo "=== docker compose config ==="
cd "\$DEPLOY_DIR" && docker compose config --quiet 2>&1 && echo "compose config OK" || echo "[warn] compose config has errors."
INNER
)

# ── Run ───────────────────────────────────────────────────────────────────────
if [[ -n "${WORKER_HOST:-}" ]]; then
  log "Running health check on ${WORKER_USER:-root}@${WORKER_HOST} ..."
  echo "$INNER_SCRIPT" | run_check
else
  log "Running health check locally..."
  echo "$INNER_SCRIPT" | bash -s
fi

# ── Exit status ───────────────────────────────────────────────────────────────
if [[ "$FAILED" -eq 0 ]]; then
  ok "Health check passed."
  exit 0
else
  fail "Health check failed — review output above."
  exit 1
fi
