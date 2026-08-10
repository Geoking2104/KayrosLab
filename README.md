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

---

## Table of contents

1. [Why KayrosLab](#why-kayroslab)
2. [Features](#features)
3. [Quick start](#quick-start)
4. [Repository layout](#repository-layout)
5. [How it works](#how-it-works)
6. [Core engine](#core-engine)
7. [Backend API](#backend-api)
8. [UI entry points](#ui-entry-points)
9. [Configuration](#configuration)
10. [Deployment](#deployment)
11. [Development & tests](#development--tests)
12. [Roadmap](#roadmap)
13. [Further documentation](#further-documentation)
14. [Contact](#contact)
15. [License](#license)

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
- **Multi-tenant stores** — JSON files or Postgres (`DATABASE_URL`) for ideas, gates & **account links**
- **Chat connectors** — Slack (signature, idempotence, Block Kit gates, **motif modal**, **chat.update**); **Teams (JWT RS256 Azure Bot, Adaptive Cards, gate/EF-20, envoi proactif + webhook)**; Discord (Ed25519, embeds)
- **Portfolio UX** — kanban board, dormant ideas + reactivate, ontology Cytoscape explorer + embed panel
- **Optional adapters (V16)** — LangChain tools bridge, LangGraph research runner, multi-provider search tools, Langfuse observability (all peripheral; `core/` stays zero-dep)

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
│   ├── adapters/         # Optional periphery (LangChain tools, LangGraph, search, Langfuse)
│   │   ├── langchain-tools.mjs
│   │   ├── langgraph-runner.mjs
│   │   ├── search-tools.mjs
│   │   └── langfuse.mjs
│   └── agents/           # Specialist agents (incl. Bisociateur)
├── backend/
│   ├── fastify/          # HTTP API, auth, SSE cycle, connectors
│   └── adapters/         # Fastify attach helpers (same adapters as core/)
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
| 07 | **Project** | `projeter` | Roadmap, resources, foresight | Trajectory + loop | `POST/GET /v1/ideas/:id/roadmap` (EF-39/40/41 🟢 : roadmap + Monte-Carlo déterministe + rapport d'impact tracé) + `POST/GET /v1/ideas/:id/risques` (EF-42 🟢 : matrice 5×5 + gate `re_arbitrage`) + `POST/GET /v1/ideas/:id/capitalisation` (EF-44 🟢 : dossier No-Go + réactivation) |
| 08 | **Execute** | `realiser` | Pilot → Deploy → Review | Milestones + impact | `POST/PATCH/GET /v1/ideas/:id/execution` (EF-80→83 🟢) + `POST .../execution/monitor` (EF-43 🟢 : seuils KPI + dérive → signal → gate `re_arbitrage`) |

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
| `adapters/*` | Optional: LangChain tools, LangGraph runner, search tools, Langfuse (peers; no core deps) |
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

Path: [`backend/fastify/`](backend/fastify/) — reuses `core/`.

| Domain | Endpoints |
|---|---|
| **Cycle SSE** | `POST /v1/cycle/run` · `POST /v1/cycle/reactivate` · `GET /v1/cycle/status` |
| **Memory** | `GET\|POST /v1/memory/l3` · `GET /v1/memory/ideas/:id` · `POST /v1/memory/promote` · `POST /v1/memory/save` |
| **Positioning** | analyze, search, GitHub, ArXiv, OWL, `GET /v1/positionning/ontology` |
| **Governance** | `POST /v1/ideas/:id/gates` · `GET /v1/gates` · `POST /v1/gates/:id/resolve` |
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
| `KAYROS_EMBED_MODEL` | Force embedding model (default: soft fallback chain) |
| `DATABASE_URL` | Optional Postgres |
| `OLLAMA_*` | Local quant-aware inference |

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
