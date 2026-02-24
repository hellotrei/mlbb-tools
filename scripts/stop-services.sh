#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/dev.pid"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.yml"

log_info() {
  printf '[stop] %s\n' "$1"
}

log_warn() {
  printf '[stop][warn] %s\n' "$1"
}

stop_pid() {
  local pid="$1"
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi

  kill "$pid" >/dev/null 2>&1 || true
  for _ in {1..25}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done

  kill -9 "$pid" >/dev/null 2>&1 || true
}

stop_orphan_processes() {
  local patterns=(
    "turbo run dev --parallel"
    "scripts/dev.mjs"
    "apps/api/node_modules/.bin/../tsx/dist/cli.mjs watch src/index.ts"
    "apps/worker/node_modules/.bin/../tsx/dist/cli.mjs watch src/index.ts"
    "apps/web/node_modules/.bin/../vite/bin/vite.js dev --host"
  )

  local found=0
  for pattern in "${patterns[@]}"; do
    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      [[ "$pid" == "$$" ]] && continue
      if kill -0 "$pid" >/dev/null 2>&1; then
        found=1
        stop_pid "$pid"
      fi
    done < <(pgrep -f "$ROOT_DIR.*${pattern}" || true)
  done

  if [[ "$found" -eq 1 ]]; then
    log_info "Orphan process project juga sudah dihentikan."
  fi
}

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${pid:-}" ]]; then
    log_info "Stopping app process PID $pid..."
    stop_pid "$pid"
  fi
  rm -f "$PID_FILE"
else
  log_warn "PID file tidak ditemukan, skip stop process utama."
fi

stop_orphan_processes

if command -v docker >/dev/null 2>&1; then
  log_info "Stopping docker services (postgres/redis)..."
  docker compose -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true
else
  log_warn "docker tidak ditemukan, skip docker compose down."
fi

log_info "Semua service project sudah dihentikan."
