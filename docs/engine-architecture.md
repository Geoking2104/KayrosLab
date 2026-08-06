# KayrosLab — Engine architecture (V17)

## Principle

**Core decides. Adapters observe, retrieve, and propose.**

| Layer | Path | Dependencies | Role |
|-------|------|--------------|------|
| **Core engine** | `core/` | **Zero npm deps** | Orchestrator, governance, L0–L3 memory, novelty, agents, ToolRegistry, **P0–P2 control layers** |
| **Backend** | `backend/fastify/` | Fastify, Zod, optional PG… | HTTP, auth, SSE cycle, secrets |
| **Adapters** | `core/adapters/` + `backend/adapters/` | **Optional peers** | LangChain tools, LangGraph, search providers, Langfuse |

Adapters never replace gates, stage/status lifecycle, or the 8-step strategic cycle.

## Governed intelligence layers (P0 → P2)

| Layer | Module | Role |
|-------|--------|------|
| **P0** | `epistemic.mjs` + `decision-packet.mjs` | Tag claims by grounding; compile a gateable packet; block confident wrongness |
| **P1** | `novelty-controller.mjs` + `dialectic.mjs` | Novelty as control loop (kill / quota / re-bisociate); attack–rebut tournament |
| **P2** | `frame.mjs` | Cheap frame assessment + heuristic/LLM reframes + optional `frame_review` gate before expensive cycles |

Hooks: `run-hooks-p1.mjs`, `run-hooks-p2.mjs` — opt-in from `Orchestrator.run`.

## Core graph

```text
createEngine()
  ├── KayrosLLM + RoutingPolicy → Ollama | Mistral | Anthropic | Mock
  ├── ToolRegistry (demoTools + registered search/LC tools)
  ├── LayeredMemory L0–L3 (+ optional Qdrant)
  ├── Novelty + NoveltyController + OllamaEmbeddings
  ├── Frame controller (P2) → optional frame_review gate
  ├── Epistemic + DecisionPacket (P0)
  ├── Dialectic tournament (P1)
  ├── Governance (gates, vote, veto)
  ├── QuantGuidance (role-tiered local models)
  ├── Specialist agents (Planner, Critic, Red Team, Bisociateur, …)
  └── Orchestrator (frame → plan → run → novelty/dialectic → packet → gate)
```

## Adapter graph

```text
backend/adapters/
  ├── langchain-tools.mjs   → ToolDef on ToolRegistry
  ├── langgraph-runner.mjs  → research subgraph → { summary, signals }
  ├── search-tools.mjs      → search_web | github | arxiv | search_all
  └── langfuse.mjs          → spans on llm.complete + tools.call

core/adapters/              # same logic, importable without Fastify
```

### LangChain tools

- `toKayrosTool` / `registerLangChainTools`
- Write tools → `sideEffect: 'write'` + `gate: true` by default
- Peer: `@langchain/core`

### LangGraph

- `createResearchGraph` → gather → synthesize (or mock if package absent)
- `runLangGraphStep` maps state → Kayros step payload
