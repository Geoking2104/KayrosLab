#!/usr/bin/env bash
# deploy-sso.sh — IdP Authelia (OpenID Connect, Apache-2.0) + vhost sso.kayroslab.com.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/kayroslab}"
DATA_DIR="${DATA_DIR:-/opt/kayroslab/data}"
CONF_DIR="${DATA_DIR}/authelia"
BACKEND_ENV="${APP_DIR}/backend/fastify/.env"
COMPOSE="${APP_DIR}/deploy/ovh-vps/authelia.compose.yaml"
SITE_AVAILABLE="/etc/nginx/sites-available/sso.kayroslab.com"
IMAGE="authelia/authelia:4.39.20"

if [[ ! -f "${COMPOSE}" ]]; then
  echo "ERREUR : ${COMPOSE} introuvable." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "AVERTISSEMENT : Docker Compose absent — SSO Authelia non demarre." >&2
  exit 0
fi

mkdir -p "${CONF_DIR}"
chmod 700 "${CONF_DIR}"

secret_file() {
  local path="$1" bytes="${2:-48}"
  if [[ ! -s "${path}" ]]; then
    openssl rand -hex "${bytes}" > "${path}"
    chmod 600 "${path}"
  fi
  tr -d '\n' < "${path}"
}

JWT_SECRET=$(secret_file "${CONF_DIR}/jwt.secret" 32)
SESSION_SECRET=$(secret_file "${CONF_DIR}/session.secret" 32)
STORAGE_KEY=$(secret_file "${CONF_DIR}/storage.secret" 32)
HMAC_SECRET=$(secret_file "${CONF_DIR}/hmac.secret" 32)

if [[ ! -s "${CONF_DIR}/oidc.pem" ]]; then
  openssl genrsa -out "${CONF_DIR}/oidc.pem" 2048
  chmod 600 "${CONF_DIR}/oidc.pem"
fi
OIDC_PEM=$(cat "${CONF_DIR}/oidc.pem")

if [[ ! -s "${CONF_DIR}/users.yml" ]]; then
  INITIAL=$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)
  HASH_OUT=$(docker run --rm "${IMAGE}" authelia crypto hash generate argon2 --password "${INITIAL}" 2>&1 || true)
  HASH=$(printf '%s\n' "${HASH_OUT}" | grep -Eo '\$argon2[id]+\$[^[:space:]]+' | tail -1)
  if [[ -z "${HASH}" ]]; then
    echo "ERREUR : hash Authelia impossible." >&2
    printf '%s\n' "${HASH_OUT}" >&2
    exit 1
  fi
  cat > "${CONF_DIR}/users.yml" <<YAML
users:
  kayros:
    disabled: false
    displayname: "KayrosLab"
    password: "${HASH}"
    email: contact@kayroslab.com
    groups:
      - admins
YAML
  chmod 600 "${CONF_DIR}/users.yml"
  printf '%s\n' "${INITIAL}" > "${CONF_DIR}/INITIAL_PASSWORD.txt"
  chmod 600 "${CONF_DIR}/INITIAL_PASSWORD.txt"
  echo "SSO Authelia : mot de passe initial dans ${CONF_DIR}/INITIAL_PASSWORD.txt (contact@kayroslab.com)."
fi

OIDC_PEM_INDENTED=$(sed 's/^/          /' "${CONF_DIR}/oidc.pem")

cat > "${CONF_DIR}/configuration.yml" <<YAML
theme: auto
server:
  address: 'tcp://0.0.0.0:9091/'
log:
  level: info
identity_validation:
  reset_password:
    jwt_secret: '${JWT_SECRET}'
authentication_backend:
  file:
    path: /config/users.yml
session:
  secret: '${SESSION_SECRET}'
  cookies:
    - name: authelia_session
      domain: sso.kayroslab.com
      authelia_url: https://sso.kayroslab.com
      expiration: 1h
      inactivity: 15m
storage:
  encryption_key: '${STORAGE_KEY}'
  local:
    path: /config/db.sqlite3
notifier:
  filesystem:
    filename: /config/notification.txt
access_control:
  default_policy: deny
  rules:
    - domain: 'sso.kayroslab.com'
      policy: bypass
identity_providers:
  oidc:
    hmac_secret: '${HMAC_SECRET}'
    jwks:
      - key: |
${OIDC_PEM_INDENTED}
    cors:
      endpoints:
        - authorization
        - token
        - revocation
        - introspection
        - userinfo
      allowed_origins_from_client_redirect_uris: true
    clients:
      - client_id: 'kayroslab-console'
        client_name: 'KayrosLab'
        public: true
        authorization_policy: 'one_factor'
        consent_mode: implicit
        redirect_uris:
          - 'https://www.kayroslab.com/console/'
          - 'https://www.kayroslab.com/salon/'
          - 'http://localhost:4174/console/'
          - 'http://localhost:4174/salon/'
        scopes:
          - openid
          - profile
          - email
        grant_types:
          - authorization_code
        response_types:
          - code
        token_endpoint_auth_method: 'none'
        pkce_challenge_method: 'S256'
YAML
chmod 600 "${CONF_DIR}/configuration.yml"

export KAYROS_AUTHELIA_DIR="${CONF_DIR}"
docker compose -f "${COMPOSE}" pull
docker compose -f "${COMPOSE}" up -d

if [[ -f "${APP_DIR}/deploy/ovh-vps/nginx-kayroslab-sso.conf" ]]; then
  CERT_DIR=""
  for d in /etc/letsencrypt/live/sso.kayroslab.com; do
    if [[ -f "${d}/fullchain.pem" ]]; then CERT_DIR="${d}"; break; fi
  done
  if [[ -n "${CERT_DIR}" ]]; then
    SSL_OPTIONS=""
    SSL_DH=""
    [[ -f /etc/letsencrypt/options-ssl-nginx.conf ]] && SSL_OPTIONS="  include /etc/letsencrypt/options-ssl-nginx.conf;"
    [[ -f /etc/letsencrypt/ssl-dhparams.pem ]] && SSL_DH="  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
    cat > "${SITE_AVAILABLE}" <<NGINX
server {
  listen 80;
  server_name sso.kayroslab.com;
  location /.well-known/acme-challenge/ { root /var/www/html; }
  location / { return 301 https://sso.kayroslab.com\$request_uri; }
}
server {
  listen 443 ssl http2;
  server_name sso.kayroslab.com;
  ssl_certificate ${CERT_DIR}/fullchain.pem;
  ssl_certificate_key ${CERT_DIR}/privkey.pem;
${SSL_OPTIONS}
${SSL_DH}
  location / {
    proxy_pass http://127.0.0.1:9091;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Host \$http_host;
  }
}
NGINX
  else
    cp "${APP_DIR}/deploy/ovh-vps/nginx-kayroslab-sso.conf" "${SITE_AVAILABLE}"
  fi
  ln -sf "${SITE_AVAILABLE}" /etc/nginx/sites-enabled/sso.kayroslab.com
  if nginx -t; then
    systemctl reload nginx
    echo "nginx recharge — sso.kayroslab.com -> Authelia"
  else
    echo "AVERTISSEMENT : nginx -t a echoue pour le vhost SSO." >&2
  fi
fi

if [[ -f "${BACKEND_ENV}" ]]; then
  python3 - <<'PY'
from pathlib import Path
path = Path("/opt/kayroslab/backend/fastify/.env")
text = path.read_text() if path.exists() else ""
replacements = {
    "OIDC_ISSUER": "https://sso.kayroslab.com",
    "OIDC_CLIENT_ID": "kayroslab-console",
}
for name, value in replacements.items():
    line = f"{name}={value}"
    import re
    if re.search(rf"^{name}=.*$", text, re.M):
        text = re.sub(rf"^{name}=.*$", line, text, flags=re.M)
    else:
        text = text.rstrip() + "\n" + line + "\n"
path.write_text(text)
path.chmod(0o600)
PY
fi

echo "SSO OpenID pret (Authelia Apache-2.0). DNS A sso.kayroslab.com -> 51.210.9.71 puis certbot."

if command -v pm2 >/dev/null 2>&1; then
  pm2 restart kayros-api --update-env >/dev/null || true
fi
