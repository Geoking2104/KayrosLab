#!/usr/bin/env bash
# backup-data.sh — Sauvegarde KayrosLab : fichiers JSON + base PostgreSQL.
# Usage (en root) : bash deploy/ovh-vps/backup-data.sh
# A programmer en cron :  0 3 * * * /opt/kayroslab/deploy/ovh-vps/backup-data.sh
#
# UN SEUL mecanisme de sauvegarde, un seul cron, une seule retention. Deux
# dispositifs concurrents finissent toujours par diverger : l'un tourne, l'autre
# non, et on decouvre lequel le jour de la restauration.
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

# ---------------------------------------------------------------------------
# Base PostgreSQL (si configuree)
#
# Le dump suit le MEME repertoire, la MEME retention et le MEME cron que les
# JSON : au moment de restaurer, on veut un couple coherent, pas deux jeux
# sauvegardes a des heures differentes.
# ---------------------------------------------------------------------------
ENV_FILE="${ENV_FILE:-/opt/kayroslab/backend/fastify/.env}"
DB_NAME="${KAYROS_DB_NAME:-kayroslab}"

if [[ -f "${ENV_FILE}" ]] && grep -q '^DATABASE_URL=postgres' "${ENV_FILE}" 2>/dev/null; then
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" 2>/dev/null | grep -q 1; then
    DUMP_FILE="${BACKUP_DIR}/kayros-db-${TIMESTAMP}.dump"
    # Format `custom` (-Fc) : compresse, et surtout restaurable table par table
    # avec pg_restore, ce qu'un dump SQL brut ne permet pas.
    sudo -u postgres pg_dump -Fc "${DB_NAME}" > "${DUMP_FILE}"
    echo "Dump PostgreSQL cree : ${DUMP_FILE} ($(du -h "${DUMP_FILE}" | cut -f1))"

    # Integrite : pg_restore -l lit l'entete et la table des matieres. Un dump
    # tronque echoue ici, et non six mois plus tard au pire moment.
    if pg_restore -l "${DUMP_FILE}" > /dev/null 2>&1; then
      echo "Integrite OK : ${DUMP_FILE}"
    else
      echo "ERREUR : dump PostgreSQL illisible — ${DUMP_FILE}" >&2
      exit 1
    fi

    find "${BACKUP_DIR}" -name 'kayros-db-*.dump' -type f -mtime "+${RETENTION_DAYS}" -delete
  else
    echo "AVERTISSEMENT : DATABASE_URL configure mais base '${DB_NAME}' introuvable." >&2
  fi
else
  echo "PostgreSQL non configure — sauvegarde des JSON uniquement."
fi
