#!/usr/bin/env bash
# Build and start the optional, loopback-only TimesFM service.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/kayroslab}"
ENV_FILE="${APP_DIR}/backend/fastify/.env"
COMPOSE_FILE="${APP_DIR}/deploy/timesfm.compose.yaml"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} is missing." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker Compose v2 is required when KAYROS_TIMESFM_ENABLED=true." >&2
  exit 1
fi

available_kb=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
if [[ -n "${available_kb:-}" && "${available_kb}" -lt 3145728 ]]; then
  echo "ERROR: TimesFM needs at least 3 GiB of available RAM during model startup." >&2
  exit 1
fi

cd "${APP_DIR}"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build --pull timesfm
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --wait --wait-timeout 900 timesfm

curl -fsS http://127.0.0.1:8001/health
echo " -> TimesFM health OK"
