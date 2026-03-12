#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/dev.pid"
WEB_PID_FILE="$RUNTIME_DIR/web.pid"
WORKER_PID_FILE="$RUNTIME_DIR/worker.pid"
LOG_FILE="$RUNTIME_DIR/dev.log"
WEB_LOG_FILE="$RUNTIME_DIR/web.log"
WORKER_LOG_FILE="$RUNTIME_DIR/worker.log"
API_SESSION_NAME="mlbb-api"
WEB_SESSION_NAME="mlbb-web"
WORKER_SESSION_NAME="mlbb-worker"

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

screen_session_exists() {
  local session_name="$1"
  { screen -list 2>/dev/null || true; } | grep -q "[.]${session_name}[[:space:]]"
}

cleanup_stale_pid() {
  local pid_file="$1"
  if [[ ! -f "$pid_file" ]]; then
    return
  fi

  local existing_pid
  existing_pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ "$existing_pid" == screen:* ]]; then
    if screen_session_exists "${existing_pid#screen:}"; then
      return
    fi
  elif [[ -n "${existing_pid:-}" ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
    return
  fi

  rm -f "$pid_file"
}

start_background_process() {
  local name="$1"
  local pid_file="$2"
  local log_file="$3"
  local session_name="$4"
  local workdir="$5"
  shift 5

  if command -v screen >/dev/null 2>&1; then
    if screen_session_exists "$session_name"; then
      screen -S "$session_name" -X quit >/dev/null 2>&1 || true
      sleep 1
    fi

    local escaped_workdir escaped_log command_string
    printf -v escaped_workdir '%q' "$workdir"
    printf -v escaped_log '%q' "$log_file"
    printf -v command_string '%q ' "$@"

    screen -dmS "$session_name" bash -lc "cd $escaped_workdir && exec $command_string >> $escaped_log 2>&1"
    echo "screen:$session_name" >"$pid_file"
    sleep 1

    if ! screen_session_exists "$session_name"; then
      log_error "$name berhenti saat startup. Cek log: $log_file"
      exit 1
    fi

    log_info "$name berjalan (screen session $session_name)"
    log_info "Log $name: $log_file"
    return
  fi

  (
    cd "$workdir"
    nohup "$@" </dev/null >"$log_file" 2>&1 &
    echo "$!" >"$pid_file"
  )
  sleep 1

  local started_pid
  started_pid="$(cat "$pid_file" 2>/dev/null || true)"
  if ! kill -0 "$started_pid" >/dev/null 2>&1; then
    log_error "$name berhenti saat startup. Cek log: $log_file"
    exit 1
  fi

  log_info "$name berjalan (PID $started_pid)"
  log_info "Log $name: $log_file"
}

mkdir -p "$RUNTIME_DIR"

cleanup_stale_pid "$PID_FILE"
cleanup_stale_pid "$WEB_PID_FILE"
cleanup_stale_pid "$WORKER_PID_FILE"

if [[ -f "$PID_FILE" && -f "$WEB_PID_FILE" && -f "$WORKER_PID_FILE" ]]; then
  api_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  web_pid="$(cat "$WEB_PID_FILE" 2>/dev/null || true)"
  worker_pid="$(cat "$WORKER_PID_FILE" 2>/dev/null || true)"
  if [[ "$api_pid" == "screen:$API_SESSION_NAME" && "$web_pid" == "screen:$WEB_SESSION_NAME" && "$worker_pid" == "screen:$WORKER_SESSION_NAME" ]] \
    && screen_session_exists "$API_SESSION_NAME" \
    && screen_session_exists "$WEB_SESSION_NAME" \
    && screen_session_exists "$WORKER_SESSION_NAME"; then
    log_info "Semua service lokal sudah berjalan."
    log_info "Log API: $LOG_FILE"
    log_info "Log WEB: $WEB_LOG_FILE"
    log_info "Log WORKER: $WORKER_LOG_FILE"
    exit 0
  fi
  if [[ -n "${api_pid:-}" && -n "${web_pid:-}" && -n "${worker_pid:-}" ]] \
    && [[ "$api_pid" != screen:* && "$web_pid" != screen:* && "$worker_pid" != screen:* ]] \
    && kill -0 "$api_pid" >/dev/null 2>&1 \
    && kill -0 "$web_pid" >/dev/null 2>&1 \
    && kill -0 "$worker_pid" >/dev/null 2>&1; then
    log_info "Semua service lokal sudah berjalan."
    log_info "Log API: $LOG_FILE"
    log_info "Log WEB: $WEB_LOG_FILE"
    log_info "Log WORKER: $WORKER_LOG_FILE"
    exit 0
  fi
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

WEB_PORT="$(read_env_var WEB_PORT 5173)"
API_PORT="$(read_env_var API_PORT 8787)"
DATABASE_URL="$(read_env_var DATABASE_URL postgresql://postgres:postgres@localhost:5432/mlbb_tools)"
REDIS_URL="$(read_env_var REDIS_URL redis://localhost:6379)"

log_info "Menjalankan docker services..."
docker compose -f "$ROOT_DIR/infra/docker-compose.yml" up -d

pg_host="$(node -e 'console.log(new URL(process.argv[1]).hostname || "localhost")' "$DATABASE_URL" 2>/dev/null || printf 'localhost')"
pg_port="$(node -e 'console.log(new URL(process.argv[1]).port || "5432")' "$DATABASE_URL" 2>/dev/null || printf '5432')"
redis_host="$(node -e 'console.log(new URL(process.argv[1]).hostname || "localhost")' "$REDIS_URL" 2>/dev/null || printf 'localhost')"
redis_port="$(node -e 'console.log(new URL(process.argv[1]).port || "6379")' "$REDIS_URL" 2>/dev/null || printf '6379')"

wait_tcp_ready "POSTGRES" "$pg_host" "$pg_port" || true
wait_tcp_ready "REDIS" "$redis_host" "$redis_port" || true

log_info "Menjalankan migrasi database..."
pnpm -w db:migrate

log_info "Menjalankan API..."
start_background_process "API" "$PID_FILE" "$LOG_FILE" "$API_SESSION_NAME" "$ROOT_DIR/apps/api" ./node_modules/.bin/tsx src/index.ts

log_info "Menjalankan WEB..."
start_background_process "WEB" "$WEB_PID_FILE" "$WEB_LOG_FILE" "$WEB_SESSION_NAME" "$ROOT_DIR/apps/web" ./node_modules/.bin/vite dev --host --port "$WEB_PORT"

log_info "Menjalankan WORKER..."
start_background_process "WORKER" "$WORKER_PID_FILE" "$WORKER_LOG_FILE" "$WORKER_SESSION_NAME" "$ROOT_DIR/apps/worker" ./node_modules/.bin/tsx src/index.ts

wait_tcp_ready "API" "127.0.0.1" "$API_PORT" || true
wait_http_ready "API" "http://127.0.0.1:${API_PORT}/health" || true
wait_tcp_ready "WEB" "127.0.0.1" "$WEB_PORT" || true
wait_http_ready "WEB" "http://127.0.0.1:${WEB_PORT}" || true

for started_pid in "$(cat "$PID_FILE" 2>/dev/null || true)" "$(cat "$WEB_PID_FILE" 2>/dev/null || true)" "$(cat "$WORKER_PID_FILE" 2>/dev/null || true)"; do
  if [[ "$started_pid" == screen:* ]]; then
    if ! screen_session_exists "${started_pid#screen:}"; then
      log_error "Ada process utama yang berhenti setelah startup. Cek log di $RUNTIME_DIR"
      exit 1
    fi
  elif [[ -n "${started_pid:-}" ]] && ! kill -0 "$started_pid" >/dev/null 2>&1; then
    log_error "Ada process utama yang berhenti setelah startup. Cek log di $RUNTIME_DIR"
    exit 1
  fi
done

if [[ ! -f "$WORKER_PID_FILE" ]]; then
  log_error "PID worker tidak tersimpan."
  exit 1
fi

log_info "Selesai. Untuk stop: bash scripts/stop-services.sh"
