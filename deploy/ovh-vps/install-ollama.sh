#!/usr/bin/env bash
set -euo pipefail

# Ollama est un service interne au VPS. Il ne doit jamais ecouter sur l'IP
# publique : l'API native n'a pas d'authentification.
OLLAMA_ENDPOINT="${OLLAMA_ENDPOINT:-http://127.0.0.1:11434}"
EMBED_MODEL="${EMBED_MODEL:-bge-m3}"

if [[ "${OLLAMA_ENDPOINT}" != "http://127.0.0.1:11434" && "${OLLAMA_ENDPOINT}" != "http://localhost:11434" ]]; then
  echo "ERREUR : OLLAMA_ENDPOINT doit rester sur la boucle locale (valeur: ${OLLAMA_ENDPOINT})." >&2
  exit 1
fi

if ! command -v ollama >/dev/null 2>&1; then
  echo "Installation d'Ollama…"
  curl -fsSL https://ollama.com/install.sh | sh
fi

install -d -m 0755 /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/10-loopback-only.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
EOF

systemctl daemon-reload
systemctl enable --now ollama
systemctl restart ollama

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:11434/api/tags >/dev/null; then
    break
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:11434/api/tags >/dev/null

listen_addrs=$(ss -ltnH | awk '$4 ~ /:11434$/ { print $4 }')
if [[ -z "${listen_addrs}" ]]; then
  echo "ERREUR : Ollama n'ecoute pas sur le port 11434." >&2
  exit 1
fi
if printf '%s\n' "${listen_addrs}" | grep -Ev '^(127\.0\.0\.1|\[::1\]):11434$' >/dev/null; then
  echo "ERREUR : Ollama est expose hors boucle locale :" >&2
  printf '%s\n' "${listen_addrs}" >&2
  exit 1
fi
echo "Ollama ecoute seulement sur ${listen_addrs}."

ollama pull "${EMBED_MODEL}"

response=$(curl -fsS http://127.0.0.1:11434/api/embed \
  -H 'content-type: application/json' \
  -d "{\"model\":\"${EMBED_MODEL}\",\"input\":\"bonheur\",\"keep_alive\":0}")
EMBED_RESPONSE="${response}" node <<'NODE'
const body = JSON.parse(process.env.EMBED_RESPONSE || '{}');
const vector = body.embeddings?.[0];
if (!Array.isArray(vector) || vector.length === 0) {
  console.error('ERREUR : Ollama n\'a renvoye aucun vecteur.');
  process.exit(1);
}
console.log(`Embedding ${body.model || 'bge-m3'} valide : ${vector.length} dimensions.`);
NODE
