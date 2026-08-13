# KayrosLab — Engine architecture (V19, workflow graph v2)

## Principle

**Core decides. Adapters observe, retrieve, and propose.**

| Layer | Path | Dependencies | Role |
|-------|------|--------------|------|
| **Core engine** | `core/` | **Zero npm deps** | Workflow graph, orchestrator, governance, L0–L3 memory, novelty, agents, ToolRegistry, **P0–P4 control layers** |
| **Backend** | `backend/fastify/` | Fastify, Zod, optional PG… | HTTP, auth, SSE cycle, resume routes, secrets |
| **Adapters** | `core/adapters/` + `backend/adapters/` | **Optional peers** | LangChain tools, LangGraph, search providers, Langfuse |

Adapters never replace gates, stage/status lifecycle, or the 8-step strategic cycle.

---

## 1. Workflow graph v2

Until v2 the engine was a hardened **linear step executor**, not a graph: the
compiler rejected every cycle, and per-node permissions were declared but never
enforced. v2 changes the contract on five points.

| # | Property | Module |
|---|----------|--------|
| **Bounded cycles** | Acyclicity is replaced by two invariants: every node must be able to reach the end, and every node inside a cycle must declare a finite attempt budget. Cycle detection uses an iterative Tarjan SCC pass. | `workflow-graph.mjs` |
| **Attempt budgets** | Nodes carry `maxAttempts`. Edge selection filters out targets whose budget is spent, so a persistently failing review falls through to escalation instead of spinning. | `workflow-graph.mjs` |
| **State channels** | `research` / `simulation` / `draft` / `review` are real channels with dedicated events and shape validation. Routing conditions read them. | `workflow-state.mjs` |
| **Enforced permissions** | Nodes declare `{ tools, writes }`. The orchestrator asserts before every tool call and every channel write. A wildcard allowlist never covers write-effect tools. | `workflow-permissions.mjs` |
| **Node / agent split** | `state.node` is the graph node id, `state.agent` the role. Attempts are keyed by node id, so two nodes sharing an agent keep independent budgets. | `workflow-state.mjs` |

Versions: `WORKFLOW_GRAPH_VERSION = 2`, `WORKFLOW_SCHEMA_VERSION = 2`.
v1 payloads are still accepted — `upgradeWorkflowGraph()` and
`migrateWorkflowState()` promote them with validated defaults, and a promoted
v1 graph must stay acyclic because v1 semantics never validated a revision loop.

### Node shape

```js
{
  id: 'writer',
  kind: 'agent' | 'tool',
  agent: 'Writer' | null,
  step: { id, agent?, tool?, toolInput?, description?, input? },
  maxAttempts: 3 | null,                        // null = unbounded, illegal in a cycle
  permissions: { tools: [] | '*', writes: ['draft'] },
  gate: { type: 'decision_arbitrage', requiredRole: 'comex' } | null,
}
```

---

## 2. Agent rosters

Two families on one paradigm-agnostic engine.

| Family | Agents | Produces |
|--------|--------|----------|
| **Dialectical** | Critic, DevilsAdvocate, RedTeam, Bisociateur, Synthesizer | A governed recommendation + decision packet |
| **Produce-then-verify** | Researcher, Simulator, Writer, Verifier, Logger | A verified report |
| Shared | Planner, HumanGate | — |

An agent that owns a state channel declares it (`agent.channel`) and returns it
as structured data next to its text, so routing reads typed state rather than
free text. Adversarial agents own no channel: they only produce text.

The **Verifier fails closed** — anything that is not an explicit `OK` is a `KO`,
and a missing draft is a `KO`. An unparseable verdict must never read as an
approval. **Logger and HumanGate are deterministic**: an audit trail and an
escalation must not depend on a model being reachable.

---

## 3. Preset graphs

`core/workflow-presets.mjs` — `DEFAULT_PRESET = 'unified'`.

### `unified` (default)

```text
[start] → planner → researcher
        → critic → devils-advocate → red-team → bisociateur
        → synthesizer → decision-gate            (human arbitrage)

decision-gate --Go------> simulator → writer → verifier
decision-gate --revise--> critic                 (bounded: the idea is
                                                  re-attacked, not reworded)
decision-gate --else----> escalate

verifier --OK--> logger → [end]
verifier --KO--> writer                          (bounded)
verifier --else-> escalate → [end]
```

Three properties worth stating:

- **Nothing is written before the arbitration.** A veto costs no production.
- **Both budgets are finite and land on the same human escalation.** A graph
  that cannot decide hands over rather than spins.
- **An unreadable verdict escalates too.** Fail closed: never produce on a
  decision nobody can interpret.

The revise budget is `reviseRounds + 1` — the initial pass plus the allowed
revisions.

### `reference` and `kayros`

The reduced graphs stay available for a short cycle or an MVP: `reference` is
the produce-then-verify pipeline alone, `kayros` the dialectical cycle alone.

---

## 4. Human gates and resumption

Gates belong to the **topology**, not to a branch hard-wired after the walk.

- A node carrying `gate` opens a governance gate **before** the node runs. A
  veto blocks the run and the node never executes.
- A tool flagged `gate: true` systematically opens a `tool_execution` gate.
  With no governance wired the action is refused — no governance, no risky
  action.

**Gates suspend, they do not block.** Awaiting a human decision inside the run
only works for a caller that holds the run open; an HTTP request or a scheduled
job would hang for ever. The default emits the gate and returns a resumable
`pending_review` carrying `gateId`, `gateType`, `nodeId` and `requiredRole`.
`waitNodeGate: true` opts into blocking, and is only safe when the caller owns
the run's lifetime.

```text
POST /v1/cycle/run { preset: 'unified' }   → 202 pending_review, run stored
GET  /v1/runs/suspended                    → list, tenant-scoped
GET  /v1/runs/:runId                       → detail (draft by size, not content)
POST /v1/runs/:runId/resume { decision }   → the run continues
```

`Orchestrator.resume(snapshot, { decision })` rehydrates the state, replays
nothing upstream, and re-enters the guarded node without reopening the gate that
was just approved — a waiver consumed **once**, so a revise loop returning to
the same node faces a fresh gate.

UI: `arbitrage.html` lists the suspended runs and poses Go / revise / veto on
every card. A reason is required for a veto or a revision.

**Condition resolvers are functions**: they live in
`Orchestrator.graphConditions`, server-side, and a resumed graph looks them up
by name. They never travel in a JSON snapshot nor come from an HTTP body.

---

## 5. Persistence and audit

| Concern | Module | Default |
|---------|--------|---------|
| Suspended runs | `run-store.mjs` — `InMemoryRunStore`, `FileRunStore`; `pg-store.mjs` — `PgRunStore` | Postgres when `DATABASE_URL` is set, otherwise `KAYROS_RUNS_FILE` or `./.kayros-runs.json`; `memory` forces the volatile store |
| Audit trail | `log-sink.mjs` — JSONL, one file per run, append-only | `logs/<runId>.jsonl` |

A file store assumes a single writer: it rewrites the whole file on every
change, so two instances behind a load balancer overwrite each other and a
human decision can disappear. `PgRunStore` is selected automatically as soon as
`DATABASE_URL` is present.

`applySchema(pool)` runs `core/sql/schema.sql` at startup. The VPS deploy
script did it too, but only there — an instance started anywhere else found an
empty database and failed on its first write. The schema is entirely
`create ... if not exists`, so replaying it costs one query. A failure is
reported, not fatal: the database may be DBA-managed or DDL rights refused.

The run store is keyed by `runId` and **scoped by tenant**: the store filters on
tenant itself, so a cross-tenant read is impossible by construction rather than
by a caller remembering to check. `FileRunStore` writes then renames, so a crash
mid-write cannot truncate the store, and a missing file is an empty store rather
than a boot failure.

The JSONL sink is streamed as the run produces it, so a crashed run still leaves
what it had time to emit. A failing sink degrades with `soft_error` and never
aborts the run.

---

## 6. Robustness contract

| Concern | Behaviour |
|---------|-----------|
| **Concurrency** | `_runInternal` works on a private per-run copy of the options. Neither the caller's object nor the Orchestrator instance holds run-scoped state, so two concurrent runs on a shared instance cannot corrupt each other. |
| **Silent failures** | An optional phase that fails emits a logged `soft_error` event carrying its phase. The two remaining non-generator sites surface their failure on the returned value (`plan.degraded`, `positionning.failures`). |
| **Timeout / cancel** | `opts.stepTimeoutMs` bounds every tool, agent and LLM call; `opts.signal` cancels cooperatively and emits a `cancelled` event. |
| **Cost** | Applying an event uses structural sharing: only the branches an event can mutate are copied, and the immutable graph is carried by reference. |
| **JSON safety** | A non JSON-safe run context is rejected rather than silently mangled by a JSON round trip. |
| **Routing determinism** | `walk()` refuses a conditional graph without a live state provider: the same graph must not route differently depending on the caller. |
| **State exposure** | Events carry a detached deep-frozen snapshot; the live canonical state stays private to the router. |

---

## 7. Role-scoped context

Spec section 6, *minimum required context*. `role-context.mjs` declares, per
role, which channels it may read, whether it gets the success criteria, and
whether it gets the memory block. This is a correctness contract, not an
optimization:

- a **Researcher** that sees the draft confirms it instead of researching;
- a **Verifier** that sees the memory block judges against recalled material
  instead of the declared criteria.

An unknown role fails closed: the shared context, no channel.

---

## 8. Governed intelligence layers (P0 → P4)

| Layer | Module | Role |
|-------|--------|------|
| **P0** | `epistemic.mjs` + `decision-packet.mjs` | Tag claims by grounding; compile a gateable packet; block confident wrongness |
| **P1** | `novelty-controller.mjs` + `dialectic.mjs` | Novelty as control loop (kill / quota / re-bisociate); attack–rebut tournament |
| **P2** | `frame.mjs` | Cheap frame assessment + heuristic/LLM reframes + optional `frame_review` gate before expensive cycles |
| **P3** | `world-model.mjs` | Actors / constraints / resources / assumption ledger; multi-resolution gates (light / standard / heavy) |
| **P4** | `adaptive.mjs` | Pressure-driven compute budget; residual-risk portfolio; decision debt + revisit triggers |

Hooks: `run-hooks-p1.mjs`, `run-hooks-p2.mjs`, `run-hooks-p3p4.mjs` — opt-in
from `Orchestrator.run`.

---

## 9. Core graph

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
  ─── Agents (Planner, Critic, RedTeam, Bisociateur, Synthesizer,
              Researcher, Simulator, Writer, Verifier, Logger, HumanGate)
  ─── Workflow graph v2 (compile → walk → gates → resume)
  ─── RunStore + JSONL sink
  ─── Orchestrator
        start → P2 frame → recall/position → graph walk
             → channel events → node gates (suspend)
             → P1 novelty/dialectic → P3/P4 world+adaptive
             → P0 packet → final gate
```

---

## 10. Packet surface (gate view)

The decision packet (and `renderPacketForGate`) carries:

- recommendation + epistemic status + assertion blockers
- frameAssessment / frame quality
- worldModel summary (stakes, timeHorizon, critical assumptions)
- residual risks + falsifiers
- decisionDebt + revisitTriggers
- preferredGateLevel + adaptiveBudget
