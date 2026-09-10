#!/usr/bin/env bash
# assemble-www.sh — Copie le site statique KayrosLab dans WWW_ROOT.
# Usage : APP_DIR=/opt/kayroslab WWW_ROOT=/var/www/kayroslab bash deploy/ovh-vps/assemble-www.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/kayroslab}"
WWW_ROOT="${WWW_ROOT:-/var/www/kayroslab}"

if [[ ! -f "${APP_DIR}/index.html" ]]; then
  echo "ERREUR : ${APP_DIR}/index.html introuvable." >&2
  exit 1
fi
if [[ ! -f "${APP_DIR}/backend/web/public/salon/index.html" ]]; then
  echo "ERREUR : salon statique manquant (pied de page /salon/ 404)." >&2
  exit 1
fi

stage=$(mktemp -d)
trap 'rm -rf "${stage}"' EXIT

copy_if() {
  local src="$1"
  local dest="$2"
  if [[ -e "${src}" ]]; then
    mkdir -p "$(dirname "${dest}")"
    cp -a "${src}" "${dest}"
  fi
}

for f in index.html index.fr.html tokens.css studio.css; do
  copy_if "${APP_DIR}/${f}" "${stage}/${f}"
done

DEMO="kayroslab-complete-with-ai-agents.html"
if [[ -f "${APP_DIR}/${DEMO}" ]]; then
  size=$(wc -c < "${APP_DIR}/${DEMO}")
  if [[ "${size}" -lt 50000 ]]; then
    echo "ERREUR : ${DEMO} n'a que ${size} octets." >&2
    exit 1
  fi
  cp -a "${APP_DIR}/${DEMO}" "${stage}/${DEMO}"
fi

for f in \
  arbitrage.html \
  cycle-timeline.html \
  validation-proposition.html \
  portfolio-dormant.html \
  portfolio-board.html \
  ontology-explorer.html \
  ontology-panel.html \
  livret-blanc-kayroslab.html \
  livret-blanc-positionner.html \
  livret-blanc-ecouter.html \
  livret-blanc-hackathon.html \
  whitepaper-kayroslab.html \
  whitepaper-position.html \
  whitepaper-listen.html \
  whitepaper-hackathon.html
do
  copy_if "${APP_DIR}/${f}" "${stage}/${f}"
done

if [[ -d "${APP_DIR}/backend/web/public/assets" ]]; then
  mkdir -p "${stage}/assets"
  cp -a "${APP_DIR}/backend/web/public/assets/." "${stage}/assets/"
else
  echo "ERREUR : backend/web/public/assets manquant." >&2
  exit 1
fi

if [[ -f "${APP_DIR}/backend/web/public/console/index.html" ]]; then
  mkdir -p "${stage}/console"
  cp -a "${APP_DIR}/backend/web/public/console/." "${stage}/console/"
else
  echo "AVERTISSEMENT : console statique absente — /console/ 404." >&2
fi

mkdir -p "${stage}/salon"
cp -a "${APP_DIR}/backend/web/public/salon/." "${stage}/salon/"

if [[ -f "${APP_DIR}/frontend/positionning-app/dist/index.html" ]]; then
  mkdir -p "${stage}/positionner-app"
  cp -a "${APP_DIR}/frontend/positionning-app/dist/." "${stage}/positionner-app/"
fi

mkdir -p "${WWW_ROOT}"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "${stage}/" "${WWW_ROOT}/"
else
  find "${WWW_ROOT}" -mindepth 1 -delete
  cp -a "${stage}/." "${WWW_ROOT}/"
fi

echo "Site statique assemble dans ${WWW_ROOT} ($(find "${WWW_ROOT}" -type f | wc -l) fichiers)."
