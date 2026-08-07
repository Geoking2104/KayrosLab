# Changelog

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

---

## v0.16.x (2026-08) — Adapters & observability periphery

See prior history for adapters, KPI drift, novelty ranking.
