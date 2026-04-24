#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BG_DIR="$ROOT_DIR/infra/bluegreen"
RELEASE_LOG="$BG_DIR/.deploy/releases.jsonl"

MODE="${1:-full}"
TARGET_TAG="${2:-}"

case "$MODE" in
  full|api-only) ;;
  *)
    echo "[rollback][error] usage: $0 [full|api-only] [image_tag]"
    exit 1
    ;;
esac

if [[ ! -f "$ROOT_DIR/.env.production" ]]; then
  echo "[rollback][error] .env.production not found in project root"
  exit 1
fi

"$ROOT_DIR/scripts/prepare-service-env.sh" >/dev/null

current_container=""
current_image=""

if [[ "$MODE" == "api-only" ]]; then
  active_slot="$(tr -d '[:space:]' < "$BG_DIR/.active-slot-api" 2>/dev/null || echo "blue")"
  current_container="mlbb-api-${active_slot}"
else
  active_slot="$(tr -d '[:space:]' < "$BG_DIR/.active-slot" 2>/dev/null || echo "blue")"
  current_container="mlbb-web-${active_slot}"
fi

if docker inspect "$current_container" >/dev/null 2>&1; then
  current_image="$(docker inspect --format '{{.Config.Image}}' "$current_container")"
fi

if [[ -n "$current_image" ]]; then
  if [[ "$MODE" == "api-only" ]]; then
    CURRENT_TAG="${current_image##*:}"
    IMAGE_PREFIX_DEFAULT="${current_image%/api:*}"
  else
    CURRENT_TAG="${current_image##*:}"
    IMAGE_PREFIX_DEFAULT="${current_image%/web:*}"
  fi
else
  CURRENT_TAG=""
  IMAGE_PREFIX_DEFAULT="mlbb-local"
fi

IMAGE_PREFIX="${IMAGE_PREFIX:-$IMAGE_PREFIX_DEFAULT}"

if [[ -z "$TARGET_TAG" ]]; then
  if [[ ! -f "$RELEASE_LOG" ]]; then
    echo "[rollback][error] release log not found: $RELEASE_LOG"
    exit 1
  fi

  TARGET_TAG="$(
    tac "$RELEASE_LOG" \
      | grep -E '"image_tag":"' \
      | sed -n 's/.*"image_tag":"\([^"]*\)".*/\1/p' \
      | awk -v current="$CURRENT_TAG" '
          $0 != "" && $0 != current {
            print $0;
            exit
          }
        '
  )"
fi

if [[ -z "$TARGET_TAG" ]]; then
  echo "[rollback][error] unable to resolve rollback image tag"
  exit 1
fi

echo "[rollback] mode=$MODE image_prefix=$IMAGE_PREFIX target_tag=$TARGET_TAG current_tag=${CURRENT_TAG:-unknown}"

cd "$ROOT_DIR"
export IMAGE_PREFIX IMAGE_TAG="$TARGET_TAG"

if [[ "$MODE" == "api-only" ]]; then
  chmod +x scripts/deploy-api-vps.sh
  ./scripts/deploy-api-vps.sh
else
  chmod +x scripts/deploy-bluegreen.sh
  ./scripts/deploy-bluegreen.sh
fi

mkdir -p "$BG_DIR/.deploy"
api_slot="$(cat "$BG_DIR/.active-slot-api" 2>/dev/null || true)"
web_slot="$(cat "$BG_DIR/.active-slot" 2>/dev/null || true)"
printf '{"deployed_at":"%s","sha":"","image_tag":"%s","mode":"rollback-%s","actor":"%s","api_slot":"%s","web_slot":"%s","workflow":"manual","run_id":""}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$TARGET_TAG" \
  "$MODE" \
  "${USER:-unknown}" \
  "$api_slot" \
  "$web_slot" >> "$RELEASE_LOG"

echo "[rollback] completed"
