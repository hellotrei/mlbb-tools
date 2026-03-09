#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/dev.pid"
LOG_FILE="$RUNTIME_DIR/dev.log"

log_info() {
  printf '[start] %s\n' "$1"
}

log_warn() {
  printf '[start][warn] %s\n' "$1"
}

log_error() {
  printf '[start][error] %s\n' "$1" >&2
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_error "Command '$1' tidak ditemukan."
    exit 1
  fi
}

read_env_var() {
  local key="$1"
  local default_value="$2"
  if [[ ! -f "$ROOT_DIR/.env" ]]; then
    printf '%s' "$default_value"
    return
  fi
  local value
  value="$(grep -E "^${key}=" "$ROOT_DIR/.env" | tail -n 1 | cut -d'=' -f2- | tr -d '[:space:]' || true)"
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
  else
    printf '%s' "$default_value"
  fi
}

wait_http_ready() {
  local name="$1"
  local url="$2"
  local attempts="${3:-120}"
  local stable_hits=0
  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      stable_hits=$((stable_hits + 1))
      # Require 2 consecutive successful probes to avoid transient false-ready.
      if [[ "$stable_hits" -ge 2 ]]; then
        log_info "$name ready: $url"
        return 0
      fi
    else
      stable_hits=0
    fi
    sleep 1
  done
  log_warn "$name belum ready setelah ${attempts}s: $url"
  return 1
}

wait_tcp_ready() {
  local name="$1"
  local host="$2"
  local port="$3"
  local attempts="${4:-120}"
  for ((i = 1; i <= attempts; i++)); do
    if (echo >/dev/tcp/"$host"/"$port") >/dev/null 2>&1; then
      log_info "$name TCP ready: ${host}:${port}"
      return 0
    fi
    sleep 1
  done
  log_warn "$name TCP belum ready setelah ${attempts}s: ${host}:${port}"
  return 1
}

mkdir -p "$RUNTIME_DIR"

if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${existing_pid:-}" ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
    log_info "Service sudah berjalan (PID $existing_pid)."
    log_info "Log: $LOG_FILE"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

require_cmd pnpm
require_cmd docker
require_cmd curl

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  log_info ".env belum ada, dibuat dari .env.example"
fi

cd "$ROOT_DIR"

log_info "Install dependencies..."
if ! pnpm install --frozen-lockfile; then
  log_warn "frozen-lockfile gagal, lanjut pnpm install standar..."
  pnpm install
fi

log_info "Menjalankan service web/api + postgres/redis (worker berjalan terpisah)..."
nohup pnpm dev >"$LOG_FILE" 2>&1 &
echo "$!" >"$PID_FILE"
log_info "PID tersimpan di $PID_FILE"
log_info "Log tersimpan di $LOG_FILE"

WEB_PORT="$(read_env_var WEB_PORT 5173)"
API_PORT="$(read_env_var API_PORT 8787)"
wait_tcp_ready "API" "127.0.0.1" "$API_PORT" || true
wait_http_ready "API" "http://127.0.0.1:${API_PORT}/health" || true
wait_tcp_ready "WEB" "127.0.0.1" "$WEB_PORT" || true
wait_http_ready "WEB" "http://127.0.0.1:${WEB_PORT}" || true

started_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -n "${started_pid:-}" ]] && ! kill -0 "$started_pid" >/dev/null 2>&1; then
  log_error "Process dev utama berhenti setelah startup. Cek log: $LOG_FILE"
  exit 1
fi

log_info "Selesai. Untuk stop: bash scripts/stop-services.sh"
