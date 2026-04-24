#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BG_DIR="$ROOT_DIR/infra/bluegreen"
STATE_FILE="$BG_DIR/.active-slot-api"

IMAGE_PREFIX="${IMAGE_PREFIX:-mlbb-local}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
IPV6_NETWORK_NAME="${IPV6_NETWORK_NAME:-mlbb_ipv6}"
IPV6_NETWORK_SUBNET="${IPV6_NETWORK_SUBNET:-fd12:3456:789a::/64}"

if [[ ! -f "$ROOT_DIR/.env.production" ]]; then
  echo "[deploy][error] .env.production belum ada di root project"
  exit 1
fi

ENV_FILE="$ROOT_DIR/.env.production"
"$ROOT_DIR/scripts/prepare-service-env.sh" >/dev/null

active_slot="blue"
if [[ -f "$STATE_FILE" ]]; then
  active_slot="$(tr -d '[:space:]' < "$STATE_FILE")"
fi

if [[ "$active_slot" == "blue" ]]; then
  next_slot="green"
  next_compose="docker-compose.green.yml"
  next_upstream="upstream-green.conf"
  prev_container="mlbb-api-blue"
  health_url="http://127.0.0.1:28787/health"
else
  next_slot="blue"
  next_compose="docker-compose.blue.yml"
  next_upstream="upstream-blue.conf"
  prev_container="mlbb-api-green"
  health_url="http://127.0.0.1:18787/health"
fi

echo "[deploy] Active API slot: $active_slot"
echo "[deploy] Deploying API to: $next_slot"

cd "$BG_DIR"

if ! docker network inspect "$IPV6_NETWORK_NAME" >/dev/null 2>&1; then
  docker network create --ipv6 --subnet "$IPV6_NETWORK_SUBNET" "$IPV6_NETWORK_NAME" >/dev/null
fi

shared_compose_args=(-f docker-compose.shared.yml)

for override_file in \
  "$BG_DIR/docker-compose.shared.override.yml" \
  "/opt/mlbb-worker/infra/bluegreen/docker-compose.shared.override.yml"
do
  if [[ -f "$override_file" ]]; then
    shared_compose_args+=(-f "$override_file")
    break
  fi
done

extract_upstream_block() {
  local name="$1"
  local file="$2"
  awk -v upstream_name="$name" '
    $0 ~ "^upstream " upstream_name " \\{" { print; capture=1; next }
    capture { print }
    capture && $0 == "}" { exit }
  ' "$file"
}

docker compose --env-file "$ENV_FILE" "${shared_compose_args[@]}" up -d postgres redis nginx

docker build -f "$BG_DIR/Dockerfile.api" -t "$IMAGE_PREFIX/api:$IMAGE_TAG" "$ROOT_DIR"

export IMAGE_PREFIX IMAGE_TAG
docker compose --env-file "$ENV_FILE" -f "$next_compose" up -d api

for attempt in {1..30}; do
  if curl -fsS "$health_url" >/dev/null; then
    api_upstream="$(extract_upstream_block "active_api" "$next_upstream")"
    web_upstream="$(extract_upstream_block "active_web" "active-upstream.conf")"

    if [[ -z "$web_upstream" ]]; then
      web_upstream="$(extract_upstream_block "active_web" "$next_upstream")"
    fi

    {
      printf '%s\n\n' "$api_upstream"
      printf '%s\n' "$web_upstream"
    } > active-upstream.conf

    docker compose --env-file "$ENV_FILE" "${shared_compose_args[@]}" exec -T nginx nginx -s reload
    printf '%s\n' "$next_slot" > "$STATE_FILE"
    docker rm -f "$prev_container" >/dev/null 2>&1 || true
    echo "[deploy] Switched active API slot to $next_slot"
    exit 0
  fi
  sleep 2
done

echo "[deploy][error] API health check failed on $next_slot. Rolling back."
docker compose --env-file "$ENV_FILE" -f "$next_compose" rm -sf api || true
exit 1
