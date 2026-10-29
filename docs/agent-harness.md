# Harnais global des agents & conformité

Source : spécification « KayrosLab AI Impersonator Agent Harness & Compliance », appliquée à **tous** les agents.

- **Injection** : `core/agent-harness.mjs` (`HARNESS_SYSTEM_PROMPT`, marqueur `[KAYROS-HARNESS]`) est préfixé en message système par `KayrosLLM.complete` (`core/kayros-llm.mjs`). Tous les appels passent par là : agents de mission/essaim (`core/agents/*`), orchestrateur, voix des impersonators (`speakWithModel`), routes `/v1/llm` et salon. Fusion avec un système existant, idempotent. Opt-out explicite : `harness: false`.
- **Conformité** : chaque complétion reçoit `res.compliance = { version, compliant, checks, flags }` via `checkCompliance(text, { role })` :
  - `architectural_default` : défaut cloud SaaS/AWS/API centralisée sans primitive local-first/P2P ni signalement du lock-in → signalé.
  - `directness` : méta-introduction ou résumé générique en ouverture → signalé.
  - `output_type` : pas de code, schéma SQL/PostGIS ni contrat d'interface → signalé (non applicable aux répliques de persona).
- La notation est **non bloquante** (heuristique, pas de rejet ni de relance) ; `speakWithModel` remonte `compliance` dans l'aperçu voix.
- Fixture : `HARNESS_EXAMPLE_QUERY` (exemple de la spécification), tests dans `core/agent-harness.test.mjs`.
