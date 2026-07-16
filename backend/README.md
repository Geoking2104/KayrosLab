# KayrosLab — Backends du proxy LLM gouverné

Deux implémentations d'un **même rôle** : cacher la clé LLM côté serveur, lever CORS/mixed-content,
et exposer un endpoint que l'app navigateur appelle via `HttpBackendProvider` (voir `core/`).

| Backend | Techno | Où le déployer | Statut |
|---|---|---|---|
| [`php/`](php/) | PHP + cURL | **Hébergement mutualisé OVH** (ton FTP `filenyb.cluster129…`) | Déployable maintenant |
| [`fastify/`](fastify/) | Node 20 + Fastify | **VPS / Public Cloud / PaaS Node** (pas le mutualisé) | Prêt, à déployer sur hôte Node |

> Rappel : l'hébergement **mutualisé OVH ne fait pas tourner Node/Fastify** (PHP/statique uniquement).
> Le proxy PHP couvre le besoin immédiat ; Fastify est là pour une migration future vers un VPS.

## Contrat commun

Les deux exposent une **complétion LLM** :

```
POST  (php: /api/govern.php   |   fastify: /v1/llm)
Body: { "messages":[{"role":"user","content":"..."}], "provider":"anthropic|ollama", "model":"...", "role":"...", "temperature":0.3 }
Rép.: { "text":"...", "provider":"anthropic", "usage":{ "tokensIn":n, "tokensOut":n } }
```

Fastify ajoute `POST /v1/govern/query` (orchestrateur complet + gate de gouvernance) et `GET /health`.

## Câblage côté navigateur (`core/`)

```js
import { createEngine } from './core/index.mjs';

// Le client n'a JAMAIS la clé : il appelle le proxy.
const eng = createEngine({
  backendUrl: 'https://www.kayroslab.com/api/govern.php',  // ou l'URL Fastify /v1/llm
  backendProvider: 'anthropic',                            // ou 'ollama'
  // secret: 'xxxx'   // si un secret partagé est activé côté serveur
});

for await (const ev of eng.orchestrator.run(await eng.orchestrator.plan('...'), { governance: 'supervise' })) {
  if (ev.type === 'gate') eng.governance.resolve(ev.gateId, { decision: 'approve', by: 'geoff', role: 'comex' });
  console.log(ev);
}
```

## Sécurité (rappel specs techniques §10)

- La clé LLM vit **uniquement côté serveur** (config PHP hors dépôt / variable d'env Fastify).
- Restreindre `ALLOWED_ORIGIN` à ton domaine (pas `*` en prod).
- Secret partagé optionnel (`X-Kayros-Secret`) pour limiter l'accès au proxy.
