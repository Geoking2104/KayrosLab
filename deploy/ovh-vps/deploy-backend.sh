#!/usr/bin/env bash
# deploy-backend.sh — Installe et (re)lance le backend KayrosLab via PM2.
# Usage (en root) :  APP_DIR=/opt/kayroslab bash deploy/ovh-vps/deploy-backend.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/kayroslab}"
BACKEND_DIR="${APP_DIR}/backend/fastify"
DATA_DIR="${DATA_DIR:-/opt/kayroslab/data}"

mkdir -p "${DATA_DIR}"
chmod 700 "${DATA_DIR}"
mkdir -p /var/log/pm2
mkdir -p /opt/kayroslab/backups

if [[ ! -f "${BACKEND_DIR}/.env" ]]; then
  echo "ERREUR : ${BACKEND_DIR}/.env introuvable." >&2
  echo "Copier .env.sample et renseigner KAYROS_AUTH_SECRET avant de continuer." >&2
  exit 1
fi

if grep -qE '^KAYROS_AUTH_SECRET=\s*$' "${BACKEND_DIR}/.env"; then
  SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))")
  sed -i "s|^KAYROS_AUTH_SECRET=.*|KAYROS_AUTH_SECRET=${SECRET}|" "${BACKEND_DIR}/.env"
  echo "KAYROS_AUTH_SECRET genere automatiquement."
fi

# ── Dependances (inclut pg) ──────────────────────────────────────────────────
cd "${BACKEND_DIR}"
worktree=""
if ! worktree=$(git -C "${APP_DIR}" rev-parse --is-inside-work-tree 2>/dev/null) || [[ "${worktree}" != "true" ]]; then
  echo "ERREUR : ${APP_DIR} n'est pas un dépôt Git lisible; installation interrompue." >&2
  exit 1
fi
lock_status=0
git -C "${APP_DIR}" ls-files --error-unmatch backend/fastify/package-lock.json >/dev/null 2>&1 || lock_status=$?
case "${lock_status}" in
  0)
    npm ci --omit=dev
    ;;
  1)
    # Le dépôt ne versionne pas de lockfile Fastify. Supprimer une ancienne copie
    # locale afin qu'elle ne rende pas npm install incohérent sur le VPS.
    rm -f package-lock.json
    npm install --omit=dev --no-package-lock
    ;;
  *)
    echo "ERREUR : impossible de déterminer si package-lock.json est versionné (git=${lock_status})." >&2
    exit "${lock_status}"
    ;;
esac

# ── Postgres schema (idempotent) si DATABASE_URL present ─────────────────────
DB_URL=""
if grep -qE '^DATABASE_URL=.+' "${BACKEND_DIR}/.env" 2>/dev/null; then
  DB_URL=$(grep -E '^DATABASE_URL=' "${BACKEND_DIR}/.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
elif grep -qE '^KAYROS_DATABASE_URL=.+' "${BACKEND_DIR}/.env" 2>/dev/null; then
  DB_URL=$(grep -E '^KAYROS_DATABASE_URL=' "${BACKEND_DIR}/.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
fi
if [[ -n "${DB_URL}" ]]; then
  # Verifier la joignabilite AVANT de demarrer : une base hebergee ailleurs
  # (cluster mutualise OVH par exemple) filtre souvent par IP source, et le
  # symptome serait sinon un backend qui demarre en apparence sain puis
  # retombe silencieusement sur le store fichier.
  if command -v psql >/dev/null 2>&1; then
    echo "Verification de la connexion Postgres…"
    if psql "${DB_URL}" -c 'select 1' >/dev/null 2>&1; then
      echo "Postgres joignable. Application du schema…"
      psql "${DB_URL}" -f "${APP_DIR}/core/sql/schema.sql" \
        || echo "AVERTISSEMENT : schema.sql a echoue (droits DDL ?)." >&2
    else
      # Non fatal : le backend demarre sur le store fichier. Mais l'operateur
      # doit savoir que Postgres a ete demande et n'a pas repondu, plutot que
      # de le decouvrir a la premiere decision perdue.
      echo "AVERTISSEMENT : DATABASE_URL defini mais la base est injoignable." >&2
      echo "  Verifier que l'IP du VPS est autorisee cote hebergeur." >&2
      echo "  Le backend demarrera sur le store fichier." >&2
    fi
  else
    echo "AVERTISSEMENT : psql absent — installer postgresql-client pour auto-schema." >&2
  fi
else
  echo "DATABASE_URL non defini — stores fichier/memoire."
fi

# ── Tests du coeur ───────────────────────────────────────────────────────────
if [[ -d "${APP_DIR}/core" ]]; then
  ( cd "${APP_DIR}/core" && node --test ) || { echo "ERREUR : tests du coeur en echec, deploiement interrompu." >&2; exit 1; }
fi

pm2 startOrReload "${BACKEND_DIR}/ecosystem.config.cjs" --env production
pm2 save

NGINX_CONF="${APP_DIR}/deploy/ovh-vps/nginx-kayroslab-api.conf"
if [[ -f "${NGINX_CONF}" ]]; then
  if ! grep -q "listen 443" /etc/nginx/sites-available/api.kayroslab.com 2>/dev/null; then
    cp "${NGINX_CONF}" /etc/nginx/sites-available/api.kayroslab.com
    ln -sf /etc/nginx/sites-available/api.kayroslab.com /etc/nginx/sites-enabled/api.kayroslab.com
  fi
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    echo "nginx recharge."
  else
    echo "AVERTISSEMENT : nginx -t a echoue, config non appliquee." >&2
  fi
fi

sleep 2
curl -fsS "http://127.0.0.1:8787/health" && echo " -> health OK"

echo ""
echo "Deploiement termine. Backups : bash ${APP_DIR}/deploy/ovh-vps/install-cron-backup.sh"
