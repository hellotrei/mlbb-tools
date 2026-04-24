#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"

if [[ ! -f "$BASE_ENV_FILE" ]]; then
  echo "[env][error] base env file not found: $BASE_ENV_FILE"
  exit 1
fi

ensure_file() {
  local file="$1"
  local service="$2"
  if [[ ! -f "$file" ]]; then
    cat >"$file" <<EOF
# Optional production overrides for ${service}.
# Loaded after .env.production.
# Keep secrets here out of Git history.
EOF
  fi
  chmod 600 "$file" || true
}

ensure_file "$ROOT_DIR/.env.api.production" "api"
ensure_file "$ROOT_DIR/.env.web.production" "web"
ensure_file "$ROOT_DIR/.env.worker.production" "worker"

echo "[env] service override env files are ready"
