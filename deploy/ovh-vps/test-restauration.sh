#!/usr/bin/env bash
# test-restauration.sh — Eprouve REELLEMENT la sauvegarde PostgreSQL.
#
# Une sauvegarde dont la restauration n'a jamais ete essayee n'est pas une
# sauvegarde : c'est un fichier dont on espere qu'il servira. Ce script restaure
# le dernier dump dans une base JETABLE, compare le contenu a la production,
# puis supprime la base de test.
#
#   bash deploy/ovh-vps/test-restauration.sh
#
# NON DESTRUCTIF : la base de production n'est jamais touchee. Seule une base
# temporaire `kayroslab_restore_test` est creee, puis supprimee.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/kayroslab/backups}"
DB_NAME="${KAYROS_DB_NAME:-kayroslab}"
DB_TEST="kayroslab_restore_test"

ok()   { printf '  \033[32m[ok]\033[0m %s\n' "$*"; }
ko()   { printf '  \033[31m[KO]\033[0m %s\n' "$*"; ECHECS=$((ECHECS+1)); }
info() { printf '\n\033[1m> %s\033[0m\n' "$*"; }
ECHECS=0

psqlq() { sudo -u postgres psql -tAc "$1" "${2:-postgres}" 2>/dev/null; }

trap 'sudo -u postgres dropdb --if-exists "$DB_TEST" 2>/dev/null || true' EXIT

# ---------------------------------------------------------------------------
info "1. Dump le plus recent"

DUMP=$(ls -t "${BACKUP_DIR}"/kayros-db-*.dump 2>/dev/null | head -1 || true)
if [[ -z "${DUMP}" ]]; then
  echo "  Aucun dump dans ${BACKUP_DIR}. Lancer d'abord backup-data.sh." >&2
  exit 2
fi
ok "$(basename "${DUMP}") ($(du -h "${DUMP}" | cut -f1), $(date -r "${DUMP}" '+%d/%m %H:%M'))"

AGE_H=$(( ( $(date +%s) - $(date -r "${DUMP}" +%s) ) / 3600 ))
if [[ ${AGE_H} -gt 48 ]]; then
  ko "dump vieux de ${AGE_H} h — le cron tourne-t-il ?"
else
  ok "age : ${AGE_H} h"
fi

# ---------------------------------------------------------------------------
info "2. Lisibilite du dump"

if pg_restore -l "${DUMP}" > /dev/null 2>&1; then
  ok "table des matieres lisible ($(pg_restore -l "${DUMP}" | grep -c '^[0-9]') objets)"
else
  ko "dump illisible — inutilisable pour restaurer"
  exit 1
fi

# ---------------------------------------------------------------------------
info "3. Restauration dans une base jetable"

sudo -u postgres dropdb --if-exists "${DB_TEST}"
sudo -u postgres createdb "${DB_TEST}"
if sudo -u postgres pg_restore -d "${DB_TEST}" --no-owner --no-privileges "${DUMP}" 2>/tmp/restore.err; then
  ok "restauration sans erreur"
else
  # pg_restore signale des avertissements benins (proprietaires, extensions).
  # On distingue l'avertissement de l'echec reel.
  if grep -qi 'error' /tmp/restore.err; then
    ko "erreurs de restauration :"; sed 's/^/      /' /tmp/restore.err | head -5
  else
    ok "restauration avec avertissements benins"
  fi
fi

# ---------------------------------------------------------------------------
info "4. Comparaison avec la production"

TABLES="canvas_workspace canvas_event canvas_agent canvas_purge_log"
for t in ${TABLES}; do
  existe=$(psqlq "SELECT count(*) FROM information_schema.tables WHERE table_name='${t}'" "${DB_TEST}")
  if [[ "${existe}" != "1" ]]; then ko "table ${t} absente de la restauration"; continue; fi
  prod=$(psqlq "SELECT count(*) FROM ${t}" "${DB_NAME}" || echo '?')
  test=$(psqlq "SELECT count(*) FROM ${t}" "${DB_TEST}" || echo '?')
  # Le dump precede les ecritures survenues depuis : la restauration peut
  # legitimement contenir MOINS de lignes. Elle ne peut pas en contenir PLUS.
  if [[ "${test}" -gt "${prod}" ]] 2>/dev/null; then
    ko "${t} : ${test} lignes restaurees > ${prod} en production (incoherent)"
  else
    ok "${t} : ${test} lignes restaurees (production : ${prod})"
  fi
done

# ---------------------------------------------------------------------------
info "5. Contraintes et declencheurs"

# Le trigger append-only survit-il a la restauration ? S'il disparait, l'audit
# restaure serait modifiable — la garantie ne tiendrait plus apres sinistre.
trg=$(psqlq "SELECT count(*) FROM pg_trigger WHERE tgname='trg_canvas_event_immuable'" "${DB_TEST}")
[[ "${trg}" == "1" ]] && ok "trigger append-only restaure" || ko "trigger append-only ABSENT apres restauration"

chk=$(psqlq "SELECT count(*) FROM pg_constraint WHERE conrelid='canvas_agent'::regclass AND contype='c'" "${DB_TEST}")
[[ "${chk}" -ge 1 ]] && ok "contrainte CHECK (EF-243) restauree" || ko "contrainte CHECK absente"

idx=$(psqlq "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename LIKE 'canvas_%'" "${DB_TEST}")
[[ "${idx}" -ge 5 ]] && ok "${idx} index restaures" || ko "seulement ${idx} index restaures"

# ---------------------------------------------------------------------------
info "6. Integrite du journal restaure"

# Le chainage par hachage doit tenir apres restauration, sinon l'audit
# reconstruit ne vaut rien.
rompu=$(psqlq "
  SELECT count(*) FROM (
    SELECT workspace_id, seq, prev_hash,
           lag(hash) OVER (PARTITION BY workspace_id ORDER BY seq) AS attendu
      FROM canvas_event
  ) t WHERE attendu IS NOT NULL AND prev_hash <> attendu" "${DB_TEST}")
[[ "${rompu}" == "0" ]] && ok "chainage du journal intact" || ko "${rompu} rupture(s) de chainage"

# ---------------------------------------------------------------------------
info "7. Nettoyage"
sudo -u postgres dropdb --if-exists "${DB_TEST}"
ok "base de test supprimee — production intacte"

echo
if [[ ${ECHECS} -eq 0 ]]; then
  printf '\033[32m%s\033[0m\n' "RESTAURATION VALIDEE — la sauvegarde est exploitable."
  printf '%s\n' "Commande de restauration reelle, le jour venu :"
  printf '%s\n' "  sudo -u postgres pg_restore -d ${DB_NAME} --clean --if-exists ${DUMP}"
else
  printf '\033[31m%s\033[0m\n' "${ECHECS} PROBLEME(S) — la sauvegarde n'est PAS fiable en l'etat."
  exit 1
fi
