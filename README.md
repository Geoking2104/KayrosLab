# KayrosLab

[![Site & Offer](https://img.shields.io/badge/Site_&_Offer-Enterprise-7c3aed?style=for-the-badge)](https://geoking2104.github.io/KayrosLab/)
[![Positioning](https://img.shields.io/badge/Positioning-Competitive-f97316?style=for-the-badge)](https://geoking2104.github.io/KayrosLab/positionner-app/)
[![AI Agents](https://img.shields.io/badge/AI_Agents-Application-059669?style=for-the-badge)](https://geoking2104.github.io/KayrosLab/kayroslab-complete-with-ai-agents.html)
[![Cycle SSE](https://img.shields.io/badge/Cycle-SSE_Timeline-0ea5e9?style=for-the-badge)](./cycle-timeline.html)
[![Portfolio](https://img.shields.io/badge/Portfolio-Kanban-6366f1?style=for-the-badge)](./portfolio-board.html)
[![Ontology](https://img.shields.io/badge/Positioner-Ontology-a855f7?style=for-the-badge)](./ontology-explorer.html)
[![Open in Browser](https://img.shields.io/badge/App-Live_Demo-2563eb?style=for-the-badge)](https://geoking2104.github.io/KayrosLab/kayroslab-complete-with-ai-agents.html)
[![Website](https://img.shields.io/badge/Website-kayroslab.com-0ea5e9?style=for-the-badge)](https://www.kayroslab.com)

**From weak signal to strategic decision — governed.**

KayrosLab is a **governed strategic ideation workshop** that turns weak signals into robust decisions that are challenged, arbitrated, projected, **then executed and measured**. Agent architecture (Plan-and-Solve + ReAct), layered memory L0–L3, deterministic calculations, and structured Human-in-the-Loop with censors and veto rights.

This is **not** a trained model: it is a **governed LLM** — an orchestrator that drives real LLMs (Claude via backend, **quant-aware local Ollama**) behind a governance layer.

---

## How it works — visual overview

### 1. Strategic cycle (8 steps + feedback loop)

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

| # | Step | Role | Output |
|---|---|---|---|
| 00 | **Intake** (`recueillir`) | Structured intake canvas | Comparable idea from entry |
| 01 | **Listen** (`ecouter`) | Noise reduction, scoring, clustering | Qualified signals |
| 02 | **Map** (`cartographier`) | Trend network, bridges (bisociation) | Graph + strategic bridges |
| 03 | **Build** (`construire`) | Scenarios, Collision Mode, brief | Scenarios + hypotheses |
| 04 | **Position** (`construire` / Positioner) | Web + GitHub/GitLab, ontology, gap analysis → **L1 competitor facts** | Cytoscape + OWL + L1 |
| 05 | **Challenge** (`eprouver`) | Critic + Devil's Advocate + **Red Team** | Attack report, kill shots |
| 06 | **Decide** (`arbitrer`) | Weighted vote, human gate, veto | Go / No-Go / Revision |
| 07 | **Project** (`projeter`) | Roadmap, resources, probabilistic foresight | Trajectory + loop to Listen |
| 08 | **Execute** (`realiser`) | Pilot → Deploy → Review | Tracked milestones, measured impact |

**Two orthogonal axes.** *Stage* = where *execution* stands; *status* = where *decision* stands. Domain status codes remain as stored values (`en_pause`, `consideration_future`, `non_poursuivi`) and are **reactivable** via `POST /v1/cycle/reactivate`.

---

### 2. Live governed cycle (SSE)

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
    Note over API: idea status/stage updated
  else auto
    ORCH-->>UI: final auto
  end
  ORCH-->>UI: done
```

**Event stream:**

```text
meta → start → recall → positionning → trace×N → offload? → distill?
     → synthesis → gate? → final → done
```

Each event may carry `idea: { stage, status }` (lifecycle sync).

Open **[`cycle-timeline.html`](cycle-timeline.html)** (`?api=http://localhost:8787`) for the live UI: stage rail, memory inspector, L2→L3 promote.

---

### 3. Engine architecture

```mermaid
flowchart TB
  USER([User / Campaign / API]) --> ENG[createEngine]

  ENG --> ORCH[Orchestrator
  plan · run · project · monitor]
  ENG --> AGENTS[Specialist agents]
  ENG --> MEM[LayeredMemory L0–L3]
  ENG --> LLM[KayrosLLM + RoutingPolicy]
  ENG --> GOV[Governance
  gates · veto · RBAC]
  ENG --> QG[QuantGuidance
  role tiers · Ollama tags]

  ORCH -->|Plan-and-Solve| AGENTS
  ORCH -->|recall / remember / offload / distill / positionning| MEM
  AGENTS -->|complete preferredModel| LLM
  ORCH -->|sensitive output| GOV
  QG -.->|preferredModel quantRec| AGENTS
  QG -.->|defaultModel / modelFor| LLM

  LLM --> P1[(Ollama local)]
  LLM --> P2[(Backend proxy)]
  LLM --> P3[(Mock fallback)]

  MEM --> L0[L0 Working / offload]
  MEM --> L1[L1 Atomic facts]
  MEM --> L2[L2 Scenarios]
  MEM --> L3[L3 Core / skills]

  classDef core fill:#f0f9ff,stroke:#0369a1,color:#0c4a6e
  classDef mem fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef llm fill:#ecfdf5,stroke:#059669,color:#064e3b
  class ENG,ORCH,AGENTS,GOV,QG core
  class MEM,L0,L1,L2,L3 mem
  class LLM,P1,P2,P3 llm
```

---

### 4. Layered memory (L0 → L3)

```mermaid
flowchart TB
  subgraph L0["L0 — Working / ephemeral"]
    W[agent scratch · tool outputs]
    OFF[FileOffloadBackend]
    CANVAS[Mermaid working canvas]
    W --> OFF
    W --> CANVAS
  end

  subgraph L1["L1 — Atomic facts"]
    F[observation · risk · competitor · metric…]
    POS[Positioning inject]
    POS --> F
    F --> VEC[(Vector store)]
  end

  subgraph L2["L2 — Scenarios / insights"]
    S[autoDistillL2 ± LLM]
    F -->|group by type| S
  end

  subgraph L3["L3 — Core memory"]
    C[persona · norms · skills]
  end

  L0 -->|short assertive obs| L1
  L1 -->|distill| L2
  L2 -->|promote API| L3
  L3 -->|stable context| CTX[buildContextBlock → agents]
  L2 --> CTX
  L1 --> CTX

  PERSIST[(FileLayeredStore
  per-tenant partitions)] -.-> L1
  PERSIST -.-> L2
  PERSIST -.-> L3
```

| Layer | Purpose | Persistence |
|---|---|---|
| **L0** | Working context, offload, Mermaid canvas | Optional `offloadRoot` |
| **L1** | Atomic facts (+ **competitor** from positioning) | JSON + vectors |
| **L2** | Scenarios (`autoDistill`) | JSON + vectors |
| **L3** | Persona, norms, skills (scoped tenant/user) | JSON |

**Memory API**

| Method | Path | Role |
|---|---|---|
| `GET` | `/v1/memory/l3` | List core norms |
| `POST` | `/v1/memory/l3` | Upsert L3 |
| `GET` | `/v1/memory/ideas/:ideaId` | Inspector L0–L3 |
| `POST` | `/v1/memory/promote` | L2 → L3 |
| `POST` | `/v1/memory/save` | Force disk persist |

---

### 5. Gate → idea (Human-in-the-Loop)

```mermaid
flowchart LR
  SENS[Sensitive synthesis] --> OPEN[governance.open]
  OPEN --> PEND[status: en_revue
  final: pending_review]
  PEND --> RES{resolve}
  RES -->|approve| GO[status: en_developpement
  stage: projeter]
  RES -->|reject| NG[status: non_poursuivi]
  RES -->|revise| REV[status: en_revue
  stage: eprouver]
```

`POST /v1/gates/:gateId/resolve` with `{ decision: "approve"|"reject"|"revise", reason }` updates the idea via `applyGateResolution` and returns `{ resolution, idea }`.

---

### 6. Quant-aware local path (Ollama) + soft fallback

```mermaid
flowchart LR
  REQ[LLM request] --> TAG{Model tag
  with quant?}
  TAG -->|yes| OLLAMA[Ollama complete]
  TAG -->|no| POL[RoutingPolicy.modelFor
  + QuantGuidance]
  POL --> OLLAMA

  OLLAMA -->|ok| OK[Response]
  OLLAMA -->|fail| STRIP[stripQuantFromTag
  retry base model]
  STRIP -->|ok| DEG1[Response + degraded]
  STRIP -->|fail| MOCK[Mock provider]
  MOCK --> DEG2[Response + degraded]

  classDef ok fill:#d1fae5,stroke:#059669
  classDef soft fill:#fef3c7,stroke:#d97706
  class OK ok
  class DEG1,DEG2,STRIP soft
```

Details: **[core/OLLAMA.md](core/OLLAMA.md)** · **[core/README.md](core/README.md)**

---

## Entry points

| Page | Usage |
|---|---|
| **[`index.html`](index.html)** | Commercial site and enterprise offer |
| **[`kayroslab-complete-with-ai-agents.html`](kayroslab-complete-with-ai-agents.html)** | Reference app: positioning, campaigns, PDF, PWA |
| **[`cycle-timeline.html`](cycle-timeline.html)** | **Live SSE cycle** — stage rail, positioning, memory inspect, promote L2 |
| **[`portfolio-board.html`](portfolio-board.html)** | Kanban portfolio (`/v1/portfolio`) |
| **[`portfolio-dormant.html`](portfolio-dormant.html)** | Dormant ideas + reactivate |
| **[`ontology-explorer.html`](ontology-explorer.html)** | Positioner ontology (tech & business entities) |
| **[`frontend/positionning-app/`](frontend/positionning-app/)** | React competitive positioning |
| **[`docs/pitch-seed.md`](docs/pitch-seed.md)** | Pitch one-pager + 8-minute demo script |

---

## What sets KayrosLab apart

| Criterion | Chat LLM | Innovation platform | **KayrosLab** |
|---|---|---|---|
| Structure | Conversation | Stage-gate | **Governed 8-step cycle** |
| Agents | One model | — | **Multi-agent** + Red Team |
| Memory | Session / flat | Tickets | **Layered L0–L3 + tenant scope** |
| Numbers | LLM guesses | Manual | **Deterministic** Monte-Carlo |
| Decision | Informal | Vote | **Vote instructs + veto decides** |
| Sovereignty | Cloud | Cloud | **Ollama quant-aware** or proxy |

---

## Core `core/`

Zero-dependency engine (ESM, Node 20+). See **[core/README.md](core/README.md)**.

| Module | Role |
|---|---|
| `index.mjs` | `createEngine` — providers, memory, quant, orchestrator |
| `orchestrator.mjs` | plan / run / project — recall, **positioning→L1**, distill, gates |
| `cycle-lifecycle.mjs` | Agent→stage, **applyGateResolution**, reactivate |
| `memory.mjs` · `memory-scope.mjs` · `memory-rank.mjs` | L0–L3, tenant hierarchy, ranking |
| `positionning/to-l1.mjs` | Gap analysis → competitor L1 facts |
| `positionning/ontology.mjs` | Tech & business entity catalogue |
| `pg-store.mjs` | Optional multi-instance Postgres ideas & gates |
| `seed-demo.mjs` | Demo idea seed (file or Postgres) |
| `quant-guidance.mjs` | Role tiers, soft fallback |
| `governance.mjs` | Gates, RBAC, veto |
| `model.mjs` | Idea stage × status |

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

```bash
cd core && node --test
node core/seed-demo.mjs
```

---

## Backend

`backend/fastify/` reuses `core/`.

| Domain | Endpoints |
|---|---|
| **Cycle SSE** | `POST /v1/cycle/run` · `POST /v1/cycle/reactivate` · `GET /v1/cycle/status` |
| **Memory** | `GET\|POST /v1/memory/l3` · `GET /v1/memory/ideas/:id` · `POST /v1/memory/promote` · `POST /v1/memory/save` |
| **Positioning** | analyze, search, GitHub, ArXiv, OWL export, **`GET /v1/positionning/ontology`** |
| LLM & tools | `POST /v1/llm` · `POST /v1/embed` · tools |
| Auth | register / login / logout / me |
| Portfolio | ideas, portfolio, campaigns |
| **Governance** | `POST /v1/ideas/:id/gates` · `GET /v1/gates` · `POST /v1/gates/:id/resolve` |
| Projection & reporting | projection, impact, dashboard |

**Safe by default.** Without `KAYROS_AUTH_SECRET`, protected routes return `503`. `tenantId` comes from the token only.

**Stores (priority):** Postgres if `DATABASE_URL` + `pg` → else JSON files → else in-memory. Multi-instance safe when Postgres is enabled.

```bash
cd backend/fastify && npm install && node index.mjs
# open cycle-timeline.html?api=http://localhost:8787
```

---

## Development

```bash
cd core && node --test
node core/quant-ollama-demo.mjs llama3.2
```

Persistence env vars: `KAYROS_USERS_FILE`, `KAYROS_IDEAS_FILE`, `KAYROS_GATES_FILE`, `KAYROS_MEMORY_FILE`, `DATABASE_URL`.  
See `backend/fastify/.env.sample`.

---

## Deployment (VPS)

| Path | Role |
|---|---|
| `deploy/ovh-vps/deploy-backend.sh` | npm install, optional `schema.sql`, PM2, nginx |
| `deploy/ovh-vps/backup-data.sh` | JSON tar + `pg_dump` |
| `deploy/ovh-vps/install-cron-backup.sh` | Daily 03:00 cron |
| `core/sql/schema.sql` | Ideas & gates tables |

```bash
# On VPS after setting DATABASE_URL in backend/fastify/.env
bash deploy/ovh-vps/deploy-backend.sh
bash deploy/ovh-vps/install-cron-backup.sh
DATABASE_URL=postgres://… node core/seed-demo.mjs
```

CI: `.github/workflows/deploy-vps-backend.yml` (SSH + PM2, port **8787**).

| Tier | Description | Status |
|---|---|---|
| **P0** | Standalone offline (mock) | ✅ |
| **P1** | Local sovereign — Ollama quant-aware | ✅ |
| **P2** | Governed cloud — Fastify proxy + optional Postgres | ✅ |

---

## Roadmap

| Phase | Goal | Status |
|---|---|---|
| v1–v9 | Prototype → collaboration | ✅ |
| v10 | Layered memory L0–L3 + quant soft-fallback | ✅ |
| v11 | SSE cycle · idea lifecycle · positioning→L1 · memory API · timeline UI · gate→idea | ✅ |
| v12 | Postgres multi-instance · ontology UX · portfolio board · seed/pitch | ✅ |
| v13 | Deeper Slack connectors, ontology graph in main demo | 🔵 |

---

## Contact

**Geoffroy de La Tournelle** — Founder & Director, KayrosLab  
[geoffroydelatournelle@gmail.com](mailto:geoffroydelatournelle@gmail.com) · [LinkedIn](https://www.linkedin.com/in/gdelatournelle/)

---

*KayrosLab — Turning noise into governed strategy.*
