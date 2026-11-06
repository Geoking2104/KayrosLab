#!/usr/bin/env bash
# backup-data.sh — Sauvegarde JSON + Postgres (si configuré).
# Usage (root) : bash deploy/ovh-vps/backup-data.sh
# Cron         : 0 3 * * * /opt/kayroslab/deploy/ovh-vps/backup-data.sh >> /var/log/kayros-backup.log 2>&1
set -euo pipefail

ROOT="${KAYROS_ROOT:-/opt/kayroslab}"
DATA_DIR="${DATA_DIR:-${ROOT}/data}"
BACKUP_DIR="${BACKUP_DIR:-${ROOT}/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "${BACKUP_DIR}"

# --- 1. JSON data dir ---
if [[ -d "${DATA_DIR}" ]]; then
  BACKUP_FILE="${BACKUP_DIR}/kayros-data-${TIMESTAMP}.tar.gz"
  tar -czf "${BACKUP_FILE}" -C "$(dirname "${DATA_DIR}")" "$(basename "${DATA_DIR}")" 2>/dev/null || true
  if [[ -f "${BACKUP_FILE}" ]]; then
    echo "JSON : ${BACKUP_FILE} ($(du -h "${BACKUP_FILE}" | cut -f1))"
    tar -tzf "${BACKUP_FILE}" > /dev/null 2>&1 && echo "JSON intégrité OK" || echo "WARN JSON intégrité" >&2
  fi
  find "${BACKUP_DIR}" -name 'kayros-data-*.tar.gz' -type f -mtime "+${RETENTION_DAYS}" -delete
else
  echo "SKIP JSON : ${DATA_DIR} absent"
fi

# --- 2. Postgres (si DATABASE_URL) ---
if [[ -x "${SCRIPT_DIR}/backup-pg.sh" ]] || [[ -f "${SCRIPT_DIR}/backup-pg.sh" ]]; then
  bash "${SCRIPT_DIR}/backup-pg.sh" || echo "WARN pg_dump a échoué (non bloquant pour JSON)" >&2
else
  echo "SKIP pg : backup-pg.sh introuvable"
fi

echo "Backup terminé $(date -Iseconds)"
