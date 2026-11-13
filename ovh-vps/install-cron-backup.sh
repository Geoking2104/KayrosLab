#!/usr/bin/env bash
# install-cron-backup.sh — installe le cron quotidien 03:00 (JSON + pg_dump)
set -euo pipefail

ROOT="${KAYROS_ROOT:-/opt/kayroslab}"
CRON_LINE="0 3 * * * ${ROOT}/deploy/ovh-vps/backup-data.sh >> /var/log/kayros-backup.log 2>&1"

chmod +x "${ROOT}/deploy/ovh-vps/backup-data.sh" "${ROOT}/deploy/ovh-vps/backup-pg.sh" 2>/dev/null || true
mkdir -p "${ROOT}/backups"

# Idempotent : retire ancienne ligne kayros backup puis ajoute
(crontab -l 2>/dev/null | grep -v 'kayroslab/deploy/ovh-vps/backup-data.sh' || true; echo "${CRON_LINE}") | crontab -

echo "Cron installe :"
echo "  ${CRON_LINE}"
echo "Test manuel : bash ${ROOT}/deploy/ovh-vps/backup-data.sh"
