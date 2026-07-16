# KayrosLab — Cœur « LLM gouverné » (`core/`)

Modules ESM **portables navigateur + Node**, zéro dépendance, dérivés de `SPECIFICATIONS_TECHNIQUES.md`.
Objectif : orchestrer de vrais LLMs (Claude/Ollama) derrière une couche de gouvernance humaine.

## Modules

| Fichier | Rôle | Réf. specs |
|---|---|---|
| `resilience.mjs` | Retry (backoff exponentiel + jitter) + Circuit Breaker (CLOSED/OPEN/HALF_OPEN) | §7 (EF-27/28) |
| `kayros-llm.mjs` | Abstraction `KayrosLLM` + adaptateurs Mock / Anthropic / Ollama + RoutingPolicy | §5 (EF-24/25/26) |
| `tool-registry.mjs` | Registre d'outils (function calling) + validation | §4 |
| `memory.mjs` | Shared Memory + Vector Store en mémoire (cosinus, interface Qdrant-compatible) | §6 (EF-17/18) |
| `ki.mjs` | KI : 5 dimensions **stratégiques** alimentées par 6 dimensions techniques | §11 (EF-22/23) |
| `governance.mjs` | Gates, RBAC, veto, classifieur de sensibilité, `policyFor` (défaut `supervise`) | §8 (EF-19/20/21, 34/36/37/38) |
| `orchestrator.mjs` | Plan-and-Solve + ReAct (flux de traces) + gouvernance de sortie | §3 (EF-15/16) |
| `index.mjs` | Assemblage `createEngine()` | — |

## Utilisation

```js
import { createEngine } from './core/index.mjs';

const eng = createEngine();                       // adaptateur mock par défaut (offline)
const plan = await eng.orchestrator.plan('Évaluer un scénario');

for await (const ev of eng.orchestrator.run(plan, { governance: 'supervise' })) {
  if (ev.type === 'gate') {
    // un censeur humain habilité valide ou pose un veto
    eng.governance.resolve(ev.gateId, { decision: 'approve', by: 'geoff', role: 'comex' });
  }
  console.log(ev);
}
```

Souveraineté (LLM local) : `createEngine({ sovereignty: 'local', ollamaEndpoint: 'http://localhost:11434' })`.

## Tests

```bash
cd core && npm test        # ou: node --test
```

14 tests unitaires + intégration (fonctions pures + orchestrateur auto/strict/veto). **Statut : ✅ tous verts.**

## Périmètre & limites

- Les adaptateurs **Anthropic/Ollama** sont des squelettes : Anthropic passe par un **backend proxy** (clé jamais au client, §10). Le mock est déterministe (offline).
- Interactivité DOM non couverte ici (à intégrer dans `kayroslab-reference.html`).
- Prochaines étapes : brancher Ollama réel, Qdrant, backend Fastify, puis câbler l'UI.
