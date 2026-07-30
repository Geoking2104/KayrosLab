# Brancher le cœur KayrosLab sur Ollama (LLM local souverain)

Le cœur (`core/`) parle à Ollama via `OllamaProvider` / `createEngine({ sovereignty: 'local' })`.
Aucune donnée ne sort de la machine en mode local.

## 1. Prérequis

```bash
ollama pull llama3.2
# ou avec quant explicite si dispo :
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
  quant: 'q4_K_M',
  roleQuant: {
    Planner: 'q5_K_M',
    Critic: 'q5_K_M',
    Synthesizer: 'q5_K_M',
  },
  syncAvailableQuants: true,
});

await eng.syncAvailableQuants; // rebind agents preferredModel
// eng.rebindFromAvailable(tags) — manuel
```

### Soft fallback (quant)

1. Appel avec tag quant (`…-q5_K_M`)
2. Si échec Ollama → **retry sans suffixe quant** (`stripQuantFromTag`)
3. Si échec → **provider fallback** (`mock`) avec `response.degraded`

```js
// degraded shape
{ reason: 'quant_tag_unavailable' | 'provider_fallback', from, to, ... }
```

### Recommandations 2026

| Situation | Quant |
|---|---|
| Défaut / chat | **Q4_K_M** |
| Agents critiques | **Q5_K_M** (ou Q6_K) |
| Qualité max | Q8_0 |
| VRAM faible | Q4_K_S / IQ4_XS |

## 3. Démo CLI

```bash
node core/quant-ollama-demo.mjs llama3.2 "Objectif test"
node core/ollama-demo.mjs llama3.2
node core/planner-ollama-demo.mjs llama3.2 "Objectif test"
```

## 4. UI helpers

```js
import { quantTimelineHtml, mermaidCanvasHtml, quantControlsHtml } from './quant-ui.mjs';
// ou ouvrir core/quant-panel-demo.html via un serveur local
```

## 5. Events quant

`orchestrator.run` émet `quant` sur `start` / `trace` / `synthesis` / `final`.
Schémas : `core/quant-schema.mjs`.

## Rappel

- `sovereignty: 'local'` force Ollama.
- Fallback `mock` si Ollama échoue (circuit breaker + soft quant strip).
- `autoDistill: true` sur `run()` déclenche la distillation L1→L2 en fin de cycle.
