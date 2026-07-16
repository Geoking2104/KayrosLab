# Backend Fastify — déploiement sur hôte Node (VPS / Public Cloud / PaaS)

⚠️ Ne fonctionne **pas** sur l'hébergement mutualisé OVH (PHP only). Cible : VPS OVH, Public Cloud, ou PaaS Node.

## Lancer en local / sur le serveur

```bash
cd backend/fastify
cp .env.sample .env      # renseigner ANTHROPIC_API_KEY, ALLOWED_ORIGIN, etc.
npm install
node --env-file=.env index.mjs    # Node 20+ ; ou exporter les variables puis: npm start
```

Le serveur écoute sur `PORT` (défaut 8787).

## Endpoints

- `GET  /health` → état + providers + modèle.
- `POST /v1/llm` → complétion brute `{ messages, provider, model, role, temperature }` (utilisé par l'app navigateur).
- `POST /v1/govern/query` → orchestrateur complet `{ query, governance, sovereignty, provider }`.
  - Réponse `200 { status, answer, trace }` en mode `auto` / non sensible.
  - Réponse `202 { status:'pending_review', gateId, gateType }` si un gate humain est requis.

## Tester

```bash
curl -s localhost:8787/health
curl -s -X POST localhost:8787/v1/llm -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"bonjour"}],"provider":"mock"}'
```

## Production

- Servir derrière un reverse proxy HTTPS (nginx/caddy), restreindre `ALLOWED_ORIGIN`.
- Gérer le process avec pm2/systemd. Clés via variables d'environnement (jamais dans le dépôt).
- Résolution des gates entre requêtes (HITL asynchrone) = lot ultérieur (store partagé).
