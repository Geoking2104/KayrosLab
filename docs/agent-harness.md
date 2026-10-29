# Harnais global des agents & conformité

Source : spécification « KayrosLab AI Impersonator Agent Harness & Compliance », appliquée à **tous** les agents.

- **Injection** : `core/agent-harness.mjs` (`HARNESS_SYSTEM_PROMPT`, marqueur `[KAYROS-HARNESS]`) est préfixé en message système par `KayrosLLM.complete` (`core/kayros-llm.mjs`). Tous les appels passent par là : agents de mission/essaim (`core/agents/*`), orchestrateur, voix des impersonators (`speakWithModel`), routes `/v1/llm` et salon. Fusion avec un système existant, idempotent. Opt-out explicite : `harness: false`.
- **Conformité** : chaque complétion reçoit `res.compliance = { version, compliant, checks, flags }` via `checkCompliance(text, { role })` :
  - `architectural_default` : défaut cloud SaaS/AWS/API centralisée sans primitive local-first/P2P ni signalement du lock-in → signalé.
  - `directness` : méta-introduction ou résumé générique en ouverture → signalé.
  - `output_type` : pas de code, schéma SQL/PostGIS ni contrat d'interface → signalé (non applicable aux répliques de persona).
## Application (blocage / relance)

Mode : `req.compliance` > env `KAYROS_HARNESS_MODE` > `enforce` (défaut). `flag` = notation seule (coupe-circuit d'exploitation), `off` (ou `harness: false`) = ni harnais ni notation.

En `enforce` : complétion non conforme → **1 relance** (`HARNESS_MAX_RETRIES`) avec la réponse fautive + une consigne corrective ciblée par critère → si toujours non conforme : **blocage**, `HarnessComplianceError` (`code: HARNESS_NONCOMPLIANT`, `compliance`, `attempts`, `result` pour audit). Aucune acceptation silencieuse. Une relance réussie porte `harness_retry`. Le repli simulé (`mock`) n'est pas soumis.

Périmètre d'`output_type` : non applicable aux personas, aux rôles utilitaires (traduction, salon, résumé, titre) et aux réponses < 280 caractères ; un JSON strict compte comme contrat explicite.

Voix persona — compromis : la consigne corrective impose de garder la même voix (DISC, longueur, « Simulation — », première personne). Seuls `directness` et `architectural_default` s'appliquent ; une réplique bloquée bascule sur le repli déterministe `speakAs` (`model_error`), donc la voix DISC n'est jamais remplacée par du texte « builder ». Coût : une relance double la latence (~+10 s sur gpt-oss-20b), et un D qui ouvre par « Bien sûr » peut être rejeté.

Agents de mission : un blocage remonte comme une erreur d'appel LLM (pas de repli fournisseur) ; en cas de faux positifs en production, passer `KAYROS_HARNESS_MODE=flag`.
- Fixture : `HARNESS_EXAMPLE_QUERY` (exemple de la spécification), tests dans `core/agent-harness.test.mjs`.
