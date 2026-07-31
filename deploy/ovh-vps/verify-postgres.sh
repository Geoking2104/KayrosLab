#!/usr/bin/env bash
# KayrosLab — Verification post-provisionnement, a lancer sur le VPS.
set -euo pipefail
cd "$(dirname "$0")/../../backend/fastify"
[ -f .env ] || { echo "✗ .env absent — lancer provision-postgres.sh"; exit 2; }
set -a; . ./.env; set +a
[ -n "${DATABASE_URL:-}" ] || { echo "✗ DATABASE_URL absent"; exit 2; }
command -v node >/dev/null || { echo "✗ node absent"; exit 2; }
[ -d node_modules/pg ] || npm install --omit=dev --no-audit --no-fund
exec node tests/recette-vps.mjs
