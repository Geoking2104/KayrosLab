#!/usr/bin/env bash
# deploy-backend.sh — Installe et (re)lance le backend KayrosLab via PM2.
# Calque sur le pipeline openDPE, eprouve sur ce meme VPS.
# Usage (en root) :  APP_DIR=/opt/kayroslab bash deploy/ovh-vps/deploy-backend.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/kayroslab}"
BACKEND_DIR="${APP_DIR}/backend/fastify"
DATA_DIR="${DATA_DIR:-/opt/kayroslab/data}"

# ── Donnees persistantes (comptes, idees, gates) ─────────────────────────────
# 0700 : le fichier des comptes contient des empreintes de mots de passe.
mkdir -p "${DATA_DIR}"
chmod 700 "${DATA_DIR}"
mkdir -p /var/log/pm2

# ── Le .env doit exister : sans secret, les routes protegees repondent 503 ───
if [[ ! -f "${BACKEND_DIR}/.env" ]]; then
  echo "ERREUR : ${BACKEND_DIR}/.env introuvable." >&2
  echo "Copier .env.sample et renseigner KAYROS_AUTH_SECRET avant de continuer." >&2
  exit 1
fi

# ── Generer KAYROS_AUTH_SECRET s'il est vide ────────────────────────────────
if grep -qE '^KAYROS_AUTH_SECRET=\s*$' "${BACKEND_DIR}/.env"; then
  SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))")
  sed -i "s|^KAYROS_AUTH_SECRET=.*|KAYROS_AUTH_SECRET=${SECRET}|" "${BACKEND_DIR}/.env"
  echo "KAYROS_AUTH_SECRET genere automatiquement."
fi

# ── Dependances ──────────────────────────────────────────────────────────────
cd "${BACKEND_DIR}"
if [[ -f package-lock.json ]]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

# ── Tests du coeur : on ne deploie pas un backend dont le moteur est casse ───
if [[ -d "${APP_DIR}/core" ]]; then
  ( cd "${APP_DIR}/core" && node --test ) || { echo "ERREUR : tests du coeur en echec, deploiement interrompu." >&2; exit 1; }
fi

# ── PM2 ──────────────────────────────────────────────────────────────────────
pm2 startOrReload "${BACKEND_DIR}/ecosystem.config.cjs" --env production
pm2 save

# ── nginx : config versionnee dans le depot ─────────────────────────────────
NGINX_CONF="${APP_DIR}/deploy/ovh-vps/nginx-kayroslab-api.conf"
if [[ -f "${NGINX_CONF}" ]]; then
  # Ne pas ecraser une config deja passee en HTTPS par certbot.
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

# ── Verification ─────────────────────────────────────────────────────────────
sleep 2
curl -fsS "http://127.0.0.1:8787/health" && echo " -> health OK"

echo ""
echo "Deploiement termine. Verifications :"
echo "  pm2 status"
echo "  pm2 logs kayros-api --lines 30"
echo "  curl -I https://api.kayroslab.com/health"
