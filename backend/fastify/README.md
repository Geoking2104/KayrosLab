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
- **API publique v1** (intégrations Salesforce / n8n / Zapier) : `GET /v1/public/me`, `GET /v1/public/collectives`, `POST /v1/public/missions` (202, `Idempotency-Key`), `GET /v1/public/missions/:id`, `GET /v1/public/missions?external_ref=` ; spécification `GET /v1/public/openapi.json`, référence `GET /docs`. Détails : `docs/API.md`.
- Console → Intégrations : `/v1/console/integrations` (clés d'API, webhook signé, journal des livraisons).
- `POST /v1/demo/chat` → proxy LLM public de la démo HTML, sans clé côté navigateur.
- `POST /v1/demo/report-leads` → capture lead RGPD et envoi SMTP du PDF/Markdown généré par la démo.
- `POST /v1/demo/positionning/analyze` → analyse Positionner publique via Mistral serveur, sans fallback local ni exemples codés en dur.
- `POST /v1/llm` → complétion brute `{ messages, provider, model, role, temperature }` (utilisé par l'app navigateur).
- `POST /v1/govern/query` → orchestrateur complet `{ query, governance, sovereignty, provider }`.
  - Réponse `200 { status, answer, trace }` en mode `auto` / non sensible.
  - Réponse `202 { status:'pending_review', gateId, gateType }` si un gate humain est requis.
- `POST /mcp` → Developer Portal MCP stateless (Bearer tenant-scoped, catalogue + swarms + dossiers).
- `POST|GET /v1/sales-oracle/cases` → créer ou lister les dossiers d'analyse du tenant.
- `POST /v1/sales-oracle/cases/:caseId/documents/uploads` → valider les quotas et obtenir une URL `PUT` S3 signée (15 min par défaut).
- `POST /v1/sales-oracle/cases/:caseId/documents/:documentId/complete` → vérifier taille/checksum puis mettre l'ingestion en file.
- `GET /v1/sales-oracle/cases/:caseId/documents` et `GET /v1/sales-oracle/documents/:documentId/status` → suivre le corpus.

Les octets ne transitent pas par Fastify : ils sont envoyés directement vers un stockage S3-compatible. Configurez les variables `KAYROS_S3_*` de `.env.sample`; les secrets restent exclusivement côté serveur et `.env` est ignoré par Git.

## Tester

```bash
curl -s localhost:8787/health
curl -s -X POST localhost:8787/v1/llm -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"bonjour"}],"provider":"mock"}'
```

## Production

- Servir derrière un reverse proxy HTTPS (nginx/caddy), restreindre `ALLOWED_ORIGIN`.
- Gérer le process avec pm2/systemd. Clés via variables d'environnement (jamais dans le dépôt).
- Pour l'envoi des rapports, du contact et des resets : `KAYROS_SMTP_PASS` (mot de passe d'application Gmail), `KAYROS_MAIL_FROM` et `KAYROS_REPORT_LEAD_BCC` (par défaut : `geoffroydelatournelle@gmail.com`). `contact@kayroslab.com` reste l'adresse publique (redirection IONOS).
- Fournisseur LLM du serveur : `NVIDIA_API_KEY` (NVIDIA NIM, OpenAI-compatible, modèle `NVIDIA_MODEL`, défaut `deepseek-ai/deepseek-v4.1-flash`) est prioritaire, puis `MISTRAL_API_KEY`, puis `ANTHROPIC_API_KEY`, sinon `mock` ; `LLM_PROVIDER` force un choix. Repli signalé : Mistral puis mock. 429 : relances avec backoff + Retry-After (`LLM_MAX_RETRIES`), swarm borné par `LLM_MAX_CONCURRENCY`. Détails : `DEPLOY-VPS.md` §4 et `lib/llm-config.mjs`.
- Missions console asynchrones : `POST /v1/console/sessions/:id/run` et `POST /v1/console/threads/:id/messages` répondent `202` (`thread_id`, `run_id`, `status: "running"`, `progress`) ; le collectif tourne en tâche de fond, `GET /v1/console/threads/:id` (ou `/sessions/:id`) expose `status` (`running` → `needs_clarification` | `awaiting_arbitration`, ou `failed` + `error`) et `progress` (`{ completed, total }`). Une mission à la fois par session (409 sinon). `?wait=true` = ancien mode synchrone. Au démarrage, les missions restées `running` passent `failed`. Délai maximal : `KAYROS_CONSOLE_RUN_TIMEOUT_MS` (30 min). Kimi K3 : `DEPLOY-VPS.md` §4.
- Pour Positionner, renseigner `MISTRAL_API_KEY` (l'analyse contextuelle utilise l'API Conversations/web_search propre à Mistral, inchangée); `GITHUB_TOKEN`, `GITLAB_TOKEN`, `GOOGLE_API_KEY` et `GOOGLE_CX` améliorent la collecte GitHub/GitLab/web utilisée comme base de comparaison.
- Résolution des gates entre requêtes (HITL asynchrone) = lot ultérieur (store partagé).
