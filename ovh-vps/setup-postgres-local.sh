#!/usr/bin/env bash
# setup-postgres-local.sh — Provisionne un PostgreSQL local sur le VPS.
#
# Pourquoi local plutot qu'une base hebergee : le backend tourne sur une seule
# instance. Une base distante ajoute une latence reseau, un filtrage par IP a
# maintenir et un secret a faire circuler, sans rien apporter tant qu'il n'y a
# pas plusieurs instances derriere un load balancer.
#
# Le mot de passe est genere ICI et n'en sort jamais : ni secret GitHub, ni
# variable de workflow, ni sortie de log. Il vit dans le .env du backend, en
# mode 600, sur la meme machine que la base.
#
# Idempotent : rejouable a chaque deploiement sans effet de bord.
# Usage (en root) : APP_DIR=/opt/kayroslab bash deploy/ovh-vps/setup-postgres-local.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/kayroslab}"
BACKEND_DIR="${APP_DIR}/backend/fastify"
ENV_FILE="${BACKEND_DIR}/.env"
PG_DB="${KAYROS_PG_DB:-kayroslab}"
PG_USER="${KAYROS_PG_USER:-kayros}"
PG_HOST="127.0.0.1"
PG_PORT="${KAYROS_PG_PORT:-5432}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERREUR : ${ENV_FILE} introuvable." >&2
  exit 1
fi

# ── Deja configure ? ─────────────────────────────────────────────────────────
# Une DATABASE_URL existante n'est jamais ecrasee : elle peut pointer vers une
# base geree ailleurs, et la remplacer silencieusement ferait disparaitre les
# runs en attente de decision.
if grep -qE '^DATABASE_URL=.+' "${ENV_FILE}"; then
  existing=$(grep -E '^DATABASE_URL=' "${ENV_FILE}" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  if [[ "${existing}" == *"@${PG_HOST}:"* || "${existing}" == *"@localhost:"* ]]; then
    echo "Postgres local deja configure dans .env — rien a faire."
  else
    echo "DATABASE_URL pointe vers une base distante : provisionnement local ignore." >&2
    echo "  Vider la ligne DATABASE_URL du .env pour basculer en local." >&2
  fi
  exit 0
fi

# ── Installation ─────────────────────────────────────────────────────────────
if ! command -v psql >/dev/null 2>&1; then
  echo "Installation de PostgreSQL…"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y --no-install-recommends postgresql postgresql-client
fi

# Le paquet Debian demarre le cluster tout seul, mais un VPS reinstalle ou une
# image minimale peuvent laisser le service a l'arret.
systemctl enable --now postgresql >/dev/null 2>&1 || true
for _ in $(seq 1 20); do
  su - postgres -c "psql -tAc 'select 1'" >/dev/null 2>&1 && break
  sleep 1
done
if ! su - postgres -c "psql -tAc 'select 1'" >/dev/null 2>&1; then
  echo "ERREUR : PostgreSQL ne repond pas apres installation." >&2
  exit 1
fi

# ── Role et base ─────────────────────────────────────────────────────────────
# Le mot de passe n'est genere que si le role n'existe pas : rejouer le script
# ne doit pas invalider la DATABASE_URL d'un backend deja en service.
role_exists=$(su - postgres -c "psql -tAc \"select 1 from pg_roles where rolname='${PG_USER}'\"" || echo "")

if [[ "${role_exists}" != "1" ]]; then
  PG_PASS=$(openssl rand -base64 33 | tr -d '/+=\n' | cut -c1-32)
  # Passe par un fichier temporaire en mode 600 : un mot de passe en argument
  # de commande serait lisible dans /proc et dans l'historique du shell.
  tmp_sql=$(mktemp)
  chmod 600 "${tmp_sql}"
  printf "create role %s with login password '%s';\n" "${PG_USER}" "${PG_PASS}" > "${tmp_sql}"
  chown postgres "${tmp_sql}"
  su - postgres -c "psql -q -f '${tmp_sql}'"
  shred -u "${tmp_sql}" 2>/dev/null || rm -f "${tmp_sql}"
  echo "Role ${PG_USER} cree."
else
  echo "ERREUR : le role ${PG_USER} existe deja mais .env n'a pas de DATABASE_URL." >&2
  echo "  Le mot de passe existant est inconnu de ce script." >&2
  echo "  Le redefinir a la main, puis renseigner DATABASE_URL dans ${ENV_FILE} :" >&2
  echo "    sudo -u postgres psql -c \"alter role ${PG_USER} with password 'NOUVEAU';\"" >&2
  exit 1
fi

db_exists=$(su - postgres -c "psql -tAc \"select 1 from pg_database where datname='${PG_DB}'\"" || echo "")
if [[ "${db_exists}" != "1" ]]; then
  su - postgres -c "createdb -O '${PG_USER}' '${PG_DB}'"
  echo "Base ${PG_DB} creee."
fi

# ── Ecriture dans le .env ────────────────────────────────────────────────────
DB_URL="postgres://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${PG_DB}"
if grep -qE '^DATABASE_URL=' "${ENV_FILE}"; then
  # sed avec un separateur inhabituel : le mot de passe peut contenir des
  # caracteres speciaux pour sed, mais jamais un caractere de controle.
  python3 - "${ENV_FILE}" "${DB_URL}" <<'PY'
import sys, pathlib
env, url = pathlib.Path(sys.argv[1]), sys.argv[2]
lines = env.read_text(encoding='utf8').splitlines()
out = [f"DATABASE_URL={url}" if l.startswith('DATABASE_URL=') else l for l in lines]
env.write_text("\n".join(out) + "\n", encoding='utf8')
PY
else
  printf 'DATABASE_URL=%s\n' "${DB_URL}" >> "${ENV_FILE}"
fi
chmod 600 "${ENV_FILE}"

# Le mot de passe n'est jamais affiche : le log de deploiement est consultable
# par quiconque a acces aux Actions du depot.
echo "DATABASE_URL ecrit dans ${ENV_FILE} (postgres://${PG_USER}:***@${PG_HOST}:${PG_PORT}/${PG_DB})"

# ── Schema ───────────────────────────────────────────────────────────────────
if psql "${DB_URL}" -c 'select 1' >/dev/null 2>&1; then
  psql "${DB_URL}" -f "${APP_DIR}/core/sql/schema.sql" >/dev/null \
    && echo "Schema applique." \
    || echo "AVERTISSEMENT : schema.sql a echoue." >&2
else
  echo "ERREUR : connexion impossible avec la DATABASE_URL generee." >&2
  exit 1
fi
