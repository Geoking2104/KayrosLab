# KayrosLab

[![Site & Offre](https://img.shields.io/badge/🏢_Site_&_Offre-Entreprises-7c3aed?style=for-the-badge)](https://raw.githack.com/Geoking2104/KayrosLab/main/index.html)
[![Positionnement](https://img.shields.io/badge/🎯_Positionnement-Concurrentiel-f97316?style=for-the-badge)](https://raw.githack.com/Geoking2104/KayrosLab/main/frontend/positionning-app/dist/index.html)
[![Portefeuille](https://img.shields.io/badge/📊_Portefeuille-Application-059669?style=for-the-badge)](https://raw.githack.com/Geoking2104/KayrosLab/main/kayroslab-portfolio.html)
[![Open in Browser](https://img.shields.io/badge/▶_Atelier-Live_Demo-2563eb?style=for-the-badge)](https://raw.githack.com/Geoking2104/KayrosLab/main/kayroslab-reference.html)
[![Website](https://img.shields.io/badge/Website-kayroslab.com-0ea5e9?style=for-the-badge)](https://www.kayroslab.com)

**Du signal faible à la décision stratégique — gouvernée.**

KayrosLab est un **atelier d'idéation stratégique gouverné** qui transforme des signaux faibles en décisions robustes, challengées, arbitrées, projetées **puis exécutées et mesurées**. Architecture agentique (Plan-and-Solve + ReAct), mémoire vectorielle, calculs déterministes, et Human-in-the-Loop structuré avec censeurs et droit de veto.

Ce n'est **pas** un modèle entraîné : c'est un **« LLM gouverné »** — un orchestrateur qui pilote de vrais LLM (Claude via backend, Ollama local) derrière une couche de gouvernance.

---

## 🚀 Les trois entrées

| Page | Usage |
|---|---|
| **[`index.html`](index.html)** | Site & offre commerciale entreprises (processus, architecture, conformité, tarification, business cases) |
| **[`kayroslab-portfolio.html`](kayroslab-portfolio.html)** | Application portefeuille : kanban, gates, votes, notation, impact, reporting |
| **[`kayroslab-reference.html`](kayroslab-reference.html)** | Atelier d'idéation (démo du moteur agentique) |
| **[`frontend/positionning-app/`](frontend/positionning-app/)** | Application React de positionnement concurrentiel (scoring 14 neurones, graphe, export RDF) |

---

## 🔄 Le processus

```
Écouter → Cartographier → Construire → Positionner → Éprouver → Arbitrer → Projeter → Réaliser
   ▲                                                                         │
   └──────────────────  KPIs / signaux de suivi (boucle)  ◄──────────────────┘
```

| # | Étape | Rôle | Sortie |
|---|---|---|---|
| 00 | **Recueillir** | Canevas d'intake structuré | Idée comparable dès l'entrée |
| 01 | **Écouter** | Réduction du bruit, scoring, clustering | Signaux qualifiés |
| 02 | **Cartographier** | Réseau de tendances, ponts (bisociation) | Graphe + ponts stratégiques |
| 03 | **Construire** | Scénarios, Collision Mode, brief | Scénarios + hypothèses |
| 04 | **Positionner** | Web + GitHub/GitLab scraping, scoring 14 neurones, gap analysis | Matrice concurrentielle + gap analysis |
| 05 | **Éprouver** | Critic + Devil's Advocate + **Red Team** | Rapport d'attaque, kill shots |
| 06 | **Arbitrer** | Vote pondéré, gate humain, veto | Go / No-Go / Révision |
| 07 | **Projeter** | Roadmap, ressources, **prospective probabiliste** | Trajectoire + boucle vers Écouter |
| 08 | **Réaliser** | Pilote → Déploiement → Bilan | Jalons suivis, impact constaté |

**Deux axes orthogonaux.** L'**étape** dit où en est l'*exécution* ; le **statut** dit où en est la *décision*. Une idée peut être « en revue » tout en étant en « Construire ». Les états dormants (`en_pause`, `consideration_future`, `non_poursuivi`) sont réactivables.

Détail exhaustif : **[SPECIFICATIONS_FONCTIONNELLES.md](SPECIFICATIONS_FONCTIONNELLES.md)** (EF-01→87) et **[SPECIFICATIONS_TECHNIQUES.md](SPECIFICATIONS_TECHNIQUES.md)**.

---

## 🌟 Ce qui distingue KayrosLab

| Critère | LLM conversationnel | Plateforme d'innovation | **KayrosLab** |
|---|---|---|---|
| Structure | Conversation | Stage-gate | **Cycle gouverné en 7 étapes** |
| Agents | Un modèle | — | **Multi-agents** (Planner, Critic, Devil's Advocate, **Red Team**, Bisociateur, Synthesizer) |
| Chiffres | Approximations du LLM | Saisie manuelle | **Calculs déterministes** (Monte-Carlo seedé, P10/P50/P90) |
| Décision | Informelle | Vote | **Vote pondéré qui instruit + veto qui tranche** |
| Impact | — | Réalisé | **Réalisé confronté au projeté** |
| Souveraineté | Cloud | Cloud | **Ollama local** ou backend proxy (clés jamais côté client) |

Le vote agrégé **instruit** la décision, il ne la remplace pas : le veto reste entier, et tout refus exige un motif.

---

## 🧠 Le cœur `core/`

Moteur **zéro dépendance** (ESM, Node 20+), **81 tests**, réutilisé par l'application navigateur et le backend. Voir **[core/README.md](core/README.md)**.

| Module | Rôle |
|---|---|
| `index.mjs` | `createEngine(opts)` — assemble providers, mémoire, embeddings, gouvernance, outils, orchestrateur |
| `orchestrator.mjs` | `plan()` (Planner LLM + repli), `run()` memory-aware, `project()`, `monitorProjection()` |
| `kayros-llm.mjs` | Abstraction LLM + adaptateurs Mock / Anthropic / Ollama / HttpBackend, circuit breaker |
| `model.mjs` | Entité Idée, **étapes × statuts orthogonaux**, transitions tracées, réactivation |
| `repository.mjs` | Dépôts InMemory / Fichier, vue **portefeuille** + compteurs WIP |
| `auth.mjs` | scrypt, jetons HMAC, révocation, anti-bruteforce, multi-tenant |
| `intake.mjs` | Canevas Recueillir → **hypothèses** (Construire) + **cibles d'attaque** (Éprouver) |
| `scorecard.mjs` | Grilles paramétrables, une par étape, couverture partielle explicite |
| `evaluation.mjs` | Vote pondéré par rôle, dispersion, consensus, recommandation |
| `campaign.mjs` | Campagnes (fenêtre de soumission) + **modération** : rejet motivé, exclusion du portefeuille |
| `comments.mjs` | Fil de discussion à deux niveaux, édition datée, **suppression douce** (audit préservé) |
| `projection.mjs` | **Monte-Carlo seedé** (P10/P50/P90), estimation ETP/budget/TCO/ROI |
| `impact.mjs` | Investissements, bénéfices, **écart réalisé vs projeté** |
| `execution.mjs` | Étape Réaliser : phases, jalons suivis, retards, bilan |
| `reporting.mjs` | Dashboard, **entonnoir**, temps par étape, ROI agrégé, comparaison inter-idées, export CSV |
| `loop.mjs` | Boucle Projeter → Écouter (KPIs, seuils, re-arbitrage) |
| `positionning/` | Module de positionnement concurrentiel : web scanner, GitHub/GitLab scanner, scoring 14 neurones, gap analysis, matrice + export RDF |
| `governance.mjs` | Gates, RBAC, veto, classifieur de sensibilité, **persistance + audit** |
| `notify.mjs` | Canaux réels (webhook, email, composite tolérant aux pannes), **activité** et **digest** |
| `memory.mjs` · `embeddings.mjs` | Shared + Vector Memory (InMemory / Qdrant), recall sémantique |
| `resilience.mjs` · `ki.mjs` · `tool-registry.mjs` | Retry + Circuit Breaker · Kayroslab Index · outils déclaratifs |

---

## 🔌 Backend

`backend/fastify/` (VPS/PaaS, réutilise `core/`) et `backend/php/` (proxy OVH mutualisé).

| Domaine | Endpoints |
|---|---|
| LLM & outils | `POST /v1/llm` · `POST /v1/embed` · `GET /v1/tools` · `POST /v1/tools/call` · `POST /v1/govern/query` |
| Authentification | `POST /v1/auth/register\|login\|logout` · `GET /v1/auth/me` |
| Portefeuille | `GET\|POST /v1/ideas` · `GET\|PATCH /v1/ideas/:id` · `GET /v1/portfolio` |
| Évaluation | `POST /v1/ideas/:id/votes` · `POST /v1/ideas/:id/score` · `GET /v1/scorecards` |
| Collecte | `GET\|POST /v1/campaigns` · `GET /v1/moderation` · `POST /v1/ideas/:id/moderate` |
| Discussion | `GET\|POST /v1/ideas/:id/comments` · `DELETE /v1/ideas/:id/comments/:commentId` |
| Activité | `GET /v1/activity` · `GET /v1/digest` |
| Gouvernance | `POST /v1/ideas/:id/gates` · `GET /v1/gates` · `POST /v1/gates/:id/resolve` |
| Projeter & impact | `POST /v1/ideas/:id/projection` · `GET\|POST /v1/ideas/:id/impact` · `POST /v1/projeter/monitor` |
| Réaliser | `POST\|PATCH /v1/ideas/:id/execution` |
| Reporting | `GET /v1/reporting/dashboard` · `POST /v1/reporting/compare` · `GET /v1/reporting/export` |

**Sécurité par défaut sûre.** Sans `KAYROS_AUTH_SECRET`, les routes protégées répondent `503` — jamais ouvertes. Le `tenantId` provient du jeton, jamais du client. Les clés LLM restent côté serveur.

---

## 🛠️ Développement

```bash
cd core && node --test      # 81 tests, zéro dépendance
```

**Persistance** (fichiers JSON, écriture atomique) : `KAYROS_USERS_FILE` (0600), `KAYROS_IDEAS_FILE`, `KAYROS_GATES_FILE`.
**Notifications** : `KAYROS_NOTIFY_WEBHOOK` (Slack/Teams/n8n) ou `KAYROS_SMTP_URL`. Voir `backend/fastify/.env.sample`.

---

## 🚢 Déploiement

| Palier | Description | Statut |
|---|---|---|
| **P0** | Standalone offline (mock) — fichier HTML autonome | ✅ |
| **P1** | Local souverain — Ollama (LLM + embeddings), aucune donnée sortante | ✅ |
| **P2** | Cloud gouverné — backend proxy détenant les clés (VPS Fastify ou PHP mutualisé) | 🔵 en cours |

**CI/CD** : `.github/workflows/deploy-vps-backend.yml` déploie `backend/fastify/` sur le VPS (SSH + PM2, port 8787).

**Go-live P2 — actions restantes (côté ops) :**
1. Secrets GitHub : `VPS_SSH_USER`, `VPS_SSH_KEY`, `ANTHROPIC_API_KEY`.
2. Sur le VPS : reverse proxy nginx `api.kayroslab.com` → `localhost:8787` + DNS + TLS.
3. Variables de persistance et de notification (cf. `.env.sample`).

---

## 📊 Couverture fonctionnelle

| Périmètre | Exigences | État |
|---|---|---|
| Processus d'idéation | EF-01 → EF-45 | ✅ implémenté |
| Plateforme & collaboration | EF-46 → EF-87 | **39 réalisées · 3 partielles · 0 à construire** |

Les 3 partielles sont assumées : persistance en fichiers plutôt qu'en base partagée multi-instance (EF-46), réactivation d'idée dormante sans action dédiée dans l'interface (EF-58), facettes de filtrage incomplètes (EF-55).

> ⚠️ **Réserve.** Les statuts « réalisé » attestent d'un code **testé unitairement**, pas d'une recette fonctionnelle : le parcours HTTP complet n'a pas encore été exécuté contre un serveur en fonctionnement (déploiement P2 en attente).

---

## 🗺️ Feuille de route

| Phase | Objectif | Statut |
|---|---|---|
| v1–v4 | Prototype, agentique (ReAct + Plan-and-Solve), résilience, mémoire vectorielle | ✅ |
| v5 | Cœur « LLM gouverné » réel (Planner LLM, gouvernance, embeddings) | ✅ |
| v6 | Étape Projeter + boucle cyclique + prospective probabiliste | ✅ |
| v7 | Backends, authentification, portefeuille multi-utilisateur | ✅ |
| v8 | Cycle aval (Réaliser) + reporting portefeuille | ✅ |
| v9 | Collaboration : campagnes, modération, commentaires, activité & digest | ✅ |
| v10 | Recette en conditions réelles, base partagée multi-instance | 🔵 |

---

## 📬 Contact

**Geoffroy de La Tournelle** — Founder & Director, KayrosLab
[geoffroydelatournelle@gmail.com](mailto:geoffroydelatournelle@gmail.com) · [LinkedIn](https://www.linkedin.com/in/gdelatournelle/)

---

*KayrosLab — Transformer le bruit en stratégie gouvernée.*
