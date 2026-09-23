#!/usr/bin/env bash
# deploy-sso.sh — IdP Authelia + vhost sso.kayroslab.com.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/kayroslab}"
DATA_DIR="${DATA_DIR:-/opt/kayroslab/data}"
CONF_DIR="${DATA_DIR}/authelia"
BACKEND_ENV="${APP_DIR}/backend/fastify/.env"
COMPOSE="${APP_DIR}/deploy/ovh-vps/authelia.compose.yaml"
SITE_AVAILABLE="/etc/nginx/sites-available/sso.kayroslab.com"
IMAGE="authelia/authelia:4.39.20"
PEAU_DIR="${APP_DIR}/backend/web/public/salon"

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
fi

# Ne réécrit la conf que si elle n'existe pas — évite de tuer un Authelia sain.
if [[ ! -s "${CONF_DIR}/configuration.yml" ]]; then
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
          - 'https://www.kayroslab.com/salon/flux/'
          - 'https://www.kayroslab.com/salon/entrer/'
          - 'http://localhost:4174/console/'
          - 'http://localhost:4174/salon/'
          - 'http://localhost:4174/salon/flux/'
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
fi

if [[ -f "${BACKEND_ENV}" ]]; then
  node "${APP_DIR}/deploy/ovh-vps/patch-authelia-smtp.mjs" \
    "${BACKEND_ENV}" "${CONF_DIR}/configuration.yml" \
    || true
fi

export KAYROS_AUTHELIA_DIR="${CONF_DIR}"
docker compose -f "${COMPOSE}" up -d

PEAU_CSS="${PEAU_DIR}/sso-peau.css"
PEAU_JS="${PEAU_DIR}/sso-peau.js"

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
  location = /sso-peau.css {
    alias ${PEAU_CSS};
    default_type text/css;
    add_header Cache-Control "no-cache";
  }
  location = /sso-peau.js {
    alias ${PEAU_JS};
    default_type application/javascript;
    add_header Cache-Control "no-cache";
  }
  location / {
    proxy_pass http://127.0.0.1:9091;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Host \$http_host;
    proxy_set_header Accept-Encoding "";
    sub_filter '</head>' '<link rel="stylesheet" href="/sso-peau.css"></head>';
    sub_filter '</body>' '<script src="/sso-peau.js" defer></script></body>';
    sub_filter_once off;
    sub_filter_types text/html;
  }
}
NGINX
  else
    cp "${APP_DIR}/deploy/ovh-vps/nginx-kayroslab-sso.conf" "${SITE_AVAILABLE}"
  fi
  ln -sf "${SITE_AVAILABLE}" /etc/nginx/sites-enabled/sso.kayroslab.com
  if nginx -t; then
    systemctl reload nginx
    echo "nginx recharge — sso.kayroslab.com peau Salon"
  else
    echo "AVERTISSEMENT : nginx -t a echoue pour le vhost SSO." >&2
  fi
fi

echo "SSO pret."
