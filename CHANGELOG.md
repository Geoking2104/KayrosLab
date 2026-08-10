# Changelog

## v0.18.3 (2026-08) — EF-42 · Matrice de risques probabilisés

- **`core/risques.mjs`** (nouveau) — `niveauRisque` (score probabilité×impact, niveaux faible→critique), `addRisque`/`updateRisque`/`removeRisque` (enrichissement idempotent), `matriceRisques` (grille 5×5 + distribution), `detectDeclencheurs` (risques actifs ≥ seuil → raisons), `rapportRisques`.
- **`backend/fastify/routes/portfolio.mjs`** — `POST /v1/ideas/:id/risques` (add/update/remove, persistance `roadmap.risques`, gate `re_arbitrage` COMEX si déclencheur, événements `risque.add|update|remove|rearbitrage`) ; `GET /v1/ideas/:id/risques` (matrice + déclencheurs).
- **Tests** — `core/risques.test.mjs` (7) + `backend/fastify/tests/portfolio.risques.test.mjs` (3).
- **Spécifications** — EF-42 marqué 🟢 (SPECIFICATIONS_FONCTIONNELLES.md + §4.1 TECHNIQUES).

## v0.18.2 (2026-08) — Étape 7 · Réaliser (boucle monitor EF-43 + lecture exécution)

- **`backend/fastify/routes/portfolio.mjs`** — `POST /v1/ideas/:id/execution/monitor` (boucle Projeter → Écouter : relève des KPIs constatés, évaluation seuils + dérive via `core/loop.mjs`/`core/kpi-drift.mjs`, persistance `idea.loop`, ouverture d'un gate `re_arbitrage` COMEX, événements d'audit `loop.monitor`/`loop.alert`) ; `GET /v1/ideas/:id/execution` (execution + progression + rapport d'impact).
- **Tests** — `backend/fastify/tests/portfolio.execution.test.mjs` (5) : démarrage pilote, jalons, passage de phase, clôture → `termine`, monitor seuil franchi → signal + re-arbitrage, monitor sans dérive → aucun signal.
- **Spécifications** — EF-43 marqué 🟢 (SPECIFICATIONS_FONCTIONNELLES.md + §4.1 TECHNIQUES).

## v0.18.1 (2026-08) — Étape 6 · Projeter (API roadmap + projections)

- **`core/roadmap.mjs`** (nouveau) — `buildRoadmap`, `projectFromIdea`, `isProjected`. Construit la `roadmap{jalons,raci,kpis,risques,gatesFuturs,ressources}` et les `projections{scénariosPondérés,valeurAttendue,p10/p50/p90}` (Monte-Carlo déterministe) à partir d'hypothèses fournies. Aucun nombre n'est inventé.
- **`backend/fastify/routes/portfolio.mjs`** — `POST /v1/ideas/:id/roadmap` (construction + persistance, événement d'audit `project.roadmap`), `GET /v1/ideas/:id/roadmap` (lecture + rapport d'impact `impactReport`). Schema zod validé.
- **Tests** — `core/roadmap.test.mjs` (4) + `backend/fastify/tests/portfolio.roadmap.test.mjs` (2).
- **Spécifications** — EF-39/40/41 marqués 🟢 dans SPECIFICATIONS_FONCTIONNELLES.md; §4.1 SPECIFICATIONS_TECHNIQUES.md renforcé.

## v0.18.0 (2026-08) — Governed intelligence layers (P0 → P4)

### P0 — Epistemic tags + Decision packets
- **`core/epistemic.mjs`** — `tagEpistemic`, levels (`observed` → `unknown`), `aggregateEpistemic`, `explainUncertainty`. Stops confident wrongness.
- **`core/decision-packet.mjs`** — `compilePacket`, `applyEpistemicPolicy`, `assertGateable`, `renderPacketForGate`, `policyForPacket`. Packet is the single object shown at gates (now v0.4 with world/debt fields).

### P1 — Novelty as control loop + Dialectical contest
- **`core/novelty-controller.mjs`** — `runNoveltyControl`, kill near-duplicates, axis quotas, re-bisociate rounds.
- **`core/dialectic.mjs`** — heuristic + agent attack/rebut, `runTournament`, survival scoring.
- **`core/run-hooks-p1.mjs`** — opt-in orchestration hooks (`noveltyControl`, `dialectic`).

### P2 — Problem reframing + cheap frame gate
- **`core/frame.mjs`** — `assessFrame`, dimension scores, heuristic reframes, `runFrameControl`.
- **`core/run-hooks-p2.mjs`** — early opt-in frame control in `Orchestrator.run`.
- Weak frames auto-pick or open `frame_review` before expensive agent cycles.

### P3 — World model + multi-resolution gates
- **`core/world-model.mjs`** — `sketchWorldModel` (actors, constraints, resources, uncertainties, assumption ledger), `resolveGateLevel` (light / standard / heavy), `runWorldModelControl`.
- Critical assumptions + targeted falsifiers feed the decision packet.
- Gate depth adapts to stakes + coverage + epistemic rank.

### P4 — Adaptive compute + residual portfolio + decision debt
- **`core/adaptive.mjs`** — `computePressure`, `allocateCompute`, `buildResidualPortfolio`, `suggestRevisitTriggers`, `runAdaptiveControl`.
- Pressure drives maxSteps / dialectic depth / novelty rounds.
- Residual risk portfolio + decision-debt signals + revisit triggers on the packet / gate view.

### Integration
- **`core/run-hooks-p3p4.mjs`** — combined post-agent hooks.
- `Orchestrator.run` sequence: start → **P2 frame** → recall/position → agents → **P1 novelty/dialectic** → **P3/P4 world+adaptive** → **P0 packet** → gate.
- Packet / gateView surface: `worldModel`, `decisionDebt`, `revisitTriggers`, `preferredGateLevel`, `adaptiveBudget`.
- Tests: `frame.test.mjs` (7), `world-model.test.mjs` (5), `adaptive.test.mjs` (3).

### Discord scaffold (completes v16)
- **`core/connectors-discord.mjs`** — `DiscordAdapter` complet : verification Ed25519 (`X-Signature-Ed25519` + timestamp anti-rejeu 5 min), parse des interactions (PING, slash, boutons, modal), rendu embeds + boutons, modal de motif, `buildGateView` / `buildGateResultView`.
- **`core/connectors-discord-deep.mjs`** — `verifyDiscordSignature`, `discordInteractionId` (idempotence EF-92), `discordEmbedColor`.
- **`core/connectors.mjs`** — `ConnectorService._handleGate` honore `_motifConfirmed` (resolution reject/revise avec motif horodaté, EF-20).
- **Backend** — `POST /v1/connectors/discord/interactive` (PING pong, signature, route gate approve / modal motif / resolve) + `discordAdapter` branche sur env (`DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_WEBHOOK_URL`, `DISCORD_APPLICATION_ID`, `DISCORD_GATE_CHANNEL`).
- Tests: `connectors-discord.test.mjs` (23) — signature réelle, parse, rendu, flux gate via `ConnectorService`.

### Teams adapter (completes v17)
- **`core/connectors.mjs`** — `TeamsAdapter` complet : verification JWT RS256 Azure Bot (issuer `https://api.botframework.com`, audience = App ID, cache JWKS 6 h, fetch de secours via openid config), jeton OAuth2 bot (client_credentials, cache −60 s), envoi proactif (conversations/activities) + webhook, update d'activité, Task Module de motif (EF-20), `buildGateView` / `buildGateResultView`, `renderMotifCard`, `_activityPayload` (Adaptive Card).
- **Backend** — `POST /v1/connectors/teams/interactive` (JWT obligatoire → 401, idempotence `teamsActivityId`, invoke adaptiveCard → gate approve / Task Module motif / resolve) + `teamsAdapter` branché sur env (`TEAMS_APP_ID`, `TEAMS_BOT_PASSWORD`, `TEAMS_WEBHOOK_URL`, `TEAMS_GATE_CHANNEL`).
- Tests: `connectors-teams.test.mjs` (27) — signature RS256 (accept/tamper/exp/iss/aud), parse message/invoke, rendu Adaptive Card, post/update bot + webhook, flux gate via `ConnectorService`. Suite complète 273/273.

### v0.17–v0.18 — Engine/adapters split + CI
- **Teams adapter (v0.17)** — cf. section ci-dessus.
- **Engine/adapters split (v0.18)** — `core/` reste zero-dependency ; connecteurs/`core/adapters/` et `backend/adapters/` sont optionnels (LangChain, LangGraph, recherche, Langfuse) ; couches P0–P4 contrôlées gouvernance.
- **CI GitHub Actions** — workflow `backend-tests.yml` (npm ci + `npm test`) s'ajoute à `core-tests.yml` et `i18n-check.yml`.

### Persistent audit trail (EF-32)
- **`core/audit.mjs`** — `InMemoryAuditStore` + `FileAuditStore` (JSONL, append-only, hydratation au démarrage, ring buffer configurable). `createAuditStore` selon `KAYROS_AUDIT_FILE`.
- **`backend/fastify/lib/context.mjs`** — `ctx.journal` persiste chaque événement cycle/gate/commentaire/vote/timeline et réhydrate `ctx.activites` au démarrage (la timeline survive aux redémarrages). Expose `auditStore`.
- **`.env.sample`** — `KAYROS_AUDIT_FILE` / `KAYROS_AUDIT_RING`.
- Tests: `audit.test.mjs` (7) — InMemory where/list/ring, FileAuditStore reload/persist/best-effort/missing-file/ring. Suite core 290/290.

### Working Group + vote multi-criteres (EF-13 / EF-21)
- **`core/working-group.mjs`** — `WorkingGroupStore` + `FileWorkingGroupStore` (membres, quorum par défaut 50%, agrégation rôle-pivot via `ROLE_WEIGHTS`, statut `vide`/`en_attente`/`quorum_ok`, recommandation Go/Révision/No-Go/Attendre quorum).
- **`backend/fastify/routes/gates.mjs`** — `POST /v1/ideas/:id/working-group` (création WG), `POST /v1/gates/:gateId/votes` (vote membre, 403 non-membre, idempotence), `GET /v1/gates/:gateId/votes` (agregat + participations). La décision reste une resolution RBAC formelle ; le vote WG est consultatif et alimente l'évaluation du gate.
- **`lib/context.mjs`** — `workingGroups` (store, `KAYROS_WG_FILE` optionnel) exposé dans le contexte.
- Tests: `working-group.test.mjs` (10) + backend `gates.working-group.test.mjs` (5).
- **Audit WG** — chaque vote WG est journalisé (`wg.vote`) et `POST /v1/gates/:gateId/resolve` journalise `gate.resolved`; `GET /v1/gates/:gateId` expose l'agregat du groupe de travail (participants, quorum, recommandation).

---

## v0.16.x (2026-08) — Adapters & observability periphery

See prior history for adapters, KPI drift, novelty ranking.
