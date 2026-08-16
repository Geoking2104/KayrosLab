# `core/` — Cœur LLM gouverné KayrosLab

Moteur agentique (zéro dépendance, ESM, Node 20+) qui orchestre de vrais LLM
(Claude / Ollama) derrière une couche de gouvernance avec censeurs humains.
Ce n'est **pas** un modèle entraîné : c'est un orchestrateur gouverné.

## Modules

| Fichier | Rôle |
|---|---|
| `index.mjs` | `createEngine(opts)` — assemble providers, routage, mémoire, embeddings, gouvernance, orchestrateur. |
| `kayros-llm.mjs` | Abstraction `KayrosLLM` + adaptateurs ; `RoutingPolicy` quant-aware. |
| `orchestrator.mjs` | Plan-and-Solve + ReAct ; events `quant` ; `autoDistill` optionnel. |
| `memory.mjs` / `memory-types.mjs` | SharedMemory + **LayeredMemory L0–L3** + offload / persistence. |
| `quant-guidance.mjs` / `quant-schema.mjs` | Recommandations de quant GGUF + JSON Schema + validateurs. |
| `embeddings.mjs` | Ollama / Mock / Http embeddings + `MemoryService`. |
| `governance.mjs` | Gates, RBAC, veto, sensibilité. |
| `agents/` | Planner, Critic, RedTeam, Bisociateur, Synthesizer… (`preferredModel`). |
| `swarm.mjs` | Agents métiers dynamiques, règles superposées, consensus GO/NO-GO et arbitrage HITL. |
| `personality.mjs` | Profils humains consentis, agents hybrides, imports officiels LinkedIn/Crystal et provenance. |

## Démarrage rapide

```js
import { createEngine } from './index.mjs';

const eng = createEngine({
  sovereignty: 'local',
  model: 'llama3.1:8b-instruct',
  quant: 'q4_K_M',
  roleQuant: { Planner: 'q5_K_M', Critic: 'q5_K_M', Synthesizer: 'q5_K_M' },
  preferHigherQuant: false,
  // syncAvailableQuants: true,  // filtre via `ollama list`
  // memoryPath: './.kayros-memory.json',
  // offloadRoot: './.kayros-l0',
});

const plan = await eng.orchestrator.plan('Lancer une offre B2B', { ideaId: 'idea-1', sovereignty: 'local' });

for await (const ev of eng.orchestrator.run(plan, {
  governance: 'supervise',
  sovereignty: 'local',
  autoDistill: true,       // L1 → L2 en fin de cycle
  distillMinFacts: 3,
})) {
  if (ev.quant) console.log(ev.type, ev.quant);
  else console.log(ev.type);
}
```

## Mémoire stratifiée (L0–L3)

- **L0** working / offloadable (`rememberL0`, `offload`, `getWorkingCanvas`)
- **L1** atomic facts (`addAtomicFact`)
- **L2** scenarios (`distillScenario`, `autoDistillL2` ± LLM)
- **L3** core / persona / skills (`updateCore`)
- Persistence : `FileLayeredStore` via `memoryPath` ; L0 files via `offloadRoot`

## Quantization (local / Ollama)

| Option | Effet |
|---|---|
| `quant` | Quant global (ex. `q4_K_M`) |
| `roleQuant` | Override par rôle agent |
| `preferHigherQuant` | Biais vers Q5+ |
| `syncAvailableQuants` | Filtre avec les tags réellement installés |
| `availableModels` | Liste explicite de tags installés |

Voir aussi `OLLAMA.md` et `quant-schema.mjs`.

## Swarms d'agents spécialisés

`createEngine()` expose `engine.swarm`. Le service permet de créer des agents
utilisateur, de désactiver/remplacer/ajouter des règles, puis d'exécuter un
panel décisionnel. Chaque agent doit rendre `GO`, `NO_GO` ou
`CONDITIONAL_GO`; le consensus reste `pending_human_arbitration` jusqu'à une
décision humaine explicite.

```js
const config = eng.swarm.createConfiguration({
  swarm_name: 'Launch audit',
  active_agents: ['cfo', 'cto', 'legal_counsel'],
  voting_threshold: 'unanimous',
  agent_rule_overrides: {
    cfo: { disabled_rules: ['RULE_CFO_02'] },
  },
});

const run = await eng.swarm.run(config.swarm_id, {
  question: 'Should we launch?',
  context: 'Grounded project and market evidence…',
});
```

Le backend expose la même logique sous `/v1/swarm/*`; l'arbitrage final exige
une session authentifiée avec le rôle `comex`.

### Profils humains et agents hybrides

Un agent système enrichi par une personnalité devient `hybrid_modified` et
conserve son `base_agent_id`. Un agent utilisateur peut recevoir le même
profil. La simulation est activée au niveau de la configuration avec
`personality_simulation_enabled: true`.

```js
await eng.swarm.importAndAssignPersonality('cfo', {
  consent_confirmed: true,
  imports: [
    { source: 'linkedin', profile_data: linkedInAuthorizedExport },
    { source: 'crystalknows', profile_data: crystalAuthorizedExport },
  ],
}, { tenantId: 'acme', by: 'user-1' });
```

Les imports réseau utilisent uniquement les APIs officielles lorsque les
jetons serveur correspondants sont configurés. LinkedIn est limité au membre
authentifié ; aucun scraping de profil public n'est implémenté. Un export
structuré autorisé peut être fourni à défaut de connecteur.

## Tests

```bash
cd core && node --test
```

Inclut `memory-layered.test.mjs` et `quant-guidance.test.mjs`.

## Paliers

- **P0** — mock offline
- **P1** — `sovereignty: 'local'` → Ollama
- **P2** — `backendUrl` proxy (clés côté serveur)
