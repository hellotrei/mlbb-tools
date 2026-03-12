#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/dev.pid"
WEB_PID_FILE="$RUNTIME_DIR/web.pid"
WORKER_PID_FILE="$RUNTIME_DIR/worker.pid"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.yml"
SESSION_NAMES=("mlbb-api" "mlbb-web" "mlbb-worker")

log_info() {
  printf '[stop] %s\n' "$1"
}

log_warn() {
  printf '[stop][warn] %s\n' "$1"
}

screen_session_exists() {
  local session_name="$1"
  { screen -list 2>/dev/null || true; } | grep -q "[.]${session_name}[[:space:]]"
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
    "scripts/dev.mjs"
    "apps/api/.*/tsx.*/src/index.ts"
    "apps/worker/.*/tsx.*/src/index.ts"
    "apps/web/.*/vite.*/dev --host"
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

stop_runtime_entry() {
  local entry="$1"

  if [[ -z "$entry" ]]; then
    return
  fi

  if [[ "$entry" == screen:* ]]; then
    local session_name="${entry#screen:}"
    if screen_session_exists "$session_name"; then
      log_info "Stopping screen session $session_name..."
      screen -S "$session_name" -X quit >/dev/null 2>&1 || true
    fi
    return
  fi

  log_info "Stopping process PID $entry..."
  stop_pid "$entry"
}

for pid_file in "$PID_FILE" "$WEB_PID_FILE" "$WORKER_PID_FILE"; do
  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    stop_runtime_entry "$pid"
    rm -f "$pid_file"
  fi
done

for session_name in "${SESSION_NAMES[@]}"; do
  if screen_session_exists "$session_name"; then
    log_info "Stopping screen session $session_name..."
    screen -S "$session_name" -X quit >/dev/null 2>&1 || true
  fi
done

stop_orphan_processes

if command -v docker >/dev/null 2>&1; then
  log_info "Stopping docker services (postgres/redis)..."
  docker compose -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true
else
  log_warn "docker tidak ditemukan, skip docker compose down."
fi

log_info "Semua service project sudah dihentikan."
