# KayrosLab — Engine architecture (V16)

## Principle

**Core decides. Adapters observe, retrieve, and propose.**

| Layer | Path | Dependencies | Role |
|-------|------|--------------|------|
| **Core engine** | `core/` | **Zero npm deps** | Orchestrator, governance, L0–L3 memory, novelty, agents, ToolRegistry |
| **Backend** | `backend/fastify/` | Fastify, Zod, optional PG… | HTTP, auth, SSE cycle, secrets |
| **Adapters** | `core/adapters/` + `backend/adapters/` | **Optional peers** | LangChain tools, LangGraph, search providers, Langfuse |

Adapters never replace gates, stage/status lifecycle, or the 8-step strategic cycle.

## Core graph

```text
createEngine()
  ├── KayrosLLM + RoutingPolicy → Ollama | Mistral | Anthropic | Mock
  ├── ToolRegistry (demoTools + registered search/LC tools)
  ├── LayeredMemory L0–L3 (+ optional Qdrant)
  ├── Novelty + OllamaEmbeddings (LRU / keep_alive / batch)
  ├── Governance (gates, vote, veto)
  ├── QuantGuidance (role-tiered local models)
  ├── Specialist agents (Planner, Critic, Red Team, Bisociateur, …)
  └── Orchestrator (plan → run → distill → gate)
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
- Peer: `@langchain/langgraph`
- Output is **proposal only**; Orchestrator / human gate remains authoritative

### Search tools

Providers (auto order): **Tavily → Brave → Google CSE → DuckDuckGo**

| Tool | Purpose |
|------|---------|
| `search_web` / `search_docs` | Multi-provider web |
| `search_github` | Repos (token optional) |
| `search_arxiv` | Academic papers |
| `search_all` | Parallel fan-out |

Registered at boot via `registerSearchToolsFromEnv` in `backend/fastify/lib/context.mjs`.

### Langfuse

- No-op when `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` missing
- Wraps `llm.complete` (generation) and `tools.call` (span)
- Metadata: `ideaId`, `stage`, `tenantId`, `userId`, `gateId`, `provider`
- Peer: `langfuse` (self-host or cloud)

## Data ownership

| Concern | Source of truth |
|---------|-----------------|
| Idea stage / status | Kayros stores (file / Postgres) |
| Gates & resolutions | GovernanceService |
| Memory facts | LayeredMemory |
| LLM debug / cost / latency | Langfuse (optional) |
| External research drafts | LangGraph / tools (ephemeral unless written to L1) |

## Design rules

1. **No adapter imports inside critical governance paths** without soft-fail.
2. **`core/` must run `node --test` without optional peers installed.**
3. Prefer `register*` / `attach*` at process boot over invasive monkey-patches.
4. Write side-effects always declarable (`sideEffect` + `gate`) for COMEX visibility.
