#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
DEPLOY_DIR=${DEPLOY_DIR:-$HOME/Services/Orchard-dev}
IMAGE_TAG=${IMAGE_TAG:-orchard:local}
CONTAINER_NAME=${CONTAINER_NAME:-orchard-dev}
SELF_SERVICE_NAME=${SELF_SERVICE_NAME:-orchard-dev}
SELF_CONTAINER_NAME=${SELF_CONTAINER_NAME:-orchard-dev}
HOST_PORT=${HOST_PORT:-4748}
HOST_BIND=${HOST_BIND:-127.0.0.1}
TARGET_COMPOSE_NAME=${TARGET_COMPOSE_NAME:-docker-compose.yml}
RUN_DOWN=true

show_url() {
  printf 'http://%s:%s\n' "$HOST_BIND" "$HOST_PORT"
}

show_help() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Build the local Orchard image and run a parallel test instance.

Options:
  --deploy-dir PATH       Deployment directory to create/update (default: ${DEPLOY_DIR})
  --no-down               Skip 'docker compose down' and run only 'docker compose up -d'
  --image-tag TAG         Image tag to build and deploy (default: ${IMAGE_TAG})
  --container-name NAME   Container name for the test instance (default: ${CONTAINER_NAME})
  --service-name NAME     Self-detection service name (default: ${SELF_SERVICE_NAME})
  --host-port PORT        Host port for the test UI (default: ${HOST_PORT})
  --host-bind ADDRESS     Host bind address for the test UI (default: ${HOST_BIND})
  --target-compose NAME   Compose filename in the deploy dir (default: ${TARGET_COMPOSE_NAME})
  --help, -h              Show this help message

Examples:
  $(basename "$0")
  $(basename "$0") --host-port 4749
  $(basename "$0") --deploy-dir ~/Services/Orchard-playground --container-name orchard-playground
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy-dir)
      DEPLOY_DIR=${2:-}
      shift 2
      ;;
    --no-down)
      RUN_DOWN=false
      shift
      ;;
    --image-tag)
      IMAGE_TAG=${2:-}
      shift 2
      ;;
    --container-name)
      CONTAINER_NAME=${2:-}
      shift 2
      ;;
    --service-name)
      SELF_SERVICE_NAME=${2:-}
      shift 2
      ;;
    --host-port)
      HOST_PORT=${2:-}
      shift 2
      ;;
    --host-bind)
      HOST_BIND=${2:-}
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

if [[ -z "$DEPLOY_DIR" || -z "$CONTAINER_NAME" || -z "$SELF_SERVICE_NAME" || -z "$HOST_PORT" || -z "$HOST_BIND" ]]; then
  echo "Deploy directory, names, bind address, and port must be non-empty." >&2
  exit 1
fi

if ! [[ "$HOST_PORT" =~ ^[0-9]+$ ]]; then
  echo "--host-port must be numeric." >&2
  exit 1
fi

if (( HOST_PORT < 1 || HOST_PORT > 65535 )); then
  echo "--host-port must be between 1 and 65535." >&2
  exit 1
fi

DEPLOY_DIR=$(realpath -m "$DEPLOY_DIR")
TARGET_COMPOSE_PATH="$DEPLOY_DIR/$TARGET_COMPOSE_NAME"

mkdir -p "$DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR/workspace" "$DEPLOY_DIR/orchard-data"

echo "[1/3] Building image $IMAGE_TAG from $SCRIPT_DIR"
sudo docker build -t "$IMAGE_TAG" "$SCRIPT_DIR"

echo "[2/3] Writing test-instance compose file to $TARGET_COMPOSE_PATH"
cat >"$TARGET_COMPOSE_PATH" <<EOF
services:
  orchard:
    image: $IMAGE_TAG
    container_name: $CONTAINER_NAME
    environment:
      PORT: 3000
      WORK_PATH: /workspace
      DATA_DIR: /data
      SCAN_DEPTH: 4
      MAX_PARALLEL_JOBS: 3
      DEFAULT_MODE: smart
      AUTO_REFRESH_SECONDS: 30
      SCHEDULED_SWEEP_ENABLED: false
      SCHEDULED_SWEEP_INTERVAL_MINUTES: 360
      SCHEDULED_SWEEP_MODE: smart
      ACTION_QUEUE_LIMIT: 50
      ACTION_COOLDOWN_MS: 1000
      SKIP_SELF_PROJECT: true
      SELF_SERVICE_NAME: $SELF_SERVICE_NAME
      SELF_CONTAINER_NAME: $CONTAINER_NAME
    ports:
      - "$HOST_BIND:$HOST_PORT:3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./workspace:/workspace
      - ./orchard-data:/data
    restart: unless-stopped
EOF

echo "[3/3] Restarting deployment in $DEPLOY_DIR"
pushd "$DEPLOY_DIR" >/dev/null
if [[ "$RUN_DOWN" == true ]]; then
  sudo docker compose -f "$TARGET_COMPOSE_NAME" down
fi
sudo docker compose -f "$TARGET_COMPOSE_NAME" up -d --remove-orphans
popd >/dev/null

echo "Deployment complete."
echo "Open Orchard test instance: $(show_url)"
