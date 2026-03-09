#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BG_DIR="$ROOT_DIR/infra/bluegreen"
STATE_FILE="$BG_DIR/.active-slot"

if [[ -z "${IMAGE_PREFIX:-}" || -z "${IMAGE_TAG:-}" ]]; then
  echo "[deploy][error] IMAGE_PREFIX dan IMAGE_TAG wajib di-set"
  exit 1
fi

if [[ -n "${GHCR_USERNAME:-}" && -n "${GHCR_TOKEN:-}" ]]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
fi

if [[ ! -f "$ROOT_DIR/.env.production" ]]; then
  echo "[deploy][error] .env.production belum ada di root project"
  exit 1
fi

active_slot="blue"
if [[ -f "$STATE_FILE" ]]; then
  active_slot="$(tr -d '[:space:]' < "$STATE_FILE")"
fi

if [[ "$active_slot" == "blue" ]]; then
  next_slot="green"
  next_compose="docker-compose.green.yml"
  next_upstream="upstream-green.conf"
  prev_compose="docker-compose.blue.yml"
else
  next_slot="blue"
  next_compose="docker-compose.blue.yml"
  next_upstream="upstream-blue.conf"
  prev_compose="docker-compose.green.yml"
fi

echo "[deploy] Active slot: $active_slot"
echo "[deploy] Deploying new version to: $next_slot"

export IMAGE_PREFIX IMAGE_TAG
cd "$BG_DIR"

docker compose -f docker-compose.shared.yml up -d postgres redis nginx

docker compose -f "$next_compose" pull
docker compose -f "$next_compose" up -d

if [[ "$next_slot" == "blue" ]]; then
  health_url="http://127.0.0.1:18787/health"
else
  health_url="http://127.0.0.1:28787/health"
fi

for attempt in {1..30}; do
  if curl -fsS "$health_url" >/dev/null; then
    cp "$next_upstream" active-upstream.conf
    docker compose -f docker-compose.shared.yml exec -T nginx nginx -s reload
    printf '%s\n' "$next_slot" > "$STATE_FILE"
    docker compose -f "$prev_compose" down || true
    echo "[deploy] Switched active slot to $next_slot"
    exit 0
  fi
  sleep 2
done

echo "[deploy][error] health check failed on $next_slot. Rolling back."
docker compose -f "$next_compose" down || true
exit 1
