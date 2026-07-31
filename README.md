# KayrosLab

[![Site & Offre](https://img.shields.io/badge/🏢_Site_&_Offre-Entreprises-7c3aed?style=for-the-badge)](https://geoking2104.github.io/KayrosLab/)
[![Positionnement](https://img.shields.io/badge/🎯_Positionnement-Concurrentiel-f97316?style=for-the-badge)](https://geoking2104.github.io/KayrosLab/positionner-app/)
[![Agents IA](https://img.shields.io/badge/📊_Agents_IA-Application-059669?style=for-the-badge)](https://geoking2104.github.io/KayrosLab/kayroslab-complete-with-ai-agents.html)
[![Cycle SSE](https://img.shields.io/badge/⚡_Cycle-SSE_Timeline-0ea5e9?style=for-the-badge)](./cycle-timeline.html)
[![Open in Browser](https://img.shields.io/badge/▶_App-Live_Demo-2563eb?style=for-the-badge)](https://geoking2104.github.io/KayrosLab/kayroslab-complete-with-ai-agents.html)
[![Website](https://img.shields.io/badge/Website-kayroslab.com-0ea5e9?style=for-the-badge)](https://www.kayroslab.com)

**Du signal faible à la décision stratégique — gouvernée.**

KayrosLab est un **atelier d'idéation stratégique gouverné** qui transforme des signaux faibles en décisions robustes, challengées, arbitrées, projetées **puis exécutées et mesurées**. Architecture agentique (Plan-and-Solve + ReAct), mémoire stratifiée L0–L3, calculs déterministes, et Human-in-the-Loop structuré avec censeurs et droit de veto.

Ce n'est **pas** un modèle entraîné : c'est un **« LLM gouverné »** — un orchestrateur qui pilote de vrais LLM (Claude via backend, **Ollama local quant-aware**) derrière une couche de gouvernance.

---

## How it works — visual overview

### 1. Strategic cycle (8 steps + feedback loop)

```mermaid
flowchart LR
  subgraph CYCLE["KayrosLab strategic cycle"]
    direction LR
    A[Écouter] --> B[Cartographier]
    B --> C[Construire]
    C --> D[Positionner]
    D --> E[Éprouver]
    E --> F[Arbitrer]
    F --> G[Projeter]
    G --> H[Réaliser]
  end
  H -.->|KPIs · alerts · re-arbitrage| A

  classDef step fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
  class A,B,C,D,E,F,G,H step
```

| # | Step | Role | Output |
|---|---|---|---|
| 00 | **Recueillir** | Structured intake canvas | Comparable idea from entry |
| 01 | **Écouter** | Noise reduction, scoring, clustering | Qualified signals |
| 02 | **Cartographier** | Trend network, bridges (bisociation) | Graph + strategic bridges |
| 03 | **Construire** | Scenarios, Collision Mode, brief | Scenarios + hypotheses |
| 04 | **Positionner** | Web + GitHub/GitLab, ontology, gap analysis → **L1 competitor facts** | Cytoscape + OWL + L1 |
| 05 | **Éprouver** | Critic + Devil's Advocate + **Red Team** | Attack report, kill shots |
| 06 | **Arbitrer** | Weighted vote, human gate, veto | Go / No-Go / Revision |
| 07 | **Projeter** | Roadmap, resources, probabilistic foresight | Trajectory + loop to Écouter |
| 08 | **Réaliser** | Pilot → Deploy → Review | Tracked milestones, measured impact |

**Two orthogonal axes.** *Stage* = where *execution* stands; *status* = where *decision* stands. Dormant states (`en_pause`, `consideration_future`, `non_poursuivi`) are **reactivable** (`POST /v1/cycle/reactivate`).

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
  ORCH->>MEM: positionning → L1 competitor facts
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
    POS[Positionning inject]
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
| **L1** | Atomic facts (+ **competitor** from positionning) | JSON + vectors |
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

## 🚀 Entry points

| Page | Usage |
|---|---|
| **[`index.html`](index.html)** | Commercial site & enterprise offer |
| **[`kayroslab-complete-with-ai-agents.html`](kayroslab-complete-with-ai-agents.html)** | Reference app: positioning, campaigns, PDF, PWA |
| **[`cycle-timeline.html`](cycle-timeline.html)** | **Live SSE cycle** — stage rail, positionning, memory inspect, promote L2 |
| **[`frontend/positionning-app/`](frontend/positionning-app/)** | React competitive positioning |

---

## 🌟 What sets KayrosLab apart

| Criterion | Chat LLM | Innovation platform | **KayrosLab** |
|---|---|---|---|
| Structure | Conversation | Stage-gate | **Governed 8-step cycle** |
| Agents | One model | — | **Multi-agent** + Red Team |
| Memory | Session / flat | Tickets | **Layered L0–L3 + tenant scope** |
| Numbers | LLM guesses | Manual | **Deterministic** Monte-Carlo |
| Decision | Informal | Vote | **Vote instructs + veto decides** |
| Sovereignty | Cloud | Cloud | **Ollama quant-aware** or proxy |

---

## 🧠 Core `core/`

Zero-dependency engine (ESM, Node 20+). See **[core/README.md](core/README.md)**.

| Module | Role |
|---|---|
| `index.mjs` | `createEngine` — providers, memory, quant, orchestrator |
| `orchestrator.mjs` | plan / run / project — recall, **positionning→L1**, distill, gates |
| `cycle-lifecycle.mjs` | Agent→stage, **applyGateResolution**, reactivate |
| `memory.mjs` · `memory-scope.mjs` · `memory-rank.mjs` | L0–L3, tenant hierarchy, ranking |
| `positionning/to-l1.mjs` | Gap analysis → competitor L1 facts |
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

const plan = await eng.orchestrator.plan('Lancer une offre B2B', { ideaId: 'idea-1' });
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
```

---

## 🔌 Backend

`backend/fastify/` reuses `core/`.

| Domain | Endpoints |
|---|---|
| **Cycle SSE** | `POST /v1/cycle/run` · `POST /v1/cycle/reactivate` · `GET /v1/cycle/status` |
| **Memory** | `GET\|POST /v1/memory/l3` · `GET /v1/memory/ideas/:id` · `POST /v1/memory/promote` · `POST /v1/memory/save` |
| LLM & tools | `POST /v1/llm` · `POST /v1/embed` · tools |
| Auth | register / login / logout / me |
| Portfolio | ideas, portfolio, campaigns |
| **Governance** | `POST /v1/ideas/:id/gates` · `GET /v1/gates` · `POST /v1/gates/:id/resolve` |
| Projection & reporting | projection, impact, dashboard |

**Safe by default.** Without `KAYROS_AUTH_SECRET`, protected routes return `503`. `tenantId` from token only.

```bash
cd backend/fastify && npm install && node index.mjs
# open cycle-timeline.html?api=http://localhost:8787
```

---

## 🛠️ Development

```bash
cd core && node --test
node core/quant-ollama-demo.mjs llama3.2
```

Persistence: `KAYROS_USERS_FILE`, `KAYROS_IDEAS_FILE`, `KAYROS_GATES_FILE`, `KAYROS_MEMORY_FILE`.  
See `backend/fastify/.env.sample`.

---

## 🚢 Deployment

| Tier | Description | Status |
|---|---|---|
| **P0** | Standalone offline (mock) | ✅ |
| **P1** | Local sovereign — Ollama quant-aware | ✅ |
| **P2** | Governed cloud — Fastify proxy | 🔵 |

CI: `.github/workflows/deploy-vps-backend.yml` (SSH + PM2, port 8787).

---

## 🗺️ Roadmap

| Phase | Goal | Status |
|---|---|---|
| v1–v9 | Prototype → collaboration | ✅ |
| v10 | Layered memory L0–L3 + quant soft-fallback | ✅ |
| v11 | **SSE cycle · idea lifecycle · positionning→L1 · memory API · timeline UI · gate→idea** | ✅ |
| v12 | Shared multi-instance store, deeper ontology UX | 🔵 |

---

## 📬 Contact

**Geoffroy de La Tournelle** — Founder & Director, KayrosLab  
[geoffroydelatournelle@gmail.com](mailto:geoffroydelatournelle@gmail.com) · [LinkedIn](https://www.linkedin.com/in/gdelatournelle/)

---

*KayrosLab — Transformer le bruit en stratégie gouvernée.*
