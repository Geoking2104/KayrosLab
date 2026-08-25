# KayrosLab

[![Website](https://img.shields.io/badge/Website-kayroslab.com-0ea5e9?style=flat-square)](https://www.kayroslab.com)
[![Live demo](https://img.shields.io/badge/Demo-Live_app-2563eb?style=flat-square)](https://www.kayroslab.com/kayroslab-complete-with-ai-agents.html)
[![Pages](https://img.shields.io/badge/GitHub_Pages-Site-7c3aed?style=flat-square)](https://geoking2104.github.io/KayrosLab/)
[![Deploy Pages](https://github.com/Geoking2104/KayrosLab/actions/workflows/deploy-positionning-pages.yml/badge.svg)](https://github.com/Geoking2104/KayrosLab/actions/workflows/deploy-positionning-pages.yml)
[![Core tests](https://github.com/Geoking2104/KayrosLab/actions/workflows/core-tests.yml/badge.svg)](https://github.com/Geoking2104/KayrosLab/actions/workflows/core-tests.yml)
[![License](https://img.shields.io/badge/License-Proprietary-slategray?style=flat-square)](#license)

**From weak signal to strategic decision — governed.**

KayrosLab is a **governed strategic ideation workshop**: multi-agent orchestration (Plan-and-Solve + ReAct), layered memory **L0–L3**, deterministic scoring, embedding-based novelty ranking, and Human-in-the-Loop gates with veto rights.

It is **not** a trained model. It is a **governed LLM stack** — an orchestrator that drives real models (Ollama quant-aware locally, or Claude / Mistral via the Fastify backend) behind governance, memory, and audit trails.

![KayrosLab Hybrid Agent Sales Oracle — governed simulation of an executive committee and buyer veto network](backend/web/public/assets/hybrid-agent-sales-oracle.png)

> **Hybrid agents turn KayrosLab into a Sales Oracle:** rehearse an internal executive decision, pressure-test an RFP against the customer’s buying committee, and strengthen the evidence before the real meeting. Simulated stakeholder feedback is always labelled as simulation — never as a real statement or prediction.

---

## Table of contents

1. [Why KayrosLab](#why-kayroslab)
2. [Features](#features)
3. [Complete agent operations](#complete-agent-operations)
4. [Hybrid Agent Sales Oracle](#hybrid-agent-sales-oracle)
5. [Quick start](#quick-start)
6. [Repository layout](#repository-layout)
7. [How it works](#how-it-works)
8. [Core engine](#core-engine)
9. [Backend API](#backend-api)
10. [UI entry points](#ui-entry-points)
11. [Configuration](#configuration)
12. [Deployment](#deployment)
13. [Development & tests](#development--tests)
14. [Roadmap](#roadmap)
15. [Further documentation](#further-documentation)
16. [Contact](#contact)
17. [License](#license)

---

## Why KayrosLab

| Criterion | Chat LLM | Innovation platform | **KayrosLab** |
|---|---|---|---|
| Structure | Conversation | Stage-gate | **Governed 8-step cycle** |
| Agents | One model | — | **Multi-agent** + Red Team + Bisociator |
| Memory | Session / flat | Tickets | **Layered L0–L3 + tenant scope** |
| Novelty | Implicit | Manual | **Embedding-ranked collisions + Kayros Signature** |
| Numbers | LLM guesses | Manual | **Deterministic** Monte-Carlo |
| Decision | Informal | Vote | **Vote instructs · veto decides** |
| Sovereignty | Cloud | Cloud | **Ollama quant-aware** or proxy |

---

## Features

- **8-step strategic cycle** — Intake → Listen → Map → Build → Position → Challenge → Decide → Project → Execute, with KPI feedback into Listen
- **SSE live cycle** — `POST /v1/cycle/run` streams plan/run events to `cycle-timeline.html`
- **Layered memory L0–L3** — working offload, atomic facts (incl. competitor from Positioner), distilled scenarios, scoped persona/norms
- **Governance** — gates, weighted votes, approve / reject / revise → idea stage & status
- **Novelty engine** — embedding-based scoring of Bisociator collisions (intra-batch diversity + memory distance + input distance), ranked output, soft near-duplicate filter
- **Kayros Signature** — each candidate carries a non-obvious conceptual bridge that makes the option unique (surfaced in the public demo)
- **Positioner** — web / GitHub / GitLab / ArXiv, ontology graph, OWL export, L1 competitor injection
- **Quant-aware local LLM** — role-tiered Ollama tags + soft fallback (strip quant → mock)
- **Specialized swarms** — compose built-in system agents, user-defined experts, or modified hybrid agents with layered rules and veto powers
- **Consent-aware personality simulation** — optional LinkedIn self-profile / Crystal Knows imports through official APIs or authorized structured exports, with provenance and explicit consent
- **Sales Oracle** — simulate internal executive decisions or customer buying committees to reveal veto paths, objections, evidence gaps and conditional-GO requirements before a proposal is sent
- **Developer Portal MCP** — connect Codex, Claude Code, Cursor or VS Code to a tenant-scoped, least-privilege agentic API catalog with governed swarm execution
- **Multi-tenant stores** — JSON files or Postgres (`DATABASE_URL`) for ideas, gates & **account links**
- **Chat connectors** — Slack (signature, idempotence, Block Kit gates, **motif modal**, **chat.update**); **Teams (JWT RS256 Azure Bot, Adaptive Cards, gate/EF-20, envoi proactif + webhook)**; Discord (Ed25519, embeds)
- **Portfolio UX** — kanban board, dormant ideas + reactivate, ontology Cytoscape explorer + embed panel
- **TimesFM 2.5 forecasting** — optional, isolated KPI forecasts with P10–P90 uncertainty, tenant-scoped persistence and mandatory `SIMULATION` labelling; deterministic projections remain the baseline
- **Optional adapters (V16)** — LangChain tools bridge, LangGraph research runner, multi-provider search tools, Langfuse observability (all peripheral; `core/` stays zero-dep)

---

## Complete agent operations

KayrosLab does not hand one prompt to one model. It turns a decision into a governed operation: evidence is collected, agents receive bounded roles, tools add verifiable facts or calculations, opposing views are reconciled, and a human approves the result before action.

```mermaid
flowchart TB
  REQUEST[Business question or weak signal] --> INTAKE[Structured intake and permissions]
  INTAKE --> PLAN[Orchestrator builds the plan]
  PLAN --> CONTEXT[Recall tenant-scoped memory L0–L3]
  CONTEXT --> SWARM[Run specialist agents on shared evidence]

  SWARM --> RESEARCH[Positioner and search tools]
  SWARM --> IDEAS[Planner, Bisociator and domain experts]
  SWARM --> ORACLE[Sales Oracle stakeholder rehearsal]
  SWARM --> NUMBERS[Deterministic simulation]
  SWARM --> FORECAST[Optional TimesFM KPI forecast]

  RESEARCH --> SYNTHESIS[Evidence-backed synthesis]
  IDEAS --> SYNTHESIS
  ORACLE --> SYNTHESIS
  NUMBERS --> SYNTHESIS
  FORECAST --> SYNTHESIS

  SYNTHESIS --> CHALLENGE[Critic, Devil's Advocate and Red Team]
  CHALLENGE --> GATE{Human gate}
  GATE -->|Revise| PLAN
  GATE -->|Reject| ARCHIVE[Record the decision and rationale]
  GATE -->|Approve| EXECUTE[Roadmap, execution and connectors]
  EXECUTE --> MEASURE[Observed KPIs and impact]
  MEASURE --> MEMORY[Audit trail and memory update]
  MEMORY -->|Drift or new signal| INTAKE
```

| Operation | What the agents do | Control that remains human | Durable output |
|---|---|---|---|
| **Frame** | Convert the request into objectives, constraints, roles and a runnable plan | Confirm scope, permissions and sensitive actions | Intake record + execution plan |
| **Ground** | Recall authorized memory and gather external or uploaded evidence | Approve sources and profile use | Cited, tenant-scoped corpus |
| **Explore** | Generate options, map competitors and rank novel combinations | Select or reject candidate directions | Scenarios + positioning graph |
| **Rehearse** | Sales Oracle agents expose objections, veto paths and missing proof | Judge whether simulated feedback is useful | Objection matrix + evidence plan |
| **Quantify** | Run deterministic trajectories; optionally forecast observed KPI series with TimesFM | Choose assumptions and review high uncertainty | Scenarios + `SIMULATION` forecast bands |
| **Challenge** | Critic and Red Team attack claims, feasibility and risk | Resolve disagreements and vetoes | Attack report + decision packet |
| **Decide** | Aggregate votes and conditions without overriding governance | Approve, reject or request revision | Signed gate decision + rationale |
| **Execute and learn** | Build the roadmap, monitor KPIs and surface drift | Own delivery and re-arbitration | Milestones, impact readings and audit log |

TimesFM is deliberately one tool inside this loop. It forecasts statistically plausible KPI trajectories from at least 20 ordered observations; it does not replace deterministic business scenarios, agent judgment or the human gate.

---

## Hybrid Agent Sales Oracle

A hybrid agent combines a governed business role with an authorized stakeholder profile. The role supplies explicit decision rules; the profile can supply consented communication preferences, DISC traits, decision triggers and objection patterns. Personality simulation is opt-in per swarm and never changes the requirement for human arbitration.

### Rehearse an executive decision

1. Upload the proposal, business case, metrics and constraints; every extracted claim keeps its source.
2. Compose a panel from built-in CFO, CTO, Legal, Risk and Operations agents, custom experts, or consented hybrids.
3. Run the cited corpus through `GO`, `CONDITIONAL_GO`, `NO_GO` and veto rules.
4. Review the friction map, requested evidence and simulated stakeholder reactions before the accountable executive decides.

### Pressure-test a customer RFP

1. Upload the RFP, response, pricing, security, contractual and delivery evidence into one controlled corpus.
2. Map the buying committee: sponsor, procurement, finance, security, legal, operations and technical evaluators.
3. Red-team the cited offer against each veto holder’s explicit role rules and authorized decision triggers.
4. Generate an objection matrix, conditional-GO checklist, evidence plan, negotiation brief and executive narrative.

```mermaid
flowchart LR
  DOCS[Proposal, RFP, business case and constraints] --> EVIDENCE[Cited, tenant-scoped evidence corpus]
  EVIDENCE --> ORACLE[Hybrid Agent Sales Oracle]
  ORACLE --> COMEX[Internal executive committee]
  ORACLE --> BUYERS[Customer buying committee]
  COMEX --> VETO1{GO / conditions / veto}
  BUYERS --> VETO2{Sponsor / Finance / Security / Legal / Procurement}
  VETO1 --> PACK[Governed decision dossier]
  VETO2 --> PACK
  PACK --> HUMAN[Human arbitration and stronger proposal]
```

**Safeguards:** official connectors or authorized exports only; no LinkedIn scraping; explicit consent and provenance; tenant isolation; no private-fact fabrication; simulated feedback is labelled and cannot be presented as a real quote, endorsement or behavioral prediction.

### Integrated web tool

The [Hybrid Agent Sales Oracle workspace](https://www.kayroslab.com/#sales-oracle) is embedded directly in the public site for provisioned customers:

1. Connect with an authorized KayrosLab account. The bearer token stays in browser memory only; it is never persisted to `localStorage`, cookies or the repository.
2. Select an existing tenant-scoped case or create an RFP, executive-decision, renewal or negotiation case.
3. Select PDF, DOCX, TXT, Markdown or CSV evidence. The browser computes SHA-256 locally, requests a short-lived signed URL, uploads directly to object storage, then asks the API to verify and queue ingestion.
4. Follow the active corpus and document states without exposing another tenant's cases.

The browser client is implemented in [`backend/web/public/assets/sales-oracle-tool.js`](backend/web/public/assets/sales-oracle-tool.js); API metadata and upload lifecycle remain in [`backend/fastify/routes/sales-oracle.mjs`](backend/fastify/routes/sales-oracle.mjs).

Direct browser uploads require the private S3-compatible bucket to allow `PUT` requests from the production origin. Example CORS policy:

```json
[
  {
    "AllowedOrigins": ["https://www.kayroslab.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["content-type", "x-amz-checksum-sha256", "x-amz-meta-sha256"],
    "ExposeHeaders": ["etag", "x-amz-checksum-sha256"],
    "MaxAgeSeconds": 3600
  }
]
```

Configure the server-only `KAYROS_S3_*` variables from [`backend/fastify/.env.sample`](backend/fastify/.env.sample). The real `.env` remains ignored by Git.

See [docs/specialized-agent-swarms.md](docs/specialized-agent-swarms.md) for schemas, endpoints and examples.

---

## Quick start

### Prerequisites

- **Node.js 20+**
- Optional: [Ollama](https://ollama.com) for local inference (and embeddings)
- Optional: Postgres if you set `DATABASE_URL`

### 1. Core engine (no install)

```bash
cd core
node --test
node quant-ollama-demo.mjs llama3.2   # optional, needs Ollama
```

```js
import { createEngine } from './core/index.mjs';

const eng = createEngine({
  sovereignty: 'local',
  model: 'llama3.1:8b-instruct',
  quant: 'q4_K_M',
  syncAvailableQuants: true,
});

const plan = await eng.orchestrator.plan('Launch a B2B offer', { ideaId: 'idea-1' });
for await (const ev of eng.orchestrator.run(plan, {
  governance: 'auto',
  positionning: true,
  autoDistill: true,
  waitGate: false,
})) {
  console.log(ev.type, ev.idea ?? '');
}
```

### 2. Backend API

```bash
cd backend/fastify
cp .env.sample .env          # edit secrets as needed
npm install
node index.mjs               # http://localhost:8787
```

Open the live cycle UI:

```text
cycle-timeline.html?api=http://localhost:8787
```

### 3. Public governed-agent demo

Open the live page (no backend required for the client-side exploration loop):

- Production: [kayroslab.com/kayroslab-complete-with-ai-agents.html](https://www.kayroslab.com/kayroslab-complete-with-ai-agents.html)
- GitHub Pages: [geoking2104.github.io/KayrosLab/…](https://geoking2104.github.io/KayrosLab/kayroslab-complete-with-ai-agents.html)

Features of the demo:
- Interactive swarm composer for system, custom and hybrid agents
- Consent-aware LinkedIn / Crystal Knows profile-link workflow
- Semantic map (InfraNodus-inspired) before ideation
- Bisociation-style exploration with **novelty ranking**
- **Kayros Signature** on each candidate
- Full 8-agent governed cycle with human gates
- PDF / Markdown export + lead capture

### 4. Demo seed (optional)

```bash
node core/seed-demo.mjs
# or with Postgres:
DATABASE_URL=postgres://user:pass@localhost:5432/kayroslab node core/seed-demo.mjs
```

---

## Repository layout

```text
KayrosLab/
├── core/                 # Zero-dep engine (ESM) — memory, orchestrator, governance, positionning, novelty
│   ├── novelty.mjs       # Embedding-based novelty scoring
│   ├── embed-select.mjs  # Soft-fallback embedding model selection
│   ├── kpi-drift.mjs     # KPI trend / drift detection
│   ├── adapters/         # Portable optional tool contracts
│   │   ├── timesfm-forecast.mjs
│   │   ├── langchain-tools.mjs
│   │   ├── langgraph-runner.mjs
│   │   ├── search-tools.mjs
│   │   └── langfuse.mjs
│   └── agents/           # Specialist agents (incl. Bisociateur)
├── backend/
│   ├── fastify/          # HTTP API, auth, SSE cycle, connectors
│   ├── adapters/         # Runtime adapters, including the TimesFM client/cache
│   └── timesfm-service/  # Isolated Python/PyTorch inference service
├── frontend/             # React Positioner app
├── deploy/ovh-vps/       # Deploy, backup, cron helpers
├── docs/                 # Pitch, architecture notes, v13/v14
├── workers/              # Edge / proxy workers
├── cycle-timeline.html   # Live SSE cycle UI
├── portfolio-board.html  # Portfolio kanban
├── ontology-explorer.html
├── ontology-panel.html   # Embeddable ontology sample (Cytoscape)
├── kayroslab-complete-with-ai-agents.html   # Public governed-agent demo (novelty + Signature)
└── index.html            # Commercial site
```

---

## How it works

### Strategic cycle

```mermaid
flowchart LR
  subgraph CYCLE["KayrosLab strategic cycle"]
    direction LR
    A[Listen] --> B[Map]
    B --> C[Build]
    C --> D[Position]
    D --> E[Challenge]
    E --> F[Decide]
    F --> G[Project]
    G --> H[Execute]
  end
  H -.->|KPIs · alerts · re-arbitration| A

  classDef step fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  class A,B,C,D,E,F,G,H step
```

| # | Step | Domain code | Role | Output |
|---|---|---|---|---|
| 00 | **Intake** | `recueillir` | Structured intake canvas | Comparable idea |
| 01 | **Listen** | `ecouter` | Noise reduction, scoring, clustering | Qualified signals |
| 02 | **Map** | `cartographier` | Trend network, bisociation bridges | Graph + bridges |
| 03 | **Build** | `construire` | Scenarios, Collision Mode, brief | Scenarios + hypotheses |
| 04 | **Position** | Positioner | Web + GitHub/GitLab, ontology, gaps → **L1 facts** | Graph + OWL + L1 |
| 05 | **Challenge** | `eprouver` | Critic + Devil's Advocate + **Red Team** | Attack report |
| 06 | **Decide** | `arbitrer` | Weighted vote, human gate, veto | Go / No-Go / Revision |
| 07 | **Project** | `projeter` | Roadmap, resources, foresight | Trajectory + feedback loop |
| 08 | **Execute** | `realiser` | Pilot → Deploy → Review | Milestones + measured impact |

**Two orthogonal axes:** *stage* = execution progress; *status* = decision state. Dormant statuses (`en_pause`, `consideration_future`, `non_poursuivi`) are **reactivable** via `POST /v1/cycle/reactivate`.

### Novelty & Bisociation

The Bisociateur agent generates structured collisions (Framework + Mechanism + Proposal + Bridge).  
When embeddings are available, collisions are scored and ranked:

- **Intra-batch diversity** — distance to other candidates in the same round
- **Memory distance** — distance to L1/L2 stored knowledge
- **Input distance** — distance to the original idea / constraints

Preferred embedding model order (soft fallback):

`qwen3-embedding:0.6b` → `bge-m3` → `mxbai-embed-large` → `nomic-embed-text` → Mock

Override with `KAYROS_EMBED_MODEL`.  
See `core/novelty.mjs` and `core/embed-select.mjs`.

### Live cycle (SSE)

```mermaid
sequenceDiagram
  participant UI as cycle-timeline.html
  participant API as Fastify /v1/cycle/run
  participant ORCH as Orchestrator
  participant MEM as LayeredMemory
  participant GOV as Governance

  UI->>API: POST query + governance
  API->>ORCH: plan() then run()
  ORCH-->>UI: meta · start
  ORCH->>MEM: recall L1–L3
  ORCH-->>UI: recall
  ORCH->>MEM: positioning → L1 competitor facts
  ORCH-->>UI: positionning
  loop agents
    ORCH-->>UI: trace (+ idea.stage)
  end
  ORCH->>MEM: autoDistill L2
  ORCH-->>UI: distill · synthesis
  alt sensitive + supervise
    ORCH->>GOV: open gate
    ORCH-->>UI: gate · final pending_review
    UI->>API: POST /v1/gates/:id/resolve
    API->>GOV: resolve approve|reject|revise
  else auto
    ORCH-->>UI: final auto
  end
  ORCH-->>UI: done
```

**Event stream:** `meta → start → recall → positionning → trace×N → offload? → distill? → synthesis → gate? → final → done`

### Engine architecture

KayrosLab separates a **zero-dependency decision core** from **optional periphery adapters**. Adapters may call into the core (`ToolRegistry`, memory, LLM); they never replace governance, gates, or the strategic cycle.

```mermaid
flowchart TB
  USER([User / Campaign / API / Demo]) --> API[Fastify backend]
  API --> ENG[createEngine]
  ENG --> ORCH[Orchestrator]
  ENG --> AGENTS[Specialist agents]
  ENG --> MEM[LayeredMemory L0–L3]
  ENG --> LLM[KayrosLLM + RoutingPolicy]
  ENG --> GOV[Governance]
  ENG --> QG[QuantGuidance]
  ENG --> NOV[Novelty / Embeddings]
  ENG --> TOOLS[ToolRegistry]

  ORCH -->|Plan-and-Solve| AGENTS
  ORCH -->|recall / distill / positionning| MEM
  AGENTS -->|complete| LLM
  AGENTS -->|score collisions| NOV
  AGENTS -->|tools.call| TOOLS
  ORCH -->|sensitive output| GOV
  QG -.->|preferredModel| AGENTS

  LLM --> P1[(Ollama)]
  LLM --> P2[(Mistral / Anthropic proxy)]
  LLM --> P3[(Mock)]

  subgraph PERIPH["Optional adapters (backend/adapters · core/adapters)"]
    LC[LangChain tools bridge]
    LG[LangGraph research runner]
    SRCH[Search tools multi-provider]
    LF[Langfuse observer]
  end

  LC -->|register ToolDef| TOOLS
  SRCH -->|search_web / github / arxiv| TOOLS
  LG -->|gather → synthesize| TOOLS
  LG -.->|step output| ORCH
  LF -.->|spans llm + tools| LLM
  LF -.->|spans| TOOLS
```

| Layer | Responsibility | Replaceable? |
|---|---|---|
| **Core** (`createEngine`, orchestrator, governance, L0–L3, novelty) | Decision, audit, sovereignty path | No |
| **ToolRegistry** | Declarative tools + gates for write side-effects | Extended only |
| **Adapters** | LangChain tools, LangGraph subgraphs, web search, Langfuse traces | Yes — optional peers |

See [docs/engine-architecture.md](docs/engine-architecture.md) and [backend/adapters/README.md](backend/adapters/README.md).

### Memory layers

| Layer | Purpose | Persistence |
|---|---|---|
| **L0** | Working context, offload, Mermaid canvas | Optional `offloadRoot` |
| **L1** | Atomic facts (+ **competitor** from Positioner) | JSON + vectors |
| **L2** | Scenarios (`autoDistill`) | JSON + vectors |
| **L3** | Persona, norms, skills (tenant / user scope) | JSON |

Promotion path: L0 → L1 → distill L2 → `POST /v1/memory/promote` → L3.

### Gate → idea

```mermaid
flowchart LR
  SENS[Sensitive synthesis] --> OPEN[governance.open]
  OPEN --> PEND[status: en_revue]
  PEND --> RES{resolve}
  RES -->|approve| GO[en_developpement · projeter]
  RES -->|reject| NG[non_poursuivi]
  RES -->|revise| REV[en_revue · eprouver]
```

`POST /v1/gates/:gateId/resolve` with `{ decision, reason }` runs `applyGateResolution` and returns `{ resolution, idea }`.

### Quant-aware Ollama

Request → tagged model → Ollama. On failure: strip quant suffix and retry → mock fallback (response marked `degraded`).  
Details: [core/OLLAMA.md](core/OLLAMA.md) · [core/README.md](core/README.md).

---

## Core engine

Path: [`core/`](core/) — ESM, Node 20+, **no npm dependencies** for the engine itself.

| Module | Role |
|---|---|
| `index.mjs` | `createEngine` — providers, memory, quant, orchestrator, novelty injection |
| `orchestrator.mjs` | plan / run / project — recall, positioning→L1, distill, gates |
| `cycle-lifecycle.mjs` | Agent→stage, `applyGateResolution`, reactivate |
| `memory.mjs` · `memory-scope.mjs` · `memory-rank.mjs` | L0–L3, tenant hierarchy, ranking |
| `novelty.mjs` | Embedding-based novelty scoring & ranking of collisions |
| `embed-select.mjs` | Soft-fallback embedding model selection |
| `kpi-drift.mjs` | KPI time-series drift detection |
| `adapters/timesfm-forecast.mjs` | Zero-dependency TimesFM contract, validation and uncertainty policy |
| `adapters/*` | Optional: TimesFM, LangChain tools, LangGraph runner, search tools, Langfuse (peers; no core deps) |
| `positionning/` | Scanners, ontology, OWL, `to-l1`, graph builder |
| `agents/` | Specialist agents (Planner, Critic, Red Team, **Bisociateur**, …) |
| `connectors.mjs` | Slack / Teams adapters, account link, gate views |
| `account-link-store.mjs` · `account-link-service.mjs` | Durable Slack/Teams ↔ Kayros links |
| `connectors-motif.mjs` | Motif modal + post-resolve `chat.update` |
| `pg-store.mjs` | Optional multi-instance Postgres |
| `seed-demo.mjs` | Demo idea seed |
| `quant-guidance.mjs` | Role tiers, soft fallback |
| `governance.mjs` | Gates, RBAC, veto |
| `model.mjs` | Idea stage × status |

See **[core/README.md](core/README.md)** for API-level docs.

---

## Backend API

### Optional TimesFM KPI forecasts

When an idea has at least 20 ordered observations for one KPI, the authenticated
API can request a TimesFM 2.5 trajectory without adding Python dependencies to
`core/`:

```bash
curl -X POST https://api.kayroslab.com/v1/ideas/IDEA_ID/forecast \
  -H "Authorization: Bearer $KAYROS_JWT" \
  -H "Content-Type: application/json" \
  -d '{"kpi":"adoption","horizon":12}'
```

The response includes point forecasts, P10–P90 quantiles, an uncertainty ratio,
model provenance and a human-review flag. It is always a simulation. See
[`docs/TIMESFM_FORECASTING.md`](docs/TIMESFM_FORECASTING.md) for architecture,
deployment and limitations.

Path: [`backend/fastify/`](backend/fastify/) — reuses `core/`.

| Domain | Endpoints |
|---|---|
| **Cycle SSE** | `POST /v1/cycle/run` · `POST /v1/cycle/reactivate` · `GET /v1/cycle/status` |
| **Memory** | `GET\|POST /v1/memory/l3` · `GET /v1/memory/ideas/:id` · `POST /v1/memory/promote` · `POST /v1/memory/save` |
| **Positioning** | analyze, search, GitHub, ArXiv, OWL, `GET /v1/positionning/ontology` |
| **Governance** | `POST /v1/ideas/:id/gates` · `GET /v1/gates` · `POST /v1/gates/:id/resolve` |
| **Specialized swarms** | `GET\|POST /v1/swarm/agents` · `POST /v1/swarm/configurations` · `POST /v1/swarm/run` · `POST /v1/swarm/runs/:id/arbitrate` |
| **Hybrid profiles** | `POST /v1/swarm/agents/:agentId/personality/import` |
| **Sales Oracle documents** | `POST\|GET /v1/sales-oracle/cases` · `POST /v1/sales-oracle/cases/:id/documents/uploads` · `POST /v1/sales-oracle/cases/:id/documents/:documentId/complete` · document list/status |
| **TimesFM forecasts** | `GET /v1/forecast/status` · `POST /v1/ideas/:id/forecast` · `GET /v1/ideas/:id/forecasts` |
| **Developer Portal MCP** | `POST /mcp` — scoped Streamable HTTP tools, resources and prompt for agentic API consumers |
| **Connectors** | `POST /v1/connectors/slack/interactive` · link tokens · `GET /v1/connectors/links` |
| LLM & tools | `POST /v1/llm` · `POST /v1/embed` |
| Auth | register / login / logout / me |
| Portfolio | ideas, portfolio, campaigns |
| Reporting | projection, impact |

---

## UI entry points

| File | Purpose |
|---|---|
| `kayroslab-complete-with-ai-agents.html` | **Public demo** — semantic map → novelty-ranked exploration → Kayros Signature → 8-agent governed cycle → export |
| `cycle-timeline.html` | Live SSE cycle visualisation |
| `portfolio-board.html` | Portfolio kanban |
| `ontology-explorer.html` / `ontology-panel.html` | Ontology graph (Cytoscape) |
| `index.html` / `index.fr.html` | Commercial landing |
| `frontend/positionning-app` | React Positioner application |

---

## Configuration

See `backend/fastify/.env.sample` and `core/OLLAMA.md`.

Key environment variables:

| Variable | Role |
|---|---|
| `MISTRAL_API_KEY` | Backend LLM provider |
| `LINKEDIN_ACCESS_TOKEN` | Optional official LinkedIn authenticated-member profile import |
| `CRYSTALKNOWS_API_TOKEN` | Optional Crystal Knows profile import on eligible plans |
| `KAYROS_MCP_CLIENTS_JSON` | SHA-256 token digests, tenant bindings, scopes and optional expiries for MCP clients |
| `KAYROS_EMBED_MODEL` | Force embedding model (default: soft fallback chain) |
| `DATABASE_URL` | Optional Postgres |
| `OLLAMA_*` | Local quant-aware inference |
| `KAYROS_TIMESFM_ENABLED` | Enables the optional TimesFM adapter and deployment path |
| `KAYROS_TIMESFM_ENDPOINT` · `KAYROS_TIMESFM_TOKEN` | Loopback inference endpoint and shared service token |
| `TIMESFM_MODEL_ID` | TimesFM model identifier (default: `google/timesfm-2.5-200m-pytorch`) |

### Optional adapters (env)

| Variable | Purpose |
|---|---|
| `KAYROS_SEARCH_PROVIDER` | `auto` · `tavily` · `brave` · `google` · `duckduckgo` |
| `KAYROS_SEARCH_LIMIT` | Max results (default `5`) |
| `TAVILY_API_KEY` · `BRAVE_API_KEY` | Web search providers |
| `GOOGLE_API_KEY` · `GOOGLE_CX` | Google Programmable Search |
| `GITHUB_TOKEN` | GitHub search rate limits / private |
| `LANGFUSE_PUBLIC_KEY` · `LANGFUSE_SECRET_KEY` | LLM observability (no-op if unset) |
| `LANGFUSE_BASE_URL` | Cloud or self-hosted Langfuse |
| `LANGFUSE_RELEASE` | Release tag on traces |

Search tools register at backend boot (`registerSearchToolsFromEnv`). Langfuse attaches via `attachLangfuse(app)` when keys are present.

---

## Deployment

### GitHub Pages (static demos + Positioner)

Workflow: `.github/workflows/deploy-positionning-pages.yml`

- Triggers on push to `main` for the listed HTML / frontend paths
- Builds the React Positioner app
- Copies static demos (with **size guard** on the main demo HTML > 50 KB to prevent truncation)
- Publishes with `peaceiris/actions-gh-pages` (force orphan)

### OVH VPS (backend)

```bash
# On the VPS after setting DATABASE_URL in backend/fastify/.env
bash deploy/ovh-vps/deploy-backend.sh
bash deploy/ovh-vps/install-cron-backup.sh
```

CI: `.github/workflows/deploy-vps-backend.yml` (SSH + PM2, port **8787**).

| Tier | Description | Status |
|---|---|---|
| **P0** | Standalone offline (mock) | ✅ |
| **P1** | Local sovereign — Ollama quant-aware | ✅ |
| **P2** | Governed cloud — Fastify + optional Postgres | ✅ |

Also see [RUNBOOK.md](RUNBOOK.md).

---

## Development & tests

```bash
# Engine unit tests
cd core && node --test

# Targeted suites
node --test connectors-slack-deep.test.mjs connectors-motif.test.mjs positionning/ontology-graph.test.mjs
```

CI workflow: `.github/workflows/core-tests.yml`.

---

## Roadmap

| Phase | Goal | Status |
|---|---|---|
| v1–v9 | Prototype → collaboration | ✅ |
| v10 | Layered memory L0–L3 + quant soft-fallback | ✅ |
| v11 | SSE cycle · lifecycle · positioning→L1 · memory API · timeline · gate→idea | ✅ |
| v12 | Postgres multi-instance · ontology UX · portfolio · seed/pitch | ✅ |
| v13 | Slack deepen (signature, idempotence) · ontology Cytoscape graph | ✅ |
| v14 | Persist account links · motif modal · message update · ontology embed panel | ✅ |
| **v15** | **Embedding novelty ranking · Kayros Signature · public demo ranking UI** | ✅ |
| **v16** | Engine novelty API · KPI drift · Discord scaffold · **optional adapters** (LangChain tools, LangGraph research, multi-provider search, Langfuse) · demo ontology/Mistral wiring | ✅ |
| **v17** | **Teams adapter complet** (JWT RS256 Azure Bot, JWKS cache, Adaptive Cards, gate/EF-20, idempotence, route interactive, envoi proactif bot + webhook) | ✅ |
| **v18** | **Engine/adapters split + governed intelligence layers** (zero-dep `core/`, optional `core/adapters/` + `backend/adapters/`, P0–P4 control layers, decision packet surface) · CI GitHub Actions (core + backend + i18n) | ✅ |
| **v19** | **Specialized swarms + Hybrid Agent Sales Oracle** — system/custom/hybrid composition, personality simulation, official profile imports, veto-aware executive and buyer-committee rehearsal | ✅ |
| **v20** | **Governed TimesFM forecasting** — isolated model service, P10–P90 uncertainty, tenant-scoped snapshots and mandatory human review for wide intervals | ✅ |

---

## Further documentation

| Document | Topic |
|---|---|
| [core/README.md](core/README.md) | Engine modules |
| [core/OLLAMA.md](core/OLLAMA.md) | Local quant path |
| [RUNBOOK.md](RUNBOOK.md) | Ops procedures |
| [CHANGELOG.md](CHANGELOG.md) | Release notes |
| [SPECIFICATIONS_FONCTIONNELLES.md](SPECIFICATIONS_FONCTIONNELLES.md) | Functional requirements |
| [SPECIFICATIONS_TECHNIQUES.md](SPECIFICATIONS_TECHNIQUES.md) | Technical requirements |
| [SPECIFICATIONS_CONNECTEURS_CHAT.md](SPECIFICATIONS_CONNECTEURS_CHAT.md) | Slack / Teams / Discord product thesis |
| [docs/v13-slack-ontology.md](docs/v13-slack-ontology.md) | v13 notes |
| [docs/v14-slack-ontology.md](docs/v14-slack-ontology.md) | v14 links · motif · update · embed |
| [docs/pitch-seed.md](docs/pitch-seed.md) | Demo script |
| [docs/engine-architecture.md](docs/engine-architecture.md) | Core vs adapters (V16) |
| [docs/specialized-agent-swarms.md](docs/specialized-agent-swarms.md) | Swarm composition, personality profiles, consent and Sales Oracle scenarios |
| [docs/developer-portal-mcp.md](docs/developer-portal-mcp.md) | Secure Developer Portal MCP and AI coding-tool configuration |
| [docs/TIMESFM_FORECASTING.md](docs/TIMESFM_FORECASTING.md) | TimesFM architecture, safeguards, deployment and verification |
| [backend/adapters/README.md](backend/adapters/README.md) | LangChain · LangGraph · search · Langfuse |

---

## Contact

**Geoffroy de La Tournelle** — Founder & Director, KayrosLab  
[geoffroydelatournelle@gmail.com](mailto:geoffroydelatournelle@gmail.com) · [LinkedIn](https://www.linkedin.com/in/gdelatournelle/)

---

## License

Proprietary — © KayrosLab / Geoffroy de La Tournelle. All rights reserved unless otherwise stated in writing.

---

*KayrosLab — Turning noise into governed strategy.*
