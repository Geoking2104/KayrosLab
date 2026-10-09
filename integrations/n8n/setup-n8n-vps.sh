#!/usr/bin/env bash
# setup-n8n-vps.sh — installation idempotente de n8n sur le VPS OVH (README.md, partie A).
# Lancé par .github/workflows/setup-n8n-vps.yml (ou à la main, en root) :
#
#   bash integrations/n8n/setup-n8n-vps.sh install|status|certbot [domaine]
#
# Règles :
#   - aucun secret n'est affiché : mots de passe et clé générés ICI, écrits dans
#     des fichiers 600, jamais en argument de commande ni dans les logs ;
#   - rejouable : une clé, un mot de passe ou un htpasswd existants sont conservés ;
#   - nginx n'est rechargé qu'après `nginx -t` ; en cas d'échec, le vhost n8n est
#     retiré et la configuration précédente reste en service (API intacte) ;
#   - certbot ne tourne que si le domaine résout vers l'IP du VPS.
set -euo pipefail

STEP="${1:-status}"
DOMAIN="${2:-n8n.kayroslab.com}"
VPS_IP="${VPS_IP:-51.210.9.71}"
APP_DIR="${APP_DIR:-/opt/kayroslab}"
N8N_DIR="${APP_DIR}/integrations/n8n"
ENV_FILE="${N8N_DIR}/.env"
CRED_DIR="/root/kayros-n8n"
BASIC_AUTH_FILE="${CRED_DIR}/basic-auth.txt"
BASIC_AUTH_USER="${N8N_BASIC_AUTH_USER:-geoffroy}"
HTPASSWD="/etc/nginx/.htpasswd-n8n"
VHOST_AVAIL="/etc/nginx/sites-available/${DOMAIN}"
VHOST_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
CERT_EMAIL="${CERT_EMAIL:-contact@kayroslab.com}"

log() { printf '[n8n-setup] %s\n' "$*"; }
die() { printf '[n8n-setup] ERREUR : %s\n' "$*" >&2; exit 1; }

[[ "${DOMAIN}" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || die "domaine invalide : ${DOMAIN}"
case "${STEP}" in install|status|certbot) ;; *) die "étape inconnue : ${STEP} (install|status|certbot)";; esac
[[ "$(id -u)" -eq 0 ]] || die "à lancer en root (ou via sudo)"
[[ -f "${N8N_DIR}/docker-compose.yml" ]] || die "${N8N_DIR}/docker-compose.yml introuvable (dépôt à jour ?)"
umask 077

random_secret() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-"${1:-32}"; }

# Remplace (ou ajoute) KEY=valeur dans .env ; la valeur passe par l'environnement,
# jamais par la ligne de commande.
set_env() {
  local key="$1" tmp
  tmp=$(mktemp "${ENV_FILE}.XXXX")
  KEY="${key}" awk 'BEGIN { k = ENVIRON["KEY"]; v = ENVIRON["VALUE"]; done = 0 }
    index($0, k "=") == 1 { print k "=" v; done = 1; next } { print }
    END { if (!done) print k "=" v }' "${ENV_FILE}" > "${tmp}"
  chmod 600 "${tmp}"
  mv "${tmp}" "${ENV_FILE}"
}
env_value() { [[ -f "${ENV_FILE}" ]] && grep -E "^$1=" "${ENV_FILE}" | head -1 | cut -d= -f2- || true; }

resolved_ips() {
  local ips=""
  if command -v dig >/dev/null 2>&1; then
    ips=$(dig +short +time=3 +tries=2 A "${DOMAIN}" @1.1.1.1 2>/dev/null | grep -E '^[0-9.]+$' || true)
  fi
  [[ -n "${ips}" ]] || ips=$(getent ahostsv4 "${DOMAIN}" 2>/dev/null | awk '{print $1}' | sort -u || true)
  echo "${ips}" | tr '\n' ' ' | sed 's/ *$//'
}
dns_ok() { [[ " $(resolved_ips) " == *" ${VPS_IP} "* ]]; }

healthz() { curl -fsS --max-time 5 http://127.0.0.1:5678/healthz 2>/dev/null; }

# ── Base de données ──────────────────────────────────────────────────────────
setup_database() {
  local current_type current_pass
  current_type=$(env_value DB_TYPE)
  current_pass=$(env_value N8N_DB_PASSWORD)
  if [[ "${current_type}" == "sqlite" ]]; then log "Base : SQLite (déjà choisi dans .env)"; return; fi
  if [[ "${current_type}" == "postgresdb" && -n "${current_pass}" ]] \
     && su - postgres -c "psql -tAc \"select 1 from pg_database where datname='n8n'\"" 2>/dev/null | grep -q 1; then
    log "Base : Postgres local, base n8n déjà provisionnée (mot de passe conservé)"; return
  fi
  if ! command -v psql >/dev/null 2>&1 || ! su - postgres -c "psql -tAc 'select 1'" >/dev/null 2>&1; then
    log "Postgres local indisponible : repli DB_TYPE=sqlite"
    VALUE=sqlite set_env DB_TYPE; return
  fi
  local pass tmp_sql
  pass=$(random_secret 32)
  tmp_sql=$(mktemp)
  chmod 600 "${tmp_sql}"
  { printf '%s\n' "\\set n8n_password '${pass}'"; cat "${N8N_DIR}/init-n8n-db.sql"; } > "${tmp_sql}"
  chown postgres "${tmp_sql}"
  if su - postgres -c "psql -q -v ON_ERROR_STOP=1 -f '${tmp_sql}'" >/dev/null; then
    VALUE=postgresdb set_env DB_TYPE
    VALUE="${pass}" set_env N8N_DB_PASSWORD
    log "Base : Postgres local, base et rôle n8n créés (mot de passe dans .env)"
  else
    log "Provisionnement Postgres en échec : repli DB_TYPE=sqlite"
    VALUE=sqlite set_env DB_TYPE
  fi
  shred -u "${tmp_sql}" 2>/dev/null || rm -f "${tmp_sql}"
}

# ── .env et conteneur ────────────────────────────────────────────────────────
setup_env() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    install -m 600 "${N8N_DIR}/.env.example" "${ENV_FILE}"
    log ".env créé depuis .env.example"
  fi
  chmod 600 "${ENV_FILE}"
  VALUE="${DOMAIN}" set_env N8N_DOMAIN
  if [[ -z "$(env_value N8N_ENCRYPTION_KEY)" ]]; then
    VALUE="$(openssl rand -hex 32)" set_env N8N_ENCRYPTION_KEY
    log "N8N_ENCRYPTION_KEY générée (dans ${ENV_FILE}, à sauvegarder)"
  else
    log "N8N_ENCRYPTION_KEY existante conservée"
  fi
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then return; fi
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  if ! command -v docker >/dev/null 2>&1; then
    log "Installation de Docker (paquet de la distribution)"
    apt-get install -y -qq docker.io
    systemctl enable --now docker
  fi
  if ! docker compose version >/dev/null 2>&1; then
    log "Installation du plugin docker compose"
    apt-get install -y -qq docker-compose-v2 2>/dev/null || apt-get install -y -qq docker-compose-plugin 2>/dev/null \
      || die "plugin docker compose introuvable dans les dépôts : l'installer à la main"
  fi
}

start_n8n() {
  ensure_docker
  cd "${N8N_DIR}"
  docker compose pull -q n8n
  docker compose up -d
  log "Attente de n8n (healthz)…"
  for _ in $(seq 1 60); do
    if healthz >/dev/null; then log "n8n répond sur 127.0.0.1:5678 : $(healthz)"; return; fi
    sleep 3
  done
  docker compose logs --tail 60 n8n | grep -viE 'key|password|secret|token' || true
  die "n8n ne répond pas sur 127.0.0.1:5678/healthz après 3 min"
}

# ── nginx, htpasswd, certificat ──────────────────────────────────────────────
setup_htpasswd() {
  mkdir -p "${CRED_DIR}"; chmod 700 "${CRED_DIR}"
  if [[ -s "${HTPASSWD}" ]]; then
    log "htpasswd existant conservé ($([[ -s "${BASIC_AUTH_FILE}" ]] && echo "identifiants dans ${BASIC_AUTH_FILE}" || echo "créé hors de ce script"))"; return
  fi
  local pass hash
  pass=$(random_secret 24)
  hash=$(printf '%s' "${pass}" | openssl passwd -apr1 -stdin)
  printf '%s:%s\n' "${BASIC_AUTH_USER}" "${hash}" > "${HTPASSWD}.tmp"
  chown root:www-data "${HTPASSWD}.tmp" 2>/dev/null || true
  chmod 640 "${HTPASSWD}.tmp"
  mv "${HTPASSWD}.tmp" "${HTPASSWD}"
  printf 'url=https://%s\nuser=%s\npassword=%s\n' "${DOMAIN}" "${BASIC_AUTH_USER}" "${pass}" > "${BASIC_AUTH_FILE}"
  chmod 600 "${BASIC_AUTH_FILE}"
  log "htpasswd créé (utilisateur ${BASIC_AUTH_USER}, mot de passe dans ${BASIC_AUTH_FILE})"
}

reload_nginx_or_rollback() {
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx; log "nginx -t OK, nginx rechargé"
  else
    nginx -t 2>&1 | tail -5 || true
    rm -f "${VHOST_ENABLED}"
    nginx -t >/dev/null 2>&1 && systemctl reload nginx || true
    die "configuration nginx invalide : vhost ${DOMAIN} désactivé, configuration précédente conservée"
  fi
}

setup_nginx() {
  command -v nginx >/dev/null 2>&1 || die "nginx absent du VPS"
  setup_htpasswd
  mkdir -p /var/www/html
  if [[ -f "${VHOST_AVAIL}" ]] && grep -q 'managed by Certbot' "${VHOST_AVAIL}"; then
    log "vhost ${DOMAIN} déjà passé en HTTPS par certbot : conservé"
  else
    sed "s/n8n\.kayroslab\.com/${DOMAIN}/g" "${N8N_DIR}/nginx-n8n.kayroslab.com.conf" > "${VHOST_AVAIL}"
    chmod 644 "${VHOST_AVAIL}"
    log "vhost installé : ${VHOST_AVAIL}"
  fi
  if ! dns_ok; then
    log "DNS : ${DOMAIN} -> '$(resolved_ips)' (attendu ${VPS_IP}). vhost NON activé, certbot ignoré."
    log "=> Ajouter chez IONOS un enregistrement A '${DOMAIN%%.*}' -> ${VPS_IP}, puis relancer l'étape certbot."
    if [[ -L "${VHOST_ENABLED}" ]] && ! grep -q 'managed by Certbot' "${VHOST_AVAIL}"; then
      rm -f "${VHOST_ENABLED}"; reload_nginx_or_rollback
    fi
    return 0
  fi
  log "DNS : ${DOMAIN} -> ${VPS_IP} OK"
  ln -sf "${VHOST_AVAIL}" "${VHOST_ENABLED}"
  reload_nginx_or_rollback
  if ! command -v certbot >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot python3-certbot-nginx
  fi
  if certbot --nginx -d "${DOMAIN}" --redirect --agree-tos -m "${CERT_EMAIL}" -n --keep-until-expiring; then
    reload_nginx_or_rollback
    systemctl enable --now certbot.timer >/dev/null 2>&1 || true
    log "Certificat Let's Encrypt en place pour ${DOMAIN}"
  else
    reload_nginx_or_rollback
    die "certbot a échoué (vhost HTTP actif, nginx valide) : voir le message ci-dessus"
  fi
}

# ── Statut (aucun secret) ────────────────────────────────────────────────────
status() {
  echo "── n8n : statut ──────────────────────────────"
  if command -v docker >/dev/null 2>&1; then
    docker ps -a --filter name=^kayros-n8n$ --format 'conteneur : {{.Names}} | {{.Image}} | {{.Status}}' | grep . || echo "conteneur : absent"
    docker stats --no-stream --format 'mémoire : {{.MemUsage}}' kayros-n8n 2>/dev/null || true
  else
    echo "docker : absent"
  fi
  if h=$(healthz); then echo "healthz : OK ${h}"; else echo "healthz : KO (127.0.0.1:5678 ne répond pas)"; fi
  echo "base : $(env_value DB_TYPE || true)"
  [[ -f "${ENV_FILE}" ]] && echo ".env : présent ($(stat -c '%a' "${ENV_FILE}")), clé de chiffrement : $([[ -n "$(env_value N8N_ENCRYPTION_KEY)" ]] && echo définie || echo MANQUANTE)" || echo ".env : absent"
  local ips; ips=$(resolved_ips)
  if dns_ok; then echo "DNS : ${DOMAIN} -> ${ips} (OK)"; else echo "DNS : ${DOMAIN} -> '${ips:-aucune réponse}' (attendu ${VPS_IP})"; fi
  echo "vhost : $([[ -f "${VHOST_AVAIL}" ]] && echo installé || echo absent), $([[ -L "${VHOST_ENABLED}" ]] && echo activé || echo 'non activé')"
  echo "htpasswd : $([[ -s "${HTPASSWD}" ]] && echo présent || echo absent) ; identifiants : $([[ -s "${BASIC_AUTH_FILE}" ]] && echo "${BASIC_AUTH_FILE}" || echo absents)"
  if [[ -f "${CERT_DIR}/fullchain.pem" ]]; then
    echo "certificat : présent, $(openssl x509 -enddate -noout -in "${CERT_DIR}/fullchain.pem")"
  else
    echo "certificat : absent"
  fi
  if nginx -t >/dev/null 2>&1; then echo "nginx -t : OK"; else echo "nginx -t : ERREUR"; fi
  echo "API KayrosLab (127.0.0.1:8787/health) : HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8787/health || echo '000')"
}

case "${STEP}" in
  install)
    setup_env
    setup_database
    start_n8n
    setup_nginx
    status
    ;;
  certbot)
    setup_nginx
    status
    ;;
  status)
    status
    ;;
esac
