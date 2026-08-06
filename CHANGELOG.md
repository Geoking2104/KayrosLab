# Changelog

## Unreleased / 2026-08-06 (ontology)

### Fixed
- **Public demo step 4 (Positioner)** — removed hard-coded Microsoft Ontology Playground catalogue (`official/ecommerce`) that was disconnected from the user idea
- Ontology network is now **derived from the idea** via Mistral structured JSON (`entities`, `relations`, `gaps`)
- Actionable **gap selection** (1–3) injected into subsequent Challenge / Decide prompts so the ontology becomes necessary to redefine ideas

### Added
- `normalizeOntologyMap`, `renderOntologyGraph`, `buildOntologyPanel`, `toggleOntologyGap` in the demo HTML
- Positioner system prompt now requires a structured ontology block

---

## Unreleased / 2026-08-06

### Added
- **Embedding-based novelty scoring** for Bisociator collisions (`core/novelty.mjs`)
  - `buildCollisionEmbedText()` — structured text for embeddings (Framework + Mechanism + Proposal + Bridge)
  - `scoreNovelty()` — composite novelty from intra-batch diversity, memory distance, and input distance
  - `scoreCollisions()` — high-level embed + rank helper
  - `filterDiverse()` — soft near-duplicate filter
- **Soft-fallback embedding model selection** (`core/embed-select.mjs`)
  - Priority: `qwen3-embedding:0.6b` → `bge-m3` → `mxbai-embed-large` → `nomic-embed-text` → Mock
  - Env override via `KAYROS_EMBED_MODEL`
- **BisociateurAgent upgrades**
  - Richer structured collisions (`proposal`, `mechanismTransferred`, `firstExperiment`)
  - 7 analogy frameworks (added Mycelial Network, Phase Transition)
  - Optional real novelty scoring when embeddings are injected
  - `runMultiCollision()` — generate & rank multiple collisions by novelty
- Embeddings instance is now injected into the Bisociateur by `createEngine()` when available

### Notes
- Heuristic novelty/feasibility scores remain as fallback for offline / mock mode
- Public demo page (`kayroslab-complete-with-ai-agents.html`) still uses client-side mock flow; engine-side novelty is ready for the next UI iteration

---

## v0.2.0 (2026-07-23)

### Added
- **P0: Core/positionning/** — Ontologie complète (14 types, 13 relations), scanners web/ GitHub/ GitLab/ ArXiv, scoring déterministe, gap analysis, Kayros Index, export OWL RDF/XML.
- **P0: Endpoints REST** — 6 routes `/v1/positionning/*` pour recherche concurrents, analyse, export.
- **P1: Scoring déterministe** — `computeCompetitorScores()` sans `Math.random()`, reproductible.
- **P1: Connecteur Teams** — `TeamsAdapter` avec Adaptive Cards v1.5, vérification signature, webhook/bot.
- **P2: i18n** — Traductions EN/FR, `I18nContext` React + localStorage.
- **P2: Agents spécialisés** — 6 agents (Planner, Critic, Devil's Advocate, Red Team, Bisociateur, Synthesizer) avec prompts, parsing structuré, délégation orchestrateur.
- **P2: Dashboard stratégique** — Composant React avec KPIs, répartition par étape, portefeuille financier, entonnoir de conversion, top idées. Appel API réel + fallback mock.
- **P2: Nodemailer** — Dépendance officielle `^6.9.16`.
- **P2: Qdrant** — `QdrantVectorStore` câblé dans `createEngine()` via option `qdrantUrl`.
- **Phase 1: Stabilisation** — `setBaseline` manquant corrigé, proxy Vite port fixé (`:8787`), `validateEnv()`, dépendances mortes supprimées.
- **Phase 2: Robustesse** — Rate limiting (`@fastify/rate-limit` 100 req/min), body limit 1 Mo, parseurs XML/HTML structurés, GitHub KPI parallélisé (`Promise.allSettled` + timeout 8s), `ErrorBoundary` React, 13 tests frontend smoke, seuil de gap paramétrable.
- **Phase 3: Production hardening** — Métriques Prometheus (`/metrics`), script backup automatique (30j rétention, vérification intégrité), doc Prometheus scrape.

### Fixed
- `setBaseline` `ReferenceError` dans `App.jsx` (état manquant).
- Proxy Vite pointait sur le mauvais port (`:3001` → `:8787`).
- Parsing ArXiv Atom et DuckDuckGo HTML par regex fragiles → parseurs structurés.
- Appels GitHub KPI séquentiels → parallélisés avec timeout.
- `express` + `ejs` dépendances mortes du backend.
- `package.json` `main: "index.js"` → `"index.mjs"`.
- `verifyPassword()` sans limite de taille (DoS vector scrypt).
- Nginx config sans mention HTTPS (certbot workflow existant).

### Security
- Auth: scrypt + sel 16 bytes, timingSafeEqual, throttling (5×/15min), révocation session.
- Token: HMAC-SHA256, `iat`/`exp`/`jti`, denylist + notBefore.
- Stockage: écriture atomique fichier JSON, permissions 0600.
