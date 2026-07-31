# KayrosLab

[![Website](https://img.shields.io/badge/Website-kayroslab.com-0ea5e9?style=flat-square)](https://www.kayroslab.com)
[![Live demo](https://img.shields.io/badge/Demo-Live_app-2563eb?style=flat-square)](https://geoking2104.github.io/KayrosLab/kayroslab-complete-with-ai-agents.html)
[![Pages](https://img.shields.io/badge/GitHub_Pages-Site-7c3aed?style=flat-square)](https://geoking2104.github.io/KayrosLab/)
[![License](https://img.shields.io/badge/License-Proprietary-slategray?style=flat-square)](#license)

**From weak signal to strategic decision — governed.**

KayrosLab is a **governed strategic ideation workshop**: multi-agent orchestration (Plan-and-Solve + ReAct), layered memory **L0–L3**, deterministic scoring, and Human-in-the-Loop gates with veto rights.

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
| Agents | One model | — | **Multi-agent** + Red Team |
| Memory | Session / flat | Tickets | **Layered L0–L3 + tenant scope** |
| Numbers | LLM guesses | Manual | **Deterministic** Monte-Carlo |
| Decision | Informal | Vote | **Vote instructs · veto decides** |
| Sovereignty | Cloud | Cloud | **Ollama quant-aware** or proxy |

---

## Features

- **8-step strategic cycle** — Intake → Listen → Map → Build → Position → Challenge → Decide → Project → Execute, with KPI feedback into Listen
- **SSE live cycle** — `POST /v1/cycle/run` streams plan/run events to `cycle-timeline.html`
- **Layered memory L0–L3** — working offload, atomic facts (incl. competitor from Positioner), distilled scenarios, scoped persona/norms
- **Governance** — gates, weighted votes, approve / reject / revise → idea stage & status
- **Positioner** — web / GitHub / GitLab / ArXiv, ontology graph, OWL export, L1 competitor injection
- **Quant-aware local LLM** — role-tiered Ollama tags + soft fallback (strip quant → mock)
- **Multi-tenant stores** — JSON files or Postgres (`DATABASE_URL`) for ideas & gates
- **Chat connectors** — Slack adapter (signature, idempotence, Block Kit gates); Teams scaffold
- **Portfolio UX** — kanban board, dormant ideas + reactivate, ontology Cytoscape explorer

---

## Quick start

### Prerequisites

- **Node.js 20+**
- Optional: [Ollama](https://ollama.com) for local inference
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

### 3. Demo seed (optional)

```bash
node core/seed-demo.mjs
# or with Postgres:
DATABASE_URL=postgres://user:pass@localhost:5432/kayroslab node core/seed-demo.mjs
```

---

## Repository layout

```text
KayrosLab/
├── core/                 # Zero-dep engine (ESM) — memory, orchestrator, governance, positionning
├── backend/fastify/      # HTTP API, auth, SSE cycle, connectors
├── frontend/             # React Positioner app
├── deploy/ovh-vps/       # Deploy, backup, cron helpers
├── docs/                 # Pitch, v13 notes, design notes
├── workers/              # Edge / proxy workers
├── cycle-timeline.html   # Live SSE cycle UI
├── portfolio-board.html  # Portfolio kanban
├── ontology-explorer.html
├── kayroslab-complete-with-ai-agents.html   # Public governed-agent demo
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
| 07 | **Project** | `projeter` | Roadmap, resources, foresight | Trajectory + loop |
| 08 | **Execute** | `realiser` | Pilot → Deploy → Review | Milestones + impact |

**Two orthogonal axes:** *stage* = execution progress; *status* = decision state. Dormant statuses (`en_pause`, `consideration_future`, `non_poursuivi`) are **reactivable** via `POST /v1/cycle/reactivate`.

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

```mermaid
flowchart TB
  USER([User / Campaign / API]) --> ENG[createEngine]
  ENG --> ORCH[Orchestrator]
  ENG --> AGENTS[Specialist agents]
  ENG --> MEM[LayeredMemory L0–L3]
  ENG --> LLM[KayrosLLM + RoutingPolicy]
  ENG --> GOV[Governance]
  ENG --> QG[QuantGuidance]

  ORCH -->|Plan-and-Solve| AGENTS
  ORCH -->|recall / distill / positionning| MEM
  AGENTS -->|complete| LLM
  ORCH -->|sensitive output| GOV
  QG -.->|preferredModel| AGENTS

  LLM --> P1[(Ollama)]
  LLM --> P2[(Backend proxy)]
  LLM --> P3[(Mock)]
```

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
| `index.mjs` | `createEngine` — providers, memory, quant, orchestrator |
| `orchestrator.mjs` | plan / run / project — recall, positioning→L1, distill, gates |
| `cycle-lifecycle.mjs` | Agent→stage, `applyGateResolution`, reactivate |
| `memory.mjs` · `memory-scope.mjs` · `memory-rank.mjs` | L0–L3, tenant hierarchy, ranking |
| `positionning/` | Scanners, ontology, OWL, `to-l1`, graph builder |
| `connectors.mjs` | Slack / Teams adapters, account link, gate views |
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
| **Connectors** | `POST /v1/connectors/slack/interactive` · link tokens |
| LLM & tools | `POST /v1/llm` · `POST /v1/embed` |
| Auth | register / login / logout / me |
| Portfolio | ideas, portfolio, campaigns |
| Reporting | projection, impact, dashboard |

**Safe by default.** Without `KAYROS_AUTH_SECRET`, protected routes return `503`. `tenantId` is taken from the auth token only.

**Store priority:** Postgres (`DATABASE_URL` + `pg`) → JSON files → in-memory.

---

## UI entry points

| Page | Purpose |
|---|---|
| [`index.html`](index.html) | Commercial site & enterprise offer |
| [`kayroslab-complete-with-ai-agents.html`](kayroslab-complete-with-ai-agents.html) | Public governed-agent demo (semantic map → 8 agents → PDF) |
| [`cycle-timeline.html`](cycle-timeline.html) | **Live SSE cycle** — stage rail, memory, promote L2, gates |
| [`portfolio-board.html`](portfolio-board.html) | Kanban portfolio |
| [`portfolio-dormant.html`](portfolio-dormant.html) | Dormant ideas + reactivate |
| [`ontology-explorer.html`](ontology-explorer.html) | Positioner ontology (Cytoscape graph) |
| [`frontend/positionning-app/`](frontend/positionning-app/) | React competitive positioning |
| [`docs/pitch-seed.md`](docs/pitch-seed.md) | Pitch one-pager + 8-minute demo script |

GitHub Pages: [geoking2104.github.io/KayrosLab](https://geoking2104.github.io/KayrosLab/).

---

## Configuration

Copy [`backend/fastify/.env.sample`](backend/fastify/.env.sample) to `.env`.

| Variable | Role |
|---|---|
| `PORT` | API port (default `8787`) |
| `KAYROS_AUTH_SECRET` | JWT / session secret (required for protected routes) |
| `KAYROS_USERS_FILE` · `KAYROS_IDEAS_FILE` · `KAYROS_GATES_FILE` · `KAYROS_MEMORY_FILE` | JSON persistence paths |
| `DATABASE_URL` | Optional Postgres (multi-instance) |
| `OLLAMA_ENDPOINT` · `OLLAMA_MODEL` · `KAYROS_QUANT` | Local model path |
| `MISTRAL_API_KEY` · `ANTHROPIC_API_KEY` | Cloud LLM providers |
| `SLACK_BOT_TOKEN` · `SLACK_SIGNING_SECRET` · `SLACK_GATE_CHANNEL` | Slack connector |
| `KAYROS_NOTIFY_WEBHOOK` · `KAYROS_SMTP_URL` | Outbound notifications |

---

## Deployment

| Path | Role |
|---|---|
| `deploy/ovh-vps/deploy-backend.sh` | npm install, optional `schema.sql`, PM2, nginx |
| `deploy/ovh-vps/backup-data.sh` | JSON tar + `pg_dump` |
| `deploy/ovh-vps/install-cron-backup.sh` | Daily 03:00 cron |
| `core/sql/schema.sql` | Ideas & gates tables |

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
node --test connectors-slack-deep.test.mjs positionning/ontology-graph.test.mjs
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
| v14 | Persist Slack account links · motif modal · message update · main-demo ontology embed | 🔵 |

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
| [docs/v13-slack-ontology.md](docs/v13-slack-ontology.md) | v13 residual marketplace work |
| [docs/pitch-seed.md](docs/pitch-seed.md) | Demo script |

---

## Contact

**Geoffroy de La Tournelle** — Founder & Director, KayrosLab  
[geoffroydelatournelle@gmail.com](mailto:geoffroydelatournelle@gmail.com) · [LinkedIn](https://www.linkedin.com/in/gdelatournelle/)

---

## License

Proprietary — © KayrosLab / Geoffroy de La Tournelle. All rights reserved unless otherwise stated in writing.

---

*KayrosLab — Turning noise into governed strategy.*
