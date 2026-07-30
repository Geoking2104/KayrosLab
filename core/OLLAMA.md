# Brancher le cœur KayrosLab sur Ollama (LLM local souverain)

Le cœur (`core/`) parle à Ollama via `OllamaProvider` / `createEngine({ sovereignty: 'local' })`.
Aucune donnée ne sort de la machine en mode local.

## 1. Prérequis

```bash
ollama pull llama3.2
# ou avec quant explicite si dispo dans la lib Ollama / GGUF importé :
# ollama pull llama3.1:8b-instruct-q4_K_M
ollama list
curl http://localhost:11434/api/tags
```

## 2. Quantization-aware engine

```js
import { createEngine } from './index.mjs';

const eng = createEngine({
  sovereignty: 'local',
  model: 'llama3.1:8b-instruct',
  quant: 'q4_K_M',                    // défaut recommandé
  roleQuant: {
    Planner: 'q5_K_M',
    Critic: 'q5_K_M',
    Synthesizer: 'q5_K_M',
  },
  syncAvailableQuants: true,          // adapte aux tags réellement listés
});

// eng.quantGuidance.global / .byRole / .resolvedDefaultModel
// eng.agents.Planner.preferredModel  → tag résolu
await eng.syncAvailableQuants;        // promesse de sync best-effort
```

### Recommandations 2026

| Situation | Quant |
|---|---|
| Défaut / chat | **Q4_K_M** |
| Raisonnement / code / agents critiques | **Q5_K_M** (ou Q6_K) |
| Qualité max, VRAM OK | Q8_0 |
| VRAM très contrainte | Q4_K_S / IQ4_XS |

Les agents à fort enjeu (Planner, Critic, Synthesizer, RedTeam) sont en tier **high** → préférence Q5+.

## 3. Démo CLI

```bash
node core/ollama-demo.mjs llama3.2
node core/planner-ollama-demo.mjs llama3.2 "Objectif test"
```

## 4. Navigateur

Mixed content + CORS : servir l'app en local et éventuellement :

```bash
OLLAMA_ORIGINS="http://localhost:8080" ollama serve
```

## 5. Events quant

`orchestrator.run` émet `quant` sur `start` / `trace` / `synthesis` / `final`.
Schémas : `core/quant-schema.mjs`.

## Rappel

- `sovereignty: 'local'` force Ollama.
- Fallback `mock` si Ollama échoue (circuit breaker).
- `autoDistill: true` sur `run()` déclenche la distillation L1→L2 en fin de cycle.
