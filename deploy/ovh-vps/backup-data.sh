#!/usr/bin/env bash
# backup-data.sh — Sauvegarde des donnees JSON KayrosLab.
# Usage (en root) : bash deploy/ovh-vps/backup-data.sh
# A programmer en cron :  0 3 * * * /opt/kayroslab/deploy/ovh-vps/backup-data.sh
set -euo pipefail

DATA_DIR="${DATA_DIR:-/opt/kayroslab/data}"
BACKUP_DIR="${BACKUP_DIR:-/opt/kayroslab/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "${BACKUP_DIR}"

# Verifier que le repertoire source existe
if [[ ! -d "${DATA_DIR}" ]]; then
  echo "ERREUR : ${DATA_DIR} introuvable." >&2
  exit 1
fi

# Compresser les fichiers JSON
BACKUP_FILE="${BACKUP_DIR}/kayros-data-${TIMESTAMP}.tar.gz"
tar -czf "${BACKUP_FILE}" -C "$(dirname "${DATA_DIR}")" "$(basename "${DATA_DIR}")" 2>/dev/null

echo "Sauvegarde creee : ${BACKUP_FILE} ($(du -h "${BACKUP_FILE}" | cut -f1))"

# Nettoyer les sauvegardes de plus de RETENTION_DAYS jours
find "${BACKUP_DIR}" -name "kayros-data-*.tar.gz" -type f -mtime "+${RETENTION_DAYS}" -delete
echo "Sauvegardes de plus de ${RETENTION_DAYS} jours nettoyees."

# Verifier l'integrite de la sauvegarde la plus recente
LATEST=$(ls -t "${BACKUP_DIR}"/kayros-data-*.tar.gz 2>/dev/null | head -1)
if [[ -n "${LATEST}" ]]; then
  tar -tzf "${LATEST}" > /dev/null 2>&1 && echo "Integrite OK : ${LATEST}" || echo "ERREUR : integrite echouee pour ${LATEST}" >&2
fi
