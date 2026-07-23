# Changelog

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
