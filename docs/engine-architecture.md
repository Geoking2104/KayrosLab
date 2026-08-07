# KayrosLab — Engine architecture (V18)

## Principle

**Core decides. Adapters observe, retrieve, and propose.**

| Layer | Path | Dependencies | Role |
|-------|------|--------------|------|
| **Core engine** | `core/` | **Zero npm deps** | Orchestrator, governance, L0–L3 memory, novelty, agents, ToolRegistry, **P0–P4 control layers** |
| **Backend** | `backend/fastify/` | Fastify, Zod, optional PG… | HTTP, auth, SSE cycle, secrets |
| **Adapters** | `core/adapters/` + `backend/adapters/` | **Optional peers** | LangChain tools, LangGraph, search providers, Langfuse |

Adapters never replace gates, stage/status lifecycle, or the 8-step strategic cycle.

## Governed intelligence layers (P0 → P4)

| Layer | Module | Role |
|-------|--------|------|
| **P0** | `epistemic.mjs` + `decision-packet.mjs` | Tag claims by grounding; compile a gateable packet; block confident wrongness |
| **P1** | `novelty-controller.mjs` + `dialectic.mjs` | Novelty as control loop (kill / quota / re-bisociate); attack–rebut tournament |
| **P2** | `frame.mjs` | Cheap frame assessment + heuristic/LLM reframes + optional `frame_review` gate before expensive cycles |
| **P3** | `world-model.mjs` | Actors / constraints / resources / assumption ledger; multi-resolution gates (light / standard / heavy) |
| **P4** | `adaptive.mjs` | Pressure-driven compute budget; residual-risk portfolio; decision debt + revisit triggers |

Hooks: `run-hooks-p1.mjs`, `run-hooks-p2.mjs`, `run-hooks-p3p4.mjs` — opt-in from `Orchestrator.run`.

## Core graph

```text
createEngine()
  ─── KayrosLLM + RoutingPolicy → Ollama | Mistral | Anthropic | Mock
  ─── ToolRegistry (demoTools + registered search/LC tools)
  ─── LayeredMemory L0–L3 (+ optional Qdrant)
  ─── Novelty + NoveltyController + OllamaEmbeddings
  ─── Frame controller (P2) → optional frame_review gate
  ─── World model + gate resolution (P3)
  ─── Adaptive pressure + residual portfolio (P4)
  ─── Epistemic + DecisionPacket (P0)
  ─── Dialectic tournament (P1)
  ─── Governance (gates, vote, veto — multi-resolution)
  ─── QuantGuidance (role-tiered local models)
  ─── Specialist agents (Planner, Critic, Red Team, Bisociateur, …)
  ─── Orchestrator
        start → P2 frame → recall/position → agents
             → P1 novelty/dialectic → P3/P4 world+adaptive
             → P0 packet → gate
```

## Packet surface (gate view)

The decision packet (and `renderPacketForGate`) now carries:

- recommendation + epistemic status + assertion blockers
- frameAssessment / frame quality
- worldModel summary (stakes, timeHorizon, critical assumptions)
- residual risks + falsifiers
- decisionDebt + revisitTriggers
- preferredGateLevel + adaptiveBudget
