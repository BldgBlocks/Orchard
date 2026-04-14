#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
IMAGE_TAG=orchard:local
SOURCE_COMPOSE_FILE=docker-compose.yml
TARGET_COMPOSE_NAME=docker-compose.yml
SYNC_COMPOSE=false
RUN_DOWN=true
DEPLOY_DIR=""

show_help() {
  cat <<EOF
Usage: $(basename "$0") --deploy-dir PATH [OPTIONS]

Build the Orchard image from this repo, then restart an external deployment folder.

Required:
  --deploy-dir PATH       External deployment directory containing the runtime compose file

Options:
  --sync-compose          Copy ${SOURCE_COMPOSE_FILE} from this repo into the deploy directory
  --no-down               Skip 'docker compose down' and run only 'docker compose up -d'
  --image-tag TAG         Image tag to build and deploy (default: ${IMAGE_TAG})
  --target-compose NAME   Compose filename in the deploy dir (default: ${TARGET_COMPOSE_NAME})
  --help, -h              Show this help message

Examples:
  $(basename "$0") --deploy-dir ~/Orchard
  $(basename "$0") --deploy-dir ~/Orchard --sync-compose
  $(basename "$0") --deploy-dir ~/Orchard --image-tag orchard:local
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy-dir)
      DEPLOY_DIR=${2:-}
      shift 2
      ;;
    --sync-compose)
      SYNC_COMPOSE=true
      shift
      ;;
    --no-down)
      RUN_DOWN=false
      shift
      ;;
    --image-tag)
      IMAGE_TAG=${2:-}
      shift 2
      ;;
    --target-compose)
      TARGET_COMPOSE_NAME=${2:-}
      shift 2
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Use --help for usage." >&2
      exit 1
      ;;
  esac
done

if [[ -z "$DEPLOY_DIR" ]]; then
  echo "--deploy-dir is required." >&2
  echo "Use --help for usage." >&2
  exit 1
fi

DEPLOY_DIR=$(realpath -m "$DEPLOY_DIR")
SOURCE_COMPOSE_PATH="$SCRIPT_DIR/$SOURCE_COMPOSE_FILE"
TARGET_COMPOSE_PATH="$DEPLOY_DIR/$TARGET_COMPOSE_NAME"

if [[ ! -f "$SOURCE_COMPOSE_PATH" ]]; then
  echo "Source compose template not found: $SOURCE_COMPOSE_PATH" >&2
  exit 1
fi

mkdir -p "$DEPLOY_DIR"

echo "[1/3] Building image $IMAGE_TAG from $SCRIPT_DIR"
sudo docker build -t "$IMAGE_TAG" "$SCRIPT_DIR"

if [[ "$SYNC_COMPOSE" == true ]]; then
  echo "[2/3] Syncing compose template to $TARGET_COMPOSE_PATH"
  cp "$SOURCE_COMPOSE_PATH" "$TARGET_COMPOSE_PATH"
else
  echo "[2/3] Leaving external compose file untouched"
  if [[ ! -f "$TARGET_COMPOSE_PATH" ]]; then
    echo "Target compose file not found: $TARGET_COMPOSE_PATH" >&2
    echo "Either create it first or rerun with --sync-compose." >&2
    exit 1
  fi
fi

echo "[3/3] Restarting deployment in $DEPLOY_DIR"
pushd "$DEPLOY_DIR" >/dev/null
if [[ "$RUN_DOWN" == true ]]; then
  sudo docker compose -f "$TARGET_COMPOSE_NAME" down
fi
sudo docker compose -f "$TARGET_COMPOSE_NAME" up -d --remove-orphans
popd >/dev/null

echo "Deployment complete."
