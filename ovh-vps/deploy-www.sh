#!/usr/bin/env bash
# deploy-www.sh — Assemble le site et pose le vhost nginx www.kayroslab.com.
# Usage (root) : APP_DIR=/opt/kayroslab bash deploy/ovh-vps/deploy-www.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/kayroslab}"
WWW_ROOT="${WWW_ROOT:-/var/www/kayroslab}"
SNIPPET_SRC="${APP_DIR}/deploy/ovh-vps/nginx-kayroslab-www-locations.conf"
SITE_AVAILABLE="/etc/nginx/sites-available/www.kayroslab.com"
SITE_ENABLED="/etc/nginx/sites-enabled/www.kayroslab.com"

if [[ ! -f "${SNIPPET_SRC}" ]]; then
  echo "ERREUR : ${SNIPPET_SRC} introuvable." >&2
  exit 1
fi

APP_DIR="${APP_DIR}" WWW_ROOT="${WWW_ROOT}" bash "${APP_DIR}/deploy/ovh-vps/assemble-www.sh"

install -d -m 0755 /etc/nginx/snippets /var/www/html
install -m 0644 "${SNIPPET_SRC}" /etc/nginx/snippets/kayroslab-www-locations.conf

CERT_DIR=""
for d in /etc/letsencrypt/live/www.kayroslab.com /etc/letsencrypt/live/kayroslab.com; do
  if [[ -f "${d}/fullchain.pem" && -f "${d}/privkey.pem" ]]; then
    CERT_DIR="${d}"
    break
  fi
done

SSL_OPTIONS=""
if [[ -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
  SSL_OPTIONS="  include /etc/letsencrypt/options-ssl-nginx.conf;"
fi
SSL_DH=""
if [[ -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
  SSL_DH="  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
fi

if [[ -n "${CERT_DIR}" ]]; then
  cat > "${SITE_AVAILABLE}" <<NGINX
server {
  listen 80;
  server_name www.kayroslab.com kayroslab.com;

  location /.well-known/acme-challenge/ {
    root /var/www/html;
  }

  location / {
    return 301 https://www.kayroslab.com\$request_uri;
  }
}

server {
  listen 443 ssl http2;
  server_name kayroslab.com;
  ssl_certificate ${CERT_DIR}/fullchain.pem;
  ssl_certificate_key ${CERT_DIR}/privkey.pem;
${SSL_OPTIONS}
${SSL_DH}
  return 301 https://www.kayroslab.com\$request_uri;
}

server {
  listen 443 ssl http2;
  server_name www.kayroslab.com;
  ssl_certificate ${CERT_DIR}/fullchain.pem;
  ssl_certificate_key ${CERT_DIR}/privkey.pem;
${SSL_OPTIONS}
${SSL_DH}

  include snippets/kayroslab-www-locations.conf;
}
NGINX
  echo "vhost HTTPS (cert ${CERT_DIR})."
else
  install -m 0644 "${APP_DIR}/deploy/ovh-vps/nginx-kayroslab-www.conf" "${SITE_AVAILABLE}"
  echo "vhost HTTP (pas encore de certificat www) — ACME pret."
fi

ln -sf "${SITE_AVAILABLE}" "${SITE_ENABLED}"

if nginx -t; then
  systemctl reload nginx
  echo "nginx recharge — www.kayroslab.com -> ${WWW_ROOT}"
else
  echo "ERREUR : nginx -t a echoue, vhost www non applique." >&2
  exit 1
fi
