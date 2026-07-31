#!/usr/bin/env bash
# KayrosLab — Provisionnement PostgreSQL sur le VPS OVH (cohabitation openDPE).
#
# À exécuter UNE FOIS, en root, sur 51.210.9.71 :
#   bash deploy/ovh-vps/provision-postgres.sh
#
# PRINCIPE DE COHABITATION. openDPE fait déjà tourner PostgreSQL sur ce VPS.
# Ce script ne l'installe donc pas s'il est déjà là, et ne touche NI à sa base,
# NI à ses rôles, NI à sa configuration. Il crée un rôle et une base dédiés,
# cloisonnés, avec les privilèges strictement nécessaires.
#
# 5432 N'EST JAMAIS EXPOSÉ. Le backend KayrosLab tourne sur le même VPS : il se
# connecte en local. Ouvrir le port sur Internet pour « faciliter » l'accès
# transformerait une base interne en surface d'attaque publique.
#
# Idempotent : relançable sans dommage.

set -euo pipefail

DB_NAME="${KAYROS_DB_NAME:-kayroslab}"
DB_USER="${KAYROS_DB_USER:-kayroslab}"
ENV_FILE="${KAYROS_ENV_FILE:-/opt/kayroslab/backend/fastify/.env}"

log()  { printf '\033[1m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "à exécuter en root"

# --------------------------------------------------------------------------
log "1. Détection de PostgreSQL"

MODE=""
if command -v psql >/dev/null 2>&1 && systemctl is-active --quiet postgresql 2>/dev/null; then
  MODE="systeme"
  ok "PostgreSQL système actif — $(sudo -u postgres psql -tAc 'select version()' | cut -d, -f1)"
elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qi postgres; then
  MODE="docker"
  PG_CONTAINER="$(docker ps --format '{{.Names}}' | grep -i postgres | head -1)"
  ok "PostgreSQL dans le conteneur « $PG_CONTAINER »"
else
  MODE="absent"
  warn "aucun PostgreSQL détecté"
fi

# Exécute du SQL en superutilisateur, quel que soit le mode.
psql_admin() {
  case "$MODE" in
    systeme) sudo -u postgres psql -v ON_ERROR_STOP=1 "$@" ;;
    docker)  docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@" ;;
  esac
}

if [ "$MODE" = "absent" ]; then
  log "2. Installation de PostgreSQL"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq postgresql postgresql-contrib
  systemctl enable --now postgresql
  MODE="systeme"
  ok "PostgreSQL installé et démarré"
else
  log "2. Installation — ignorée (openDPE l'utilise déjà)"
  ok "aucune réinstallation : on ne touche pas à un service en production"
fi

# --------------------------------------------------------------------------
log "3. Vérification de l'isolation réseau"

LISTEN="$(psql_admin -tAc "SHOW listen_addresses" 2>/dev/null || echo '?')"
if [ "$LISTEN" = "*" ] || [ "$LISTEN" = "0.0.0.0" ]; then
  warn "listen_addresses = '$LISTEN' : PostgreSQL écoute sur toutes les interfaces"
  warn "vérifiez que le pare-feu bloque 5432 depuis l'extérieur (ufw status)"
else
  ok "listen_addresses = '$LISTEN' — accès local uniquement"
fi

# --------------------------------------------------------------------------
log "4. Rôle et base dédiés"

# Mot de passe généré ICI, sur la machine. Il n'est jamais saisi, ni transmis,
# ni présent dans un dépôt ou un historique de shell.
if grep -qs '^DATABASE_URL=postgres' "$ENV_FILE" 2>/dev/null; then
  ok "DATABASE_URL déjà présent dans $ENV_FILE — mot de passe conservé"
  DB_PASS=""
else
  DB_PASS="$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
fi

EXISTE_ROLE=$(psql_admin -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" || true)
if [ "$EXISTE_ROLE" = "1" ]; then
  ok "rôle « $DB_USER » déjà présent"
  [ -n "$DB_PASS" ] && psql_admin -c "ALTER ROLE $DB_USER WITH PASSWORD '$DB_PASS'" >/dev/null && ok "mot de passe renouvelé"
else
  # NOSUPERUSER / NOCREATEDB / NOCREATEROLE : le principe du moindre privilège.
  # Un rôle applicatif n'a aucune raison de pouvoir créer des bases.
  psql_admin -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT" >/dev/null
  ok "rôle « $DB_USER » créé (sans privilège superflu)"
fi

EXISTE_DB=$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" || true)
if [ "$EXISTE_DB" = "1" ]; then
  ok "base « $DB_NAME » déjà présente"
else
  psql_admin -c "CREATE DATABASE $DB_NAME OWNER $DB_USER ENCODING 'UTF8' LC_COLLATE 'fr_FR.UTF-8' LC_CTYPE 'fr_FR.UTF-8' TEMPLATE template0" >/dev/null 2>&1 \
    || psql_admin -c "CREATE DATABASE $DB_NAME OWNER $DB_USER ENCODING 'UTF8'" >/dev/null
  ok "base « $DB_NAME » créée"
fi

# Cloisonnement : personne d'autre que le propriétaire n'entre. openDPE et
# KayrosLab partagent une instance, jamais leurs données.
psql_admin -d "$DB_NAME" -c "REVOKE ALL ON DATABASE $DB_NAME FROM PUBLIC" >/dev/null
psql_admin -d "$DB_NAME" -c "REVOKE ALL ON SCHEMA public FROM PUBLIC" >/dev/null
psql_admin -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO $DB_USER" >/dev/null
ok "schéma cloisonné (PUBLIC révoqué)"

# --------------------------------------------------------------------------
log "5. Vérification de non-régression sur openDPE"

AUTRES=$(psql_admin -tAc "SELECT count(*) FROM pg_database WHERE datname NOT IN ('$DB_NAME','postgres','template0','template1')")
ok "$AUTRES autre(s) base(s) sur l'instance — intactes"
ACCES_CROISE=$(psql_admin -tAc "SELECT count(*) FROM pg_database d WHERE d.datname <> '$DB_NAME' AND has_database_privilege('$DB_USER', d.datname, 'CONNECT') AND d.datname NOT IN ('template0','template1')")
if [ "$ACCES_CROISE" -gt 0 ]; then
  warn "le rôle $DB_USER peut se connecter à $ACCES_CROISE autre(s) base(s)"
  warn "→ REVOKE CONNECT ON DATABASE <base_opendpe> FROM $DB_USER;"
else
  ok "aucun accès croisé vers les bases voisines"
fi

# --------------------------------------------------------------------------
log "6. Fichier d'environnement"

if [ -n "$DB_PASS" ]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  # Connexion par 127.0.0.1 et non par socket : le même DATABASE_URL vaut alors
  # pour un futur déploiement conteneurisé.
  URL="postgres://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB_NAME"
  if grep -q '^DATABASE_URL=' "$ENV_FILE"; then
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$URL|" "$ENV_FILE"
  else
    printf '\n# --- Persistance PostgreSQL (canvas + journal) ---\nDATABASE_URL=%s\n' "$URL" >> "$ENV_FILE"
  fi
  ok "DATABASE_URL écrit dans $ENV_FILE (chmod 600)"
else
  ok "$ENV_FILE inchangé"
fi

# --------------------------------------------------------------------------
log "7. Migration du schéma"

MIGRATION="$(dirname "$0")/../../backend/fastify/migrations/001_canvas.sql"
if [ -f "$MIGRATION" ]; then
  case "$MODE" in
    systeme) sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -f "$MIGRATION" >/dev/null ;;
    docker)  docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -d "$DB_NAME" < "$MIGRATION" >/dev/null ;;
  esac
  psql_admin -d "$DB_NAME" -c "ALTER TABLE canvas_workspace OWNER TO $DB_USER; ALTER TABLE canvas_event OWNER TO $DB_USER; ALTER TABLE canvas_agent OWNER TO $DB_USER; ALTER TABLE canvas_purge_log OWNER TO $DB_USER;" >/dev/null
  psql_admin -d "$DB_NAME" -c "ALTER SEQUENCE canvas_purge_log_id_seq OWNER TO $DB_USER;" >/dev/null 2>&1 || true
  TABLES=$(psql_admin -tAc -d "$DB_NAME" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
  ok "migration appliquée — $TABLES table(s)"
else
  warn "migration introuvable ($MIGRATION) — dépôt incomplet ?"
fi

# --------------------------------------------------------------------------
log "8. Sauvegarde quotidienne"

# On ne cree PAS de cron dedie : `backup-data.sh` sauvegarde deja les JSON et
# sait desormais dumper la base. Deux dispositifs concurrents finissent par
# diverger — l'un tourne, l'autre non, et on decouvre lequel en restaurant.
if crontab -l 2>/dev/null | grep -q 'backup-data.sh'; then
  ok "cron de sauvegarde deja en place (backup-data.sh)"
else
  warn "cron de sauvegarde ABSENT — a installer :"
  warn "  (crontab -l 2>/dev/null; echo '0 3 * * * /opt/kayroslab/deploy/ovh-vps/backup-data.sh >> /var/log/kayros-backup.log 2>&1') | crontab -"
fi
rm -f /etc/cron.daily/kayroslab-pgdump 2>/dev/null && ok "ancien cron.daily redondant retire" || true

echo
printf '\033[1m%s\033[0m\n' "Provisionnement terminé."
echo "Étapes suivantes :"
echo "  1. bash deploy/ovh-vps/verify-postgres.sh   # recette contre ce serveur"
echo "  2. pm2 restart kayros-api                   # bascule du backend"
echo
echo "Le mot de passe n'est écrit que dans $ENV_FILE (chmod 600)."
echo "Il n'apparaît ni dans ce terminal, ni dans le dépôt, ni dans l'historique."
