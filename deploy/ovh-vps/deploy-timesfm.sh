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

MEMINFO_FILE="${MEMINFO_FILE:-/proc/meminfo}"
available_kb=$(awk '/MemAvailable:/ {print $2}' "${MEMINFO_FILE}")
if [[ -n "${available_kb:-}" && "${available_kb}" -lt 3145728 ]]; then
  # RAM insuffisante : TimesFM est optionnel (la projection déterministe reste
  # disponible). On avertit sans bloquer le déploiement de l'API, sauf si
  # KAYROS_TIMESFM_STRICT=1. Le conteneur TimesFM existant n'est pas touché.
  echo "WARNING: TimesFM needs at least 3 GiB of available RAM during model startup (available: $((available_kb / 1024)) MiB). Skipping TimesFM rebuild; deterministic projection remains available." >&2
  {
    echo "--- diagnostic mémoire (lecture seule) ---"
    free -h 2>/dev/null || true
    ps aux --sort=-%mem 2>/dev/null | head -n 11 || true
    docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}' 2>/dev/null || true
  } >&2
  if [[ "${KAYROS_TIMESFM_STRICT:-0}" =~ ^(1|true|yes|on)$ ]]; then
    exit 1
  fi
  exit 0
fi

cd "${APP_DIR}"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build --pull timesfm
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --wait --wait-timeout 900 timesfm

curl -fsS http://127.0.0.1:8001/health
echo " -> TimesFM health OK"
