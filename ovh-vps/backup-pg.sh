#!/usr/bin/env bash
# backup-pg.sh — pg_dump de la base KayrosLab
# Usage : bash deploy/ovh-vps/backup-pg.sh
# Cron  : 0 3 * * * /opt/kayroslab/deploy/ovh-vps/backup-pg.sh >> /var/log/kayros-pg-backup.log 2>&1
#
# Env :
#   DATABASE_URL / KAYROS_DATABASE_URL  (priorité)
#   ou lecture depuis backend/fastify/.env
#   BACKUP_DIR      défaut /opt/kayroslab/backups
#   RETENTION_DAYS  défaut 30
set -euo pipefail

ROOT="${KAYROS_ROOT:-/opt/kayroslab}"
BACKUP_DIR="${BACKUP_DIR:-${ROOT}/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
ENV_FILE="${ENV_FILE:-${ROOT}/backend/fastify/.env}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "${BACKUP_DIR}"

# --- resolve DATABASE_URL ---
DB_URL="${DATABASE_URL:-${KAYROS_DATABASE_URL:-}}"
if [[ -z "${DB_URL}" && -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  DB_URL=$(grep -E '^(DATABASE_URL|KAYROS_DATABASE_URL)=' "${ENV_FILE}" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
fi

if [[ -z "${DB_URL}" ]]; then
  echo "SKIP pg_dump : DATABASE_URL non défini (fichier JSON seulement)."
  exit 0
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERREUR : pg_dump introuvable (apt install postgresql-client)" >&2
  exit 1
fi

OUT="${BACKUP_DIR}/kayros-pg-${TIMESTAMP}.sql.gz"
echo "pg_dump → ${OUT}"

# Format plain + gzip (portable restore: gunzip -c | psql)
pg_dump --no-owner --no-acl --format=plain "${DB_URL}" | gzip -c > "${OUT}"

SIZE=$(du -h "${OUT}" | cut -f1)
echo "OK ${OUT} (${SIZE})"

# Intégrité gzip
if gzip -t "${OUT}" 2>/dev/null; then
  echo "Intégrité gzip OK"
else
  echo "ERREUR : archive gzip corrompue" >&2
  exit 1
fi

# Rétention
find "${BACKUP_DIR}" -name 'kayros-pg-*.sql.gz' -type f -mtime "+${RETENTION_DAYS}" -delete
echo "Rétention : ${RETENTION_DAYS} jours (kayros-pg-*.sql.gz)"

# Manifeste simple
ls -lh "${BACKUP_DIR}"/kayros-pg-*.sql.gz 2>/dev/null | tail -5 || true
