#!/usr/bin/env bash
# provision-worker.sh
#
# Run this script on a fresh Ubuntu/Debian host to set up the standalone
# mlbb-worker environment.
#
# Usage (on the worker host):
#   curl -fsSL https://raw.githubusercontent.com/<owner>/mlbb-tools/main/scripts/provision-worker.sh | bash
#
# Or copy the script and run it directly:
#   bash scripts/provision-worker.sh
#
# After provisioning, copy infra/worker/.env.example to
# /opt/mlbb-worker/infra/worker/.env.worker and fill in the real values,
# then run:
#   cd /opt/mlbb-worker/infra/worker
#   docker compose up -d
set -euo pipefail

DEPLOY_DIR="/opt/mlbb-worker/infra/worker"
GHCR_REGISTRY="ghcr.io"

log()  { printf '\e[32m[provision]\e[0m %s\n' "$1"; }
warn() { printf '\e[33m[provision][warn]\e[0m %s\n' "$1"; }
err()  { printf '\e[31m[provision][error]\e[0m %s\n' "$1" >&2; exit 1; }

# ── 0. Root check ─────────────────────────────────────────────────────────────
if [[ "$EUID" -ne 0 ]]; then
  err "Run as root or with sudo."
fi

# ── 1. System update ──────────────────────────────────────────────────────────
log "Updating package index..."
apt-get update -qq

# ── 2. Install Docker ─────────────────────────────────────────────────────────
if command -v docker >/dev/null 2>&1; then
  log "Docker already installed: $(docker --version)"
else
  log "Installing Docker..."
  apt-get install -y -qq ca-certificates curl gnupg lsb-release

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" \
    | tee /etc/apt/sources.list.d/docker.list > /dev/null

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin

  systemctl enable --now docker
  log "Docker installed: $(docker --version)"
fi

# ── 3. Create deployment directory ────────────────────────────────────────────
log "Creating deployment directory: $DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR"

# ── 4. Copy docker-compose.yml ────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_SRC="$REPO_ROOT/infra/worker/docker-compose.yml"

if [[ -f "$COMPOSE_SRC" ]]; then
  cp "$COMPOSE_SRC" "$DEPLOY_DIR/docker-compose.yml"
  log "Copied docker-compose.yml to $DEPLOY_DIR"
else
  warn "docker-compose.yml not found at $COMPOSE_SRC — copy it manually."
fi

# ── 5. Create env file from example if not present ────────────────────────────
ENV_FILE="$DEPLOY_DIR/.env.worker"
ENV_EXAMPLE="$REPO_ROOT/infra/worker/.env.example"

if [[ -f "$ENV_FILE" ]]; then
  log ".env.worker already exists — skipping."
else
  if [[ -f "$ENV_EXAMPLE" ]]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    warn ".env.worker created from example. EDIT IT NOW before starting the worker:"
    warn "  $ENV_FILE"
  else
    warn ".env.example not found. Create $ENV_FILE manually before starting the worker."
  fi
fi

# ── 6. GHCR login helper ──────────────────────────────────────────────────────
log "Checking GHCR credentials..."
if [[ -n "${GHCR_USERNAME:-}" && -n "${GHCR_TOKEN:-}" ]]; then
  echo "$GHCR_TOKEN" | docker login "$GHCR_REGISTRY" -u "$GHCR_USERNAME" --password-stdin
  log "Logged in to $GHCR_REGISTRY as $GHCR_USERNAME"
else
  warn "GHCR_USERNAME / GHCR_TOKEN not set in environment."
  warn "Log in manually before pulling the worker image:"
  warn "  echo \"\$GHCR_TOKEN\" | docker login ghcr.io -u \"\$GHCR_USERNAME\" --password-stdin"
fi

# ── 7. Firewall reminder ───────────────────────────────────────────────────────
log "──────────────────────────────────────────────────────────────────"
log "IMPORTANT: open the main VPS firewall to allow this host to reach:"
log "  Postgres  tcp/5432  from $(curl -4 -fsSL https://icanhazip.com 2>/dev/null || echo '<this-host-ip>')"
log "  Redis     tcp/6379  from $(curl -4 -fsSL https://icanhazip.com 2>/dev/null || echo '<this-host-ip>')"
log "──────────────────────────────────────────────────────────────────"

# ── 8. Summary ────────────────────────────────────────────────────────────────
log "Provisioning complete."
log ""
log "Next steps:"
log "  1. Edit $ENV_FILE"
log "     Set DATABASE_URL and REDIS_URL to the main VPS endpoints."
log "  2. Pull and start the worker:"
log "     cd $DEPLOY_DIR"
log "     IMAGE_PREFIX=ghcr.io/<owner>/mlbb-tools IMAGE_TAG=latest docker compose up -d"
log "  3. Verify it is running:"
log "     bash $REPO_ROOT/scripts/worker-health.sh"
