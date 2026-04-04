#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
BG_DIR="$ROOT_DIR/infra/bluegreen"
WORKER_DIR="${WORKER_DIR:-/opt/mlbb-worker/infra/worker}"
STATE_FILE="$BG_DIR/.active-slot"
API_STATE_FILE="$BG_DIR/.active-slot-api"

FAILED=0
WARNED=0

log()   { printf '\e[36m[check]\e[0m %s\n' "$1"; }
ok()    { printf '\e[32m[check][ok]\e[0m %s\n' "$1"; }
warn()  { WARNED=1; printf '\e[33m[check][warn]\e[0m %s\n' "$1"; }
fail()  { FAILED=1; printf '\e[31m[check][fail]\e[0m %s\n' "$1"; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Command '$1' not found."
    exit 1
  fi
}

load_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    fail "Env file not found: $ENV_FILE"
    exit 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

require_env_var() {
  local key="$1"
  local value="${!key:-}"
  if [[ -z "$value" ]]; then
    fail "Required env '$key' is empty in $ENV_FILE"
  else
    ok "Env '$key' is set"
  fi
}

container_state() {
  local name="$1"
  docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null || echo "missing"
}

container_health() {
  local name="$1"
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null || echo "missing"
}

check_container() {
  local name="$1"
  local status health
  status="$(container_state "$name")"
  health="$(container_health "$name")"

  if [[ "$status" != "running" ]]; then
    fail "Container $name is $status"
    return
  fi

  if [[ "$health" != "healthy" && "$health" != "none" ]]; then
    fail "Container $name health is $health"
    return
  fi

  ok "Container $name is running${health:+ (health: $health)}"
}

fetch_text() {
  local url="$1"
  curl -fsS --max-time 15 "$url"
}

check_http() {
  local label="$1"
  local url="$2"
  if fetch_text "$url" >/dev/null 2>&1; then
    ok "$label reachable: $url"
  else
    fail "$label unreachable: $url"
  fi
}

check_http_contains() {
  local label="$1"
  local url="$2"
  local needle="$3"
  local body
  if ! body="$(fetch_text "$url" 2>/dev/null)"; then
    fail "$label request failed: $url"
    return
  fi
  if grep -Fq "$needle" <<<"$body"; then
    ok "$label contains '$needle'"
  else
    fail "$label missing '$needle'"
  fi
}

determine_active_slot() {
  if [[ -f "$STATE_FILE" ]]; then
    tr -d '[:space:]' < "$STATE_FILE"
    return
  fi
  if [[ -f "$API_STATE_FILE" ]]; then
    tr -d '[:space:]' < "$API_STATE_FILE"
    return
  fi
  printf 'blue'
}

active_slot="$(determine_active_slot)"
if [[ "$active_slot" == "green" ]]; then
  local_api_url="http://127.0.0.1:28787"
  local_web_url="http://127.0.0.1:23000"
  active_api_container="mlbb-api-green"
  active_web_container="mlbb-web-green"
else
  local_api_url="http://127.0.0.1:18787"
  local_web_url="http://127.0.0.1:13000"
  active_api_container="mlbb-api-blue"
  active_web_container="mlbb-web-blue"
fi

main() {
  require_cmd docker
  require_cmd curl
  require_cmd grep
  require_cmd awk
  require_cmd sed
  load_env_file

  local web_base_url api_public_base_url expected_webhook_url latest_event_code latest_event_code_lower
  web_base_url="${WEB_APP_BASE_URL%/}"
  api_public_base_url="${API_PUBLIC_BASE_URL:-${web_base_url}/api}"
  api_public_base_url="${api_public_base_url%/}"
  expected_webhook_url="${EXPECTED_TELEGRAM_WEBHOOK_URL:-${api_public_base_url}/telegram/webhook}"

  log "Preflight env checks"
  require_env_var POSTGRES_USER
  require_env_var POSTGRES_PASSWORD
  require_env_var POSTGRES_DB
  require_env_var DATABASE_URL
  require_env_var REDIS_PASSWORD
  require_env_var REDIS_URL
  require_env_var WEB_APP_BASE_URL
  require_env_var TELEGRAM_BOT_TOKEN
  require_env_var TELEGRAM_WEBHOOK_SECRET
  require_env_var GMS_API_KEY

  if [[ -n "${SUPABASE_URL:-}" && -n "${SUPABASE_ANON_KEY:-}" ]]; then
    ok "Community sync env is configured"
    strict_community=1
  else
    warn "SUPABASE_URL or SUPABASE_ANON_KEY is empty. Community votes will be treated as optional."
    strict_community=0
  fi

  log "Compose sanity checks"
  if docker compose --env-file "$ENV_FILE" -f "$BG_DIR/docker-compose.shared.yml" config --quiet >/dev/null 2>&1; then
    ok "Shared compose config is valid"
  else
    fail "Shared compose config is invalid"
  fi
  if docker compose --env-file "$ENV_FILE" -f "$BG_DIR/docker-compose.blue.yml" config --quiet >/dev/null 2>&1; then
    ok "Blue slot compose config is valid"
  else
    fail "Blue slot compose config is invalid"
  fi
  if docker compose --env-file "$ENV_FILE" -f "$BG_DIR/docker-compose.green.yml" config --quiet >/dev/null 2>&1; then
    ok "Green slot compose config is valid"
  else
    fail "Green slot compose config is invalid"
  fi
  if [[ -f "$WORKER_DIR/docker-compose.yml" ]]; then
    if (cd "$WORKER_DIR" && docker compose config --quiet >/dev/null 2>&1); then
      ok "Worker compose config is valid"
    else
      fail "Worker compose config is invalid"
    fi
  else
    warn "Worker compose file not found at $WORKER_DIR/docker-compose.yml"
  fi

  log "Container checks"
  ok "Active slot detected: $active_slot"
  check_container "mlbb-postgres"
  check_container "mlbb-redis"
  check_container "mlbb-nginx"
  check_container "$active_api_container"
  check_container "$active_web_container"
  if [[ "$(container_state "mlbb-worker")" == "missing" ]]; then
    warn "mlbb-worker is not running on this host. Run scripts/worker-health.sh on the worker host if it is separate."
  else
    check_container "mlbb-worker"
  fi

  log "Local health checks"
  check_http_contains "Local API /health" "$local_api_url/health" '"ok":true'
  check_http_contains "Local API /health/full" "$local_api_url/health/full" '"redis":true'
  check_http "Local WEB root" "$local_web_url/"
  check_http_contains "Local M7 status" "$local_api_url/draft/m7/status" '"available":true'
  check_http_contains "Local MPL PH status" "$local_api_url/draft/mpl-ph/status" '"available":true'
  check_http_contains "Local MPL ID status" "$local_api_url/draft/mpl-id/status" '"available":true'

  if [[ "$strict_community" -eq 1 ]]; then
    check_http_contains "Community votes cache" "$local_api_url/debug/community-votes" '"found":true'
  else
    if fetch_text "$local_api_url/debug/community-votes" 2>/dev/null | grep -Fq '"found":true'; then
      ok "Community votes cache is present"
    else
      warn "Community votes cache not found yet"
    fi
  fi

  log "Public URL checks"
  check_http "Public web root" "$web_base_url/"
  check_http_contains "Public API /health" "$api_public_base_url/health" '"ok":true'
  check_http_contains "Public API /health/full" "$api_public_base_url/health/full" '"redis":true'
  check_http_contains "Public M7 status" "$api_public_base_url/draft/m7/status" '"available":true'
  check_http_contains "Public MPL PH status" "$api_public_base_url/draft/mpl-ph/status" '"available":true'
  check_http_contains "Public MPL ID status" "$api_public_base_url/draft/mpl-id/status" '"available":true'

  latest_event_code="${CHECK_TOURNAMENT_CODE:-}"
  if [[ -z "$latest_event_code" ]]; then
    latest_event_code="$(
      fetch_text "$api_public_base_url/events?limit=1" 2>/dev/null \
        | grep -o '"code":"[^"]*"' \
        | head -n 1 \
        | cut -d'"' -f4
    )"
  fi

  if [[ -n "$latest_event_code" ]]; then
    latest_event_code_lower="$(printf '%s' "$latest_event_code" | tr '[:upper:]' '[:lower:]')"
    check_http "Public tournament detail page" "$web_base_url/tournaments/$latest_event_code_lower"
    check_http_contains "Public tournament event payload" "$api_public_base_url/events/$latest_event_code" '"event":'
    check_http_contains "Public tournament bracket payload" "$api_public_base_url/events/$latest_event_code/bracket" '"rounds":'
  else
    warn "No tournament code found for bracket visibility check. Set CHECK_TOURNAMENT_CODE to enforce it."
  fi

  log "Telegram checks"
  check_http_contains "Telegram getMe" "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" '"ok":true'
  local webhook_info
  if webhook_info="$(fetch_text "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo" 2>/dev/null)"; then
    if grep -Fq "\"url\":\"$expected_webhook_url\"" <<<"$webhook_info"; then
      ok "Telegram webhook URL matches $expected_webhook_url"
    else
      fail "Telegram webhook URL does not match $expected_webhook_url"
    fi

    if grep -Eq '"last_error_message":"[^"]+' <<<"$webhook_info"; then
      fail "Telegram webhook has last_error_message"
    else
      ok "Telegram webhook has no last_error_message"
    fi
  else
    fail "Telegram getWebhookInfo request failed"
  fi

  printf '\n'
  if [[ "$FAILED" -eq 0 ]]; then
    ok "Deploy checklist passed."
    if [[ "$WARNED" -eq 1 ]]; then
      warn "Checklist passed with warnings."
    fi
    exit 0
  fi

  fail "Deploy checklist failed."
  exit 1
}

main "$@"
