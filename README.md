# KayrosLab

[![Open in Browser](https://img.shields.io/badge/▶_Open_in_Browser-Live_Demo-2563eb?style=for-the-badge)](https://raw.githack.com/Geoking2104/KayrosLab/main/kayroslab-reference.html)
[![Website](https://img.shields.io/badge/Website-kayroslab.com-0ea5e9?style=for-the-badge)](https://www.kayroslab.com)

**Du Signal Faible à la Décision Stratégique — Atelier d'Idéation Agentique Gouverné**

KayrosLab est un **atelier d'idéation stratégique gouverné** qui transforme des signaux faibles en décisions robustes, challengées, arbitrées **puis projetées dans le temps**. Il s'appuie sur une architecture agentique (Plan-and-Solve + ReAct), une mémoire partagée + vectorielle, des calculs déterministes, et un Human-in-the-Loop structuré avec censeurs et droit de veto.

Ce n'est **pas** un modèle entraîné : c'est un **« LLM gouverné »** — un orchestrateur qui pilote de vrais LLM (Claude via backend, Ollama local) derrière une couche de gouvernance. Contrairement à un LLM conversationnel, KayrosLab suit un **processus rigoureux, traçable, résilient et cyclique en 6 étapes**.

> ▶ **Démo en ligne (sans installation)** : badge **Open in Browser** ci-dessus, ou
> https://raw.githack.com/Geoking2104/KayrosLab/main/kayroslab-reference.html

---

## 🌟 Ce qui rend KayrosLab unique

| Critère | ChatGPT / Claude / Gemini | **KayrosLab** |
|---|---|---|
| **Structure** | Conversation linéaire | **Processus cyclique en 6 étapes** (Écouter → … → Projeter → Écouter) |
| **Agents** | Un seul modèle | **Multi-agents spécialisés** (Planner, Critic, Devil's Advocate, Red Team, Bisociateur, Synthesizer) |
| **Raisonnement** | Prompt simple | **Plan-and-Solve + ReAct** ; le Planner LLM génère un vrai plan (repli déterministe robuste) |
| **Mémoire** | Contexte de session | **Shared + Vector Memory** (cosinus, InMemory ou Qdrant), orchestrateur *memory-aware* |
| **Chiffres** | Approximations du LLM | **Calculs déterministes** (Monte-Carlo, budget/ROI) — le LLM ne fait qu'alimenter les hypothèses |
| **Robustesse** | Aucune | **Retry + Circuit Breaker** + fallback multi-provider |
| **Gouvernance** | Informelle | **Gates, RBAC, veto**, classifieur de sensibilité, censeurs humains |
| **Souveraineté** | Dépendance cloud | **Ollama local** ou **Claude via backend proxy** (clés jamais côté client) |

**En résumé** : KayrosLab transforme l'IA générative en **système d'idéation gouverné**, comparable à un CODIR augmenté par des agents IA.

---

## 🔄 Le processus en 6 étapes (cyclique)

```
Écouter → Cartographier → Construire → Éprouver → Arbitrer → Projeter
   ▲                                                              │
   └──────────────  KPIs / signaux de suivi (boucle)  ◄──────────┘
```

| Étape | Nom | Rôle principal | Sortie |
|---|---|---|---|
| **01** | **Écouter** | Réduction du bruit + scoring expliqué + clustering | Signaux qualifiés |
| **02** | **Cartographier** | Réseau de tendances + ponts (bisociation) | Graphe + ponts stratégiques |
| **03** | **Construire** | Scénarios + Collision Mode + brief | Scénarios candidats + hypothèses |
| **04** | **Éprouver** | Future Proofing (Critic + Devil's Advocate + **Red Team**) | Rapport d'attaque + kill shots |
| **05** | **Arbitrer** | Challenge humain + décision tracée | Go / No-Go / Révision + livrable |
| **06** | **Projeter** | Roadmap + ressources + **prospective probabiliste** | Trajectoire pilotée + boucle vers Écouter |

Le détail exhaustif (fonctionnalités, agents, censeurs, EF, critères d'acceptation) est dans **[SPECIFICATIONS_FONCTIONNELLES.md](SPECIFICATIONS_FONCTIONNELLES.md)** et **[SPECIFICATIONS_TECHNIQUES.md](SPECIFICATIONS_TECHNIQUES.md)**.

---

## 🧠 Le cœur `core/` — moteur « LLM gouverné »

Moteur agentique **zéro dépendance** (ESM, Node 20+), testé (`node --test`), réutilisé aussi bien par l'app navigateur que par le backend. Voir **[core/README.md](core/README.md)**.

| Module | Rôle |
|---|---|
| `index.mjs` | `createEngine(opts)` — assemble providers, routage, mémoire, embeddings, gouvernance, outils, orchestrateur. |
| `kayros-llm.mjs` | Abstraction `KayrosLLM` + adaptateurs Mock / Anthropic / Ollama / HttpBackend ; `RoutingPolicy` ; circuit breaker par provider. |
| `orchestrator.mjs` | `Orchestrator` : `plan()` (Planner LLM + repli), `run()` *memory-aware*, `project()` (étape Projeter), `monitorProjection()` (boucle EF-43). |
| `projection.mjs` | Calculs **déterministes** : `simulateTrajectory` (Monte-Carlo seedé, P10/P50/P90), `estimateResources` (ETP, budget, TCO, ROI). |
| `loop.mjs` | Boucle Projeter → Écouter : `evaluateKpis`, `alertsToSignals`, `MonitoringLoop` (ordonnanceur injectable). |
| `memory.mjs` | Shared Memory + Vector Store (`InMemory` ou `Qdrant`, cosinus, filtre `ideaId`). |
| `embeddings.mjs` | `OllamaEmbeddings` / `MockEmbeddings` / `HttpEmbeddings` + `MemoryService` (remember/recall). |
| `governance.mjs` | Gates, RBAC, veto, classifieur de sensibilité (LLM + repli), `policyFor`. |
| `resilience.mjs` | Retry (backoff + jitter) + `CircuitBreaker`. |
| `tool-registry.mjs` | Registre d'outils déclaratifs (`simulate_trajectory`, `estimate_resources`, …). |
| `ki.mjs` | Kayroslab Index (5 dimensions stratégiques + 6 techniques). |

### Exemple d'usage (P1, local souverain)

```js
import { createEngine } from './core/index.mjs';
const eng = createEngine({ sovereignty: 'local', model: 'llama3.2' });

// PLAN — le Planner LLM génère le plan (repli déterministe si échec).
const plan = await eng.orchestrator.plan("Lancer une offre B2B", { ideaId: 'idea-1', sovereignty: 'local' });

// SOLVE — flux d'événements gouvernés (recall / trace / gate / final).
for await (const ev of eng.orchestrator.run(plan, { governance: 'supervise', sovereignty: 'local' })) console.log(ev.type);

// PROJETER — décision → trajectoire (chiffres déterministes).
const proj = await eng.orchestrator.project({ status: 'Go', milestones: [{ effortPersonMonths: 4, durationMonths: 2 }],
  costHypotheses: { costPerPersonMonth: 1000 }, scenarios: [{ probability: 0.6, value: 100 }, { probability: 0.4, value: 0 }] }, { ideaId: 'idea-1' });
```

Démo réelle Ollama : `node core/planner-ollama-demo.mjs [modèle] ["objectif"]`.

---

## 🔌 Backends

Deux backends, pour ne jamais exposer de clé côté client :

- **`backend/php/`** — proxy PHP pour **OVH mutualisé** (statique/PHP uniquement).
- **`backend/fastify/`** — service Node pour **VPS/PaaS**, réutilise `core/`. Endpoints :

| Endpoint | Rôle |
|---|---|
| `GET /health` | Sonde d'état (providers, modèle, config). |
| `POST /v1/llm` | Complétion LLM (proxy Claude/Ollama). |
| `POST /v1/embed` | Embeddings (souverain via Ollama). |
| `GET /v1/tools` · `POST /v1/tools/call` | Liste et exécution des outils **déterministes** (`read` uniquement). |
| `POST /v1/govern/query` | Requête gouvernée (orchestrateur + gate de sortie). |
| `POST /v1/projeter/monitor` | Tick boucle Projeter → Écouter (EF-43), appelable par cron. |

Côté navigateur, le pont `window.Kayros` (`ask`, `llm`, `project`, `callTool`, `health`) cible `https://api.kayroslab.com/v1` (surchargeable via `window.KAYROS_API_BASE`).

---

## 🛠️ Développement & tests

```bash
cd core && node --test      # 45 tests, zéro dépendance
```

Pile : cœur ESM zéro-dépendance · backend Fastify (`@fastify/cors`) · app HTML + Tailwind (standalone) · CI/CD GitHub Actions (déploiement VPS via SSH + PM2).

---

## 🚀 Déploiement (paliers)

| Palier | Description | Statut |
|---|---|---|
| **P0** | Standalone offline (mock) — un seul fichier HTML | ✅ |
| **P1** | Local souverain — Ollama (LLM + embeddings), aucune donnée ne sort | ✅ |
| **P2** | Cloud gouverné — backend proxy détenant les clés (PHP mutualisé ou Fastify VPS) | 🔵 en cours |

**CI/CD** : `.github/workflows/deploy-vps-backend.yml` déploie `backend/fastify/` sur le VPS (SSH + PM2, port 8787) à chaque push le touchant.

**Go-live P2 — actions restantes (manuelles, côté ops) :**
1. Ajouter les secrets GitHub : `VPS_SSH_USER`, `VPS_SSH_KEY`, `ANTHROPIC_API_KEY`.
2. Sur le VPS : reverse proxy nginx `api.kayroslab.com` → `localhost:8787` + DNS + TLS (certbot).
3. (Optionnel) cron horaire vers `/v1/projeter/monitor` (voir `backend/fastify/DEPLOY-VPS.md`).

---

## 🗺️ Feuille de route

| Phase | Objectif | Statut |
|---|---|---|
| v1–v4 | Prototype standalone, agentique (ReAct + Plan-and-Solve), résilience, multi-idées + Vector Memory | ✅ |
| v5 | Cœur « LLM gouverné » réel (Planner LLM, mémoire branchée, embeddings, gouvernance) | ✅ |
| v6 | Étape **Projeter** (roadmap, prospective probabiliste) + boucle cyclique | ✅ |
| v7 | Backends (PHP + Fastify) + intégration Claude/Ollama réelle | ✅ (P2 en déploiement) |
| v8 | Synchronisation cloud, multi-tenant | Prévu |

---

## 📬 Contact

**Geoffroy de La Tournelle** — Founder & Director, KayrosLab
[geoffroydelatournelle@gmail.com](mailto:geoffroydelatournelle@gmail.com) · [LinkedIn](https://www.linkedin.com/in/gdelatournelle/)

---

*KayrosLab — Transformer le bruit en stratégie gouvernée.*
