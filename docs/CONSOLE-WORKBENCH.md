# Console workbench — setup & user guide

Adapted from [Multica](https://github.com/multica-ai/multica) (README +
[cloud quickstart](https://www.multica.ai/docs/cloud-quickstart) +
`CLI_INSTALL.md`) for KayrosLab. We copy the **shape of the first five
minutes**, not the product.

Source lives in [`frontend/console-workbench`](../frontend/console-workbench).

---

## What KayrosLab is (and is not)

KayrosLab is a **governed strategic ideation workshop**: an 8-step cycle,
layered memory L0–L3, novelty ranking, specialised swarms, human gates with
veto. It is not a coding-agent runtime.

Multica multiplexes Claude Code / Codex / Cursor on a machine you control.
KayrosLab multiplexes **roles** (Planner, Red Team, CFO, Synthesizer) on a
decision, and a human still signs the gate.

---

## First cycle in five minutes

Same spine as Multica's "first agent in five minutes".

### 1. Open the workspace

Multica: sign in on the web or Desktop.

KayrosLab: the workbench is the tenant. Name it (default *KayrosLab ·
atelier gouverné*). No account in this playable console. Persistence is
local (`kayros-console-v4`). Production remains Fastify + verified e-mail.

### 2. Compose a swarm

Multica: connect a computer (runtime + daemon). Prerequisite: at least one
agent CLI signed in. Multica drives them; it does not ship them.

KayrosLab: an **essaim** is the runtime. Seeded:

| Swarm | Members | Threshold |
|---|---|---|
| Comex interne | CFO, Red Team, Synthesizer, Planner | `veto_power_csuite` |
| Cycle stratégique 8 | Planner → Synthesizer | `majority` |
| Boucle KPI | Projection, Tracker | `majority` |

Toggle members, set the threshold, enable personality only with explicit
consent. Consensus stays **consultative** until a human arbitrates.

### 3. File an idea

Multica: create an agent (name required, runtime + tool).

KayrosLab: the work unit is the **idea**, not the CLI. Seeded cards already
sit on the board (Sales Oracle, Positioner, intake P2P, console-matrice).
Press `C` or **Nouvelle idée**.

### 4. Run the cycle

Multica: file an issue, set the agent as assignee, watch the transcript.

KayrosLab: **Lancer le cycle**. The card moves **En cycle**. Events stream
meta → start → recall → positionning → trace → distill → synthesis → gate →
final → done. Stage (execution) and status (decision) stay orthogonal.

### 5. Arbitrate at the gate

Multica: work lands in review, not in main. Inbox pings when an agent needs
a call.

KayrosLab: **Inbox**. Open gates and pending swarm runs. Weighted votes
instruct; a veto can force `NO_GO`. Human: approve / revise / reject
(reason required) or accept consensus / override veto / re-evaluate.
Approve → Projeter → Réaliser → measured KPI. The **Mesuré** column only
accepts a card after Execute.

---

## Board columns

| Lane | Meaning |
|---|---|
| À traiter | Backlog, dormant, `nouveau` |
| En cycle | Running 00–05, `en_developpement` |
| À arbitrer | Gate open, `en_revue`, pending swarm |
| Mesuré | `termine` + KPI |

Drag cards. A drop onto **Mesuré** is refused until the cycle has closed.

---

## Stay in the loop

- **Inbox** — gates + swarm arbitration. Not every SSE event.
- **Inspecteur** — click a card, edit everything (title, brief, KI, stage, status).
- **Guide** — this document, in-app, FR/EN.
- **Essaims** — registry, config, run, human arbitration (`SIMULATION`).

Advanced views stay under Atelier / Système. They are not the home.

---

## Architecture (KayrosLab, not Multica)

```
  Tableau  ·  Inbox  ·  Essaims  ·  Guide
                    │
                    ▼
         ┌──────────────────────┐
         │  Console workbench   │  React, local engine
         │  persist v4          │
         └──────────┬───────────┘
                    │  (production maps to)
                    ▼
         ┌──────────────────────┐     ┌─────────────┐
         │  Fastify /v1         │────▶│  Postgres   │
         │  SwarmService        │     └─────────────┘
         │  HybridAgentGateway  │
         └──────────┬───────────┘
                    │
         ┌──────────┴───────────┐
         │  Ollama quant-aware  │  or Claude / Mistral proxy
         └──────────────────────┘
```

Core stays zero-dep. Tools cannot skip a gate. Personality requires
`consent = true`. Forecasts and Oracle results are labelled `SIMULATION`.

---

## Production setup (analog of `multica setup`)

Multica: `brew install multica-ai/tap/multica` then `multica setup`, or
`install.sh --with-server` + Docker for self-host.

KayrosLab production:

```bash
cd core && node --test
cd backend/fastify
cp .env.sample .env
npm install
node index.mjs          # API
```

Optional: Ollama for local inference, `DATABASE_URL` for Postgres.
The workbench in this folder does not emit connector secrets and does not
replace `/console/`.
