# `core/` — Cœur LLM gouverné KayrosLab

Moteur agentique (zéro dépendance, ESM, Node 20+) qui orchestre de vrais LLM
(Claude / Ollama) derrière une couche de gouvernance avec censeurs humains.
Ce n'est **pas** un modèle entraîné : c'est un orchestrateur gouverné.

## Modules

| Fichier | Rôle |
|---|---|
| `index.mjs` | `createEngine(opts)` — assemble providers, routage, mémoire, embeddings, gouvernance, orchestrateur. |
| `kayros-llm.mjs` | Abstraction `KayrosLLM` + adaptateurs `Mock`, `Anthropic`, `Ollama`, `HttpBackend` ; `RoutingPolicy` ; circuit breaker par provider. |
| `orchestrator.mjs` | `Orchestrator` (Plan-and-Solve + ReAct), memory-aware. Planner LLM + repli déterministe. |
| `resilience.mjs` | `computeBackoff`, `CircuitBreaker`, `withResilience` (retry + backoff + jitter). |
| `memory.mjs` | `SharedMemory`, `InMemoryVectorStore`, `QdrantVectorStore` (cosinus, filtre par `ideaId`). |
| `embeddings.mjs` | `OllamaEmbeddings`, `MockEmbeddings`, `HttpEmbeddings`, `MemoryService` (remember/recall). |
| `governance.mjs` | Gates, RBAC, veto, classifieur de sensibilité (LLM + repli), `policyFor`. |
| `ki.mjs` | Kayroslab Index (5 dimensions stratégiques + 6 techniques). |
| `tool-registry.mjs` | Registre d'outils (`demoTools`). |

## Démarrage rapide

```js
import { createEngine } from './index.mjs';

// P0 (offline, mock) : createEngine()
// P1 (local souverain, Ollama) :
const eng = createEngine({ sovereignty: 'local', model: 'llama3.2' });

// PLAN : le Planner LLM génère le plan (repli déterministe si échec/non-JSON).
const plan = await eng.orchestrator.plan("Lancer une offre B2B", { ideaId: 'idea-1', sovereignty: 'local' });
// -> { ideaId, goal, generatedBy: 'llm' | 'fallback', steps: [...] }

// SOLVE (ReAct) : flux d'événements (recall / trace / gate / final).
for await (const ev of eng.orchestrator.run(plan, { governance: 'supervise', sovereignty: 'local' })) {
  console.log(ev.type, ev);
}
```

Démo réelle Ollama : `node core/planner-ollama-demo.mjs [modèle] ["objectif"]`.

## Planner LLM (notes)

Le Planner attend un **tableau JSON** `[{ "agent", "description" }]` (dernière étape = `Synthesizer`).
`parsePlanSteps` est robuste : il retire les blocs `<think>…</think>` (modèles *thinking*),
les fences markdown, extrait le premier tableau JSON équilibré et récupère les objets
complets d'un JSON tronqué. En cas d'échec total → repli déterministe (4 étapes).

- **`plannerModel`** (`createEngine` / `Orchestrator`) : modèle léger dédié au Planner
  (latence). Les gros modèles *thinking* (ex. `qwen3.5:9b`) sont contre-productifs ici
  et lents en CPU — à réserver au VPS/GPU ou au batch async.
- **`think: false`** est transmis à Ollama pour les appels Planner (JSON direct, pas de
  raisonnement exposé).

## Paliers de déploiement

- **P0** — standalone (mock, offline).
- **P1** — local souverain (`sovereignty: 'local'` → Ollama, aucune donnée ne sort).
- **P2** — cloud gouverné : passer par le **backend proxy** (`backendUrl`) qui détient les clés
  (PHP mutualisé OU Fastify VPS). Jamais de clé côté client.

## Tests

```bash
cd core && node --test      # 34 tests, zéro dépendance
```
