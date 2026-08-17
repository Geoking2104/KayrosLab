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

## Developer Portal MCP

Le endpoint `POST /mcp` expose le catalogue et les workflows swarm aux outils de développement IA via MCP Streamable HTTP. L'accès utilise des jetons Bearer hachés, limités à un tenant, des scopes et une date d'expiration optionnelle.

Voir [`../../docs/developer-portal-mcp.md`](../../docs/developer-portal-mcp.md) pour générer un jeton, configurer Codex / Claude Code / Cursor / VS Code et exploiter les outils disponibles.

## Endpoints

- `GET  /health` → état + providers + modèle.
- `POST /v1/demo/chat` → proxy LLM public de la démo HTML, sans clé côté navigateur.
- `POST /v1/demo/report-leads` → capture lead RGPD et envoi SMTP du PDF/Markdown généré par la démo.
- `POST /v1/demo/positionning/analyze` → analyse Positionner publique via Mistral serveur, sans fallback local ni exemples codés en dur.
- `POST /v1/llm` → complétion brute `{ messages, provider, model, role, temperature }` (utilisé par l'app navigateur).
- `POST /v1/govern/query` → orchestrateur complet `{ query, governance, sovereignty, provider }`.
  - Réponse `200 { status, answer, trace }` en mode `auto` / non sensible.
  - Réponse `202 { status:'pending_review', gateId, gateType }` si un gate humain est requis.
- `POST /mcp` → Developer Portal MCP stateless (Bearer tenant-scoped, catalogue + swarms + dossiers).

## Tester

```bash
curl -s localhost:8787/health
curl -s -X POST localhost:8787/v1/llm -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"bonjour"}],"provider":"mock"}'
```

## Production

- Servir derrière un reverse proxy HTTPS (nginx/caddy), restreindre `ALLOWED_ORIGIN`.
- Gérer le process avec pm2/systemd. Clés via variables d'environnement (jamais dans le dépôt).
- Pour l'envoi des rapports de la démo, renseigner `KAYROS_SMTP_URL`, `KAYROS_MAIL_FROM` et `KAYROS_REPORT_LEAD_BCC` (par défaut : `geoffroydelatournelle@gmail.com`).
- Pour Positionner, renseigner `MISTRAL_API_KEY`; `GITHUB_TOKEN`, `GITLAB_TOKEN`, `GOOGLE_API_KEY` et `GOOGLE_CX` améliorent la collecte GitHub/GitLab/web utilisée comme base de comparaison.
- Résolution des gates entre requêtes (HITL asynchrone) = lot ultérieur (store partagé).
