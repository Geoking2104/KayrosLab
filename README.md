<div align="center">

# KayrosLab

**Crash-test your strategic decisions before the real world does.**

KayrosLab is a governed decision workshop: AI agents with opposing duties — finance, engineering,
legal, sales — investigate one real decision, consolidate their objections into a verdict, and a
human arbitrates with the evidence in hand. Ask from the web console, Slack, Microsoft Teams, or
Discord; every decision stays in a durable, audited dossier. Run it local or cloud — no scraped
profiles, no black box.

[![Website](https://img.shields.io/badge/Website-kayroslab.com-0ea5e9?style=flat-square)](https://www.kayroslab.com)
[![Live demo](https://img.shields.io/badge/Demo-Live_app-2563eb?style=flat-square)](https://www.kayroslab.com/kayroslab-complete-with-ai-agents.html)
[![Pages](https://img.shields.io/badge/GitHub_Pages-Site-7c3aed?style=flat-square)](https://geoking2104.github.io/KayrosLab/)
[![Deploy Pages](https://github.com/Geoking2104/KayrosLab/actions/workflows/deploy-positionning-pages.yml/badge.svg)](https://github.com/Geoking2104/KayrosLab/actions/workflows/deploy-positionning-pages.yml)
[![Core tests](https://github.com/Geoking2104/KayrosLab/actions/workflows/core-tests.yml/badge.svg)](https://github.com/Geoking2104/KayrosLab/actions/workflows/core-tests.yml)
[![API docs](https://img.shields.io/badge/API-v1_docs-0f766e?style=flat-square)](https://api.kayroslab.com/docs)
[![License](https://img.shields.io/badge/License-Proprietary-slategray?style=flat-square)](#license)

[Website](https://www.kayroslab.com) · [Console](https://www.kayroslab.com/console/) · [API docs](https://api.kayroslab.com/docs) · [Salon](https://www.kayroslab.com/salon/) · [Live demo](https://www.kayroslab.com/kayroslab-complete-with-ai-agents.html) · [Whitepaper](https://www.kayroslab.com/whitepaper-kayroslab.html) · [Contact](mailto:contact@kayroslab.com)

</div>

<p align="center">
  <img src="assets/console-overview.webp" alt="The KayrosLab agent console: connected channels, live metrics and a decision under review" width="100%">
</p>

<p align="center">
  <sub><em>Verdicts stay consultative until a human arbitrates — every analysis, objection and condition stays in the dossier.</em></sub>
</p>

---

## What is KayrosLab?

A strategy can sound coherent in the meeting and still fail its first serious objection. Meetings
compress uncertainty into opinions, the strongest voice wins, and the numbers get retrofitted
afterwards. Nobody reconstructs why the decision was made — until it is too late to change it.

KayrosLab turns one decision into a governed operation. You state the question; a committee of
agents with opposing duties — a CFO, an engineer, a lawyer, a sales lead — investigates the
evidence, attacks each other's assumptions, and consolidates objections, conditions and a verdict:
**GO, conditional GO, or NO-GO**. The verdict stays consultative until the accountable human accepts
it, attaches conditions, or overrides a veto — and the whole dossier (claims, sources, numbers,
justifications) remains inspectable afterwards.

It is not a trained model, and it does not sell you a crystal ball. It is a **governed LLM stack**:
an orchestrator that drives real models — Ollama quant-aware on your machine, or, through the Fastify
backend, NVIDIA NIM (Kimi K3 in production, with Mistral as signalled fallback) and Claude — behind
layered memory, deterministic Monte-Carlo numbers, and human gates with veto rights.

**Salon** is a separate product, not a console tab: literary and philosophical reading circles
(a text, roles, a minute — verdicts *tenir / relire / laisser*, never GO/NO-GO). Protocol in
Rust (`crates/salon-core`), public foyer at [kayroslab.com/salon/](https://www.kayroslab.com/salon/).
See [docs/SALON.md](docs/SALON.md). **Do not merge Salon or any workbench over
`frontend/console-app`** — that directory is the production agent console.

---

## Public API v1

**Launch a governed mission from your own tools and get the verdict back — no human session needed.**
A CRM or an automation tool (Salesforce via n8n or Zapier, Make, your own code) sends a question to a
console **collective**; the agents deliberate; KayrosLab returns `GO`, `CONDITIONAL_GO` or `NO_GO` with
risks, conditions, each agent's opinion and a link to the dossier. The mission appears in the console,
where **a human still arbitrates**.

<p align="center">
  <a href="https://api.kayroslab.com/docs"><img src="assets/api-docs.webp" alt="api.kayroslab.com/docs — quick start and interactive OpenAPI reference of the KayrosLab public API v1" width="49%"></a>
  <img src="assets/console-integrations.webp" alt="Console → Intégrations: Salesforce PoC guide, scoped API keys and signed webhook" width="49%">
</p>
<p align="center"><sub><em>Left: the live reference at api.kayroslab.com/docs. Right: console → Intégrations (local instance, fictitious data).</em></sub></p>

| | |
|---|---|
| **Live reference** | **[api.kayroslab.com/docs](https://api.kayroslab.com/docs)** — quick start + interactive viewer |
| **OpenAPI 3.1** | [`https://api.kayroslab.com/v1/public/openapi.json`](https://api.kayroslab.com/v1/public/openapi.json) · source: [`docs/openapi/kayroslab-public-v1.json`](docs/openapi/kayroslab-public-v1.json) |
| **Full guide** | **[docs/API.md](docs/API.md)** — fields, lifecycle, webhooks, errors, limits, route inventory |
| **Base URL** | `https://api.kayroslab.com` |
| **Endpoints** | `GET /v1/public/me` (test the key) · `GET /v1/public/collectives` · `POST /v1/public/missions` (`202`, `Idempotency-Key` required) · `GET /v1/public/missions/{id}` · `GET /v1/public/missions?external_ref=` |
| **Authentication** | API key `kl_live_<prefix>_<secret>` created in **console → Intégrations** (role `comex` / `admin`), shown once, sent as `Authorization: Bearer …` or `X-Api-Key`. Tenant-scoped, revocable, optional expiry, restrictable to some collectives; only a SHA-256 fingerprint is stored |
| **Scopes** | `missions:write` · `missions:read` · `collectives:read` (default set) · `webhooks:manage` (reserved) |
| **Modes (profiles)** | `demo` — prepared answers in < 5 s, labelled `[Démo]`, `llm.simulated = true`, for wiring tests only · `fast` *(default)* — real verdict in 1–2 min (NVIDIA Nemotron) · `deep` — server model (Kimi K3), ~12 min |
| **Webhooks** | `mission.completed` · `mission.failed` · `mission.arbitrated` (+ `ping`) to the mission's `callback_url` and/or the tenant URL. Header `X-Kayros-Signature: t=<unix>,v1=<hex>`, `v1 = HMAC-SHA256(secret, t + "." + raw body)`; reject > 5 min skew, dedupe on `event_id`, answer `2xx` < 10 s. Retries at 1 min, 5 min, 30 min, 2 h, 6 h; `410` stops them |
| **Limits** | 60 requests/min per key · 200 missions/day per tenant (configurable) |

**Quick start**

```bash
export KAYROS_API_KEY=kl_live_…            # console → Intégrations → Clés d'API

# 1. Test the key and pick a collective
curl -s https://api.kayroslab.com/v1/public/me          -H "Authorization: Bearer $KAYROS_API_KEY"
curl -s https://api.kayroslab.com/v1/public/collectives -H "Authorization: Bearer $KAYROS_API_KEY"

# 2. Launch a mission (demo = simulated answer in seconds; use fast for a real verdict)
curl -s https://api.kayroslab.com/v1/public/missions \
  -H "Authorization: Bearer $KAYROS_API_KEY" \
  -H "Idempotency-Key: sf-0065g00000XyZab-Proposal" \
  -H "Content-Type: application/json" \
  -d '{"collective_id":"room_…","question":"Faut-il signer ACME à -15 % ?","profile":"demo",
       "external_ref":"salesforce:Opportunity:0065g00000XyZab"}'

# 3. Poll until state != running (or receive the signed webhook)
curl -s https://api.kayroslab.com/v1/public/missions/msn_… -H "Authorization: Bearer $KAYROS_API_KEY"
```

**Salesforce in 15 minutes.** Two ready-to-import n8n workflows (self-hosted n8n on the KayrosLab VPS)
turn a stage change to *Proposal/Price Quote* into a mission, verify the signed webhook, then write the
verdict — and later the human decision — back as tasks on the opportunity:
[integrations/n8n/README.md](integrations/n8n/README.md) · Zapier variant (2 Zaps):
[integrations/zapier/README.md](integrations/zapier/README.md) · architecture:
[docs/ARCHITECTURE-CONSOLE-INTEGRATIONS.md](docs/ARCHITECTURE-CONSOLE-INTEGRATIONS.md).

---

## Chat connectors: Slack, Microsoft Teams, Discord

The three chat connectors are **native** (implemented in `core/connectors*.mjs`,
`core/connector-config.mjs`, `core/connector-oauth.mjs`, `backend/fastify/routes/connectors.mjs`); they do
not go through the Public API or n8n. Status below reflects the code on `main`, not the marketing site.

<p align="center">
  <img src="assets/console-settings.webp" alt="Console → Réglages: Slack, Discord and Microsoft Teams connector cards with advanced token configuration" width="80%">
</p>
<p align="center"><sub><em>Console → Réglages on a local instance without server application credentials: one-click connect is unavailable, manual tokens remain possible.</em></sub></p>

### What actually works today

| Capability | Slack | Microsoft Teams | Discord |
|---|---|---|---|
| Ask the collective from the channel | ✅ Implemented — `app_mention` or direct message (Events API) | ✅ Implemented — message to the bot (Bot Framework activity) | ✅ Implemented — slash command `/kayros question:…` (Interactions endpoint) |
| Answer posted back in the channel | ✅ Verdict + summary, "En attente d'arbitrage humain" | ✅ Reply in the conversation | ✅ Reply to the interaction |
| Inbound request verification | ✅ HMAC `v0` signature (`X-Slack-Signature`), 5-min timestamp window | ✅ Bot Framework JWT RS256 (JWKS, issuer, audience = App ID, expiry) | ✅ Ed25519 (`X-Signature-Ed25519` + timestamp), 5-min window |
| Idempotence (retries, double clicks) | ✅ | ✅ | ✅ |
| Per-tenant connection from the console (encrypted secrets, connectivity test) | ✅ `auth.test` | ✅ Azure AD client-credentials token | ✅ `users/@me` |
| One-click connect | ⚠️ Implemented (Slack OAuth v2) — **requires server app credentials**, see below | ⚠️ Implemented (Azure AD admin consent) — **requires server app credentials** | ⚠️ Implemented (bot invite) — **requires server app credentials** |
| Approve / Revise / Reject buttons with mandatory reason | ⚠️ **Partial** — Block Kit + modal, for **governance gates** of the strategic cycle, on the server-wide app only (`/v1/connectors/slack/interactive`) | ⚠️ **Partial** — Adaptive Card + task module, same scope | ⚠️ **Partial** — components + modal, same scope |
| Arbitrate a **console mission** from the chat | ❌ Not implemented — the chat reply says arbitration is pending; arbitration happens in the console | ❌ Same | ❌ Same |
| Kayros account ↔ chat user link (rights come from Kayros, not from chat admin status) | ✅ Single-use token (`POST /v1/connectors/link`, `/link/:token`) | ✅ | ✅ |
| Long missions | ⚠️ The collective runs **synchronously inside the webhook request**; with slow models (Kimi K3) this exceeds Slack's 3-second acknowledgement window — retries are deduplicated, but an immediate ack + deferred post is **proposed** | ⚠️ Same constraint (Bot Framework expects a quick HTTP answer) — **proposed:** proactive reply | ⚠️ Discord requires an interaction response within 3 s — **proposed:** deferred response (type 5) + follow-up |

### Implementation conditions

**Common to the three (required):**
- `KAYROS_CONNECTOR_ENCRYPTION_KEY` — 32-byte base64 key (AES-256-GCM) on every backend instance; without it the console refuses to store any connector secret.
- `KAYROS_PUBLIC_API_URL` (e.g. `https://api.kayroslab.com`) — used to build each connection's webhook URL `…/v1/connectors/<platform>/configured/<connection_id>`, shown in console → Réglages.
- Public HTTPS reachability of `api.kayroslab.com` from the platform; a console **collective** bound to the channel (binding is owned by the conversational application, not by the console).
- To arbitrate from chat, each user links their chat identity to their Kayros account (single-use token); a chat admin gets no arbitration right by default.

| | Slack | Microsoft Teams | Discord |
|---|---|---|---|
| **Create the app** | Slack app (api.slack.com/apps) with a bot user | Azure Bot resource + Microsoft App ID / password (client secret), Teams channel enabled; a Teams app package (manifest) is **not in the repo** — to be created and uploaded by the tenant admin | Discord application with a bot (discord.com/developers); the `/kayros` slash command with a `question` option must be **registered manually** — no registration script in the repo |
| **Permissions / scopes** | Bot scopes `app_mentions:read`, `chat:write`, `im:history`, `channels:history`, `groups:history` (default of `SLACK_OAUTH_SCOPES`); events `app_mention`, `message.im` | Bot Framework messaging; admin consent on the Azure AD tenant (`TEAMS_OAUTH_TENANT`, default `organizations`) | OAuth scopes `bot applications.commands`, permissions integer `DISCORD_INVITE_PERMISSIONS` (default `534723950656`) |
| **URLs to configure on the platform** | Event Subscriptions **and** Interactivity Request URL = the connection's webhook URL (per tenant) or `/v1/connectors/slack/events` + `/v1/connectors/slack/interactive` (server-wide app) · OAuth redirect `/v1/connectors/slack/oauth/callback` | Messaging endpoint = connection webhook URL, or `/v1/connectors/teams/interactive` (server-wide) · admin-consent redirect `/v1/connectors/teams/oauth/callback` | Interactions Endpoint URL = connection webhook URL, or `/v1/connectors/discord/interactive` (server-wide) · redirect `/v1/connectors/discord/oauth/callback` |
| **Secrets — manual mode (console → Réglages → Configuration avancée)** | `bot_token` (`xoxb-…`), `signing_secret`, optional `webhook_url` | `app_id`, `bot_password`, optional `webhook_url` | `application_id`, `bot_token`, `public_key`, optional `webhook_url` |
| **Server env — one-click mode** | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` (+ `SLACK_OAUTH_SCOPES`) | `TEAMS_APP_ID`, `TEAMS_BOT_PASSWORD` (+ `TEAMS_OAUTH_TENANT`) | `DISCORD_CLIENT_ID` (or `DISCORD_APPLICATION_ID`), `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY` (+ `DISCORD_CLIENT_SECRET`, `DISCORD_INVITE_PERMISSIONS`) |
| **Server env — server-wide app (gate cards & buttons)** | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_GATE_CHANNEL`, optional `SLACK_WEBHOOK_URL` | `TEAMS_APP_ID`, `TEAMS_BOT_PASSWORD`, `TEAMS_GATE_CHANNEL`, optional `TEAMS_WEBHOOK_URL` | `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_GATE_CHANNEL`, optional `DISCORD_WEBHOOK_URL` |
| **Public API scope** | none — chat connectors do not use `kl_live_` keys | none | none |

> **Deployment note.** `.github/workflows/deploy-vps-backend.yml` currently injects `KAYROS_CONNECTOR_ENCRYPTION_KEY`
> but **none** of the `SLACK_*`, `TEAMS_*` or `DISCORD_*` variables, and it rewrites the server `.env` on every
> deploy. Until those secrets are added to the workflow, production offers the manual (token) mode only, and
> one-click connect stays unavailable.

**Alternative without a native app (not provided):** Slack, Teams and Discord can also be reached through n8n or
Zapier by subscribing to the Public API webhooks (`mission.completed`, `mission.arbitrated`) and posting to the
channel. No such workflow ships in `integrations/` today. Product thesis and detailed specs:
[SPECIFICATIONS_CONNECTEURS_CHAT.md](SPECIFICATIONS_CONNECTEURS_CHAT.md) ·
[SPECIFICATIONS_TECHNIQUES_CONNECTEURS.md](SPECIFICATIONS_TECHNIQUES_CONNECTEURS.md).

---

## Compose the committee.

*You don't pick one voice. You hear all of them.*

- **[Specialized agents](#complete-agent-operations) →** System agents (CFO, CTO, Legal…), custom experts and hybrid agents with consented stakeholder profiles — veto power included.
- **[Hybrid Agent Sales Oracle](#hybrid-agent-sales-oracle) →** Rehearse an executive decision or pressure-test a customer RFP against the buying committee before you answer.
- **[Novelty engine](#novelty--bisociation) →** Bisociation collisions ranked by embeddings, with a non-obvious Kayros Signature on each candidate.
- **[Positioner](#core-engine) →** Web, GitHub, GitLab and ArXiv scanning, ontology graph, competitor facts written to memory.

## Decide where the team works.

*Slack, Teams, Discord or the console — every channel becomes a decision room.*

- **[Agent console](#agent-console) →** Self-service workspace: harness sessions, agent registry (custom, hybrid and impersonator), persona teams, one-click channel connection, decision dossiers and Sales Oracle — no second login.
- **[Chat connectors](#chat-connectors-slack-microsoft-teams-discord) →** Slack (HMAC signatures, idempotence, Block Kit), Microsoft Teams (JWT RS256, Adaptive Cards), Discord (Ed25519) — see the real status and set-up conditions.
- **[Durable dossiers](#agent-console) →** Postgres-backed decision threads you can resume with new evidence, from the same collective.
- **[Human arbitration](#how-it-works) →** Accept the consensus, pass under conditions, or override a veto — every action recorded.
- **[Salesforce, n8n & Zapier](#public-api-v1) →** A stage change on an opportunity launches a mission through the Public API v1; the signed verdict comes back as a task on the opportunity.

## Keep the numbers honest.

*A forecast is a range — never a verdict.*

- **[Deterministic Monte-Carlo](#how-it-works) →** P10/P50/P90 from stated hypotheses; no number is invented.
- **[TimesFM 2.5](#backend-api) →** Optional KPI forecasting with uncertainty bands, tenant-scoped and labelled simulation.
- **[Epistemic tags](#core-engine) →** Observed, assumed or unknown — uncertainty travels with the claim.
- **[KPI drift](#core-engine) →** Reality diverging from the plan re-opens arbitration on its own.

## Stay inspectable.

*Your machines, your models, your audit trail.*

- **[Zero-dependency core](#core-engine) →** The decision engine runs on Node 20 with no npm dependencies.
- **[Layered memory](#memory-layers) →** L0–L3: working context, atomic facts, distilled scenarios, tenant norms.
- **[Governance](#gate--idea) →** Gates, RBAC, weighted votes and vetoes over an append-only audit trail.
- **[Local or cloud](#deployment) →** Ollama quant-aware locally, or governed cloud; JSON files or Postgres, per tenant.

---

## Where KayrosLab fits

| Criterion | Chat LLM | Innovation platform | **KayrosLab** |
|---|---|---|---|
| Structure | Conversation | Stage-gate | **Governed 8-step cycle** |
| Agents | One model | — | **Multi-agent** + Red Team + Bisociator |
| Memory | Session / flat | Tickets | **Layered L0–L3 + tenant scope** |
| Novelty | Implicit | Manual | **Embedding-ranked collisions + Kayros Signature** |
| Numbers | LLM guesses | Manual | **Deterministic** Monte-Carlo |
| Decision | Informal | Vote | **Vote instructs · veto decides** |
| Sovereignty | Cloud | Cloud | **Ollama quant-aware** or proxy |

| Category | Representative players | Where they excel | The gap KayrosLab fills |
|---|---|---|---|
| Innovation management suites | Brightidea · HYPE Innovation · ITONICS · Qmarkets · IdeaScale | Idea collection at scale, campaigns, stage-gate pipelines, impact tracking | Intelligence is organizational (workflow, scorecards), not governed multi-agent deliberation — no buyer-committee rehearsal, no veto mapping |
| Decision intelligence | Cloverpop and similar | Decision process structure, human+AI agents, decisions captured as a system of record | No adversarial rehearsal, no consented stakeholder simulation, no local sovereign deployment path |
| Chat LLM assistants | ChatGPT · Claude · Gemini | Fast drafting and one-model analysis | Session-only memory, no role boundaries, no evidence discipline, no gates or veto, no audit trail |
| Agent frameworks | LangChain / LangGraph · CrewAI · AutoGen | Build-your-own orchestration for dev teams | Governance, gates, console, memory and audit remain to be built; KayrosLab ships them — and hosts these frameworks as optional adapters |

**Position.** KayrosLab occupies the governed deliberation layer between conversation (chat LLMs),
collection (innovation suites) and custom builds (agent frameworks): role-bound agents, layered
memory L0–L3, deterministic numbers, human gates with veto — inspectable, deployable local or cloud.

---

## Get started

No heavy setup: create your workspace at **[kayroslab.com/console](https://www.kayroslab.com/console/)** —
self-service — and run your first committee from the browser. Or explore the
[public governed demo](https://www.kayroslab.com/kayroslab-complete-with-ai-agents.html) without an
account: semantic map, novelty-ranked exploration, full 8-agent cycle, PDF export.

<p align="center">
  <a href="https://www.kayroslab.com"><img src="assets/site-home.webp" alt="www.kayroslab.com — Your AI executive committee for high-stakes decisions" width="49%"></a>
  <a href="https://www.kayroslab.com/console/"><img src="assets/console-login.webp" alt="Console sign-in: Google, enterprise SSO or e-mail and password; self-service discovery workspace" width="49%"></a>
</p>
<p align="center"><sub><em>www.kayroslab.com and the console sign-in (Google, enterprise SSO, e-mail) — captured 9 Oct 2026.</em></sub></p>

<details>
<summary><b>Run the engine and the backend locally</b></summary>

<br/>

```bash
git clone https://github.com/Geoking2104/KayrosLab.git
cd KayrosLab/core && node --test          # zero-dependency decision core
node quant-ollama-demo.mjs llama3.2       # optional, needs Ollama

cd ../backend/fastify
cp .env.sample .env && npm install && node index.mjs   # http://localhost:8787
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

Open `cycle-timeline.html?api=http://localhost:8787` for the live cycle view, seed a demo idea with
`node core/seed-demo.mjs`, and point the console at your backend.

</details>

Prerequisites: Node.js 20+. Optional: [Ollama](https://ollama.com) for local inference and
embeddings, Postgres for multi-instance persistence.

---

## Your first decision in ten minutes

**1. Open the console.** [kayroslab.com/console](https://www.kayroslab.com/console/) — create your
workspace; signup is self-service with a verified e-mail, or sign in with Google or enterprise SSO (OIDC).

**2. Connect a channel (optional).** In **Réglages**, connect Slack, Microsoft Teams or Discord
in one click (server-side application credentials) — or fall back to manual tokens. Secrets are
stored encrypted server-side; channel-to-collective binding belongs to the separate conversational application.

**3. Compose the committee.** In **Agents**, start from the system agents — CFO, CTO, Legal — and
add custom experts or **hybrid agents** built from a consented Crystal Knows / LinkedIn profile
(API import, authorized export upload or manual entry). Grant veto power where a blocking opinion matters.

**4. Ask, then arbitrate.** From the **governed mission** workbench or a bound channel, ask the real question. Each
agent answers with a verdict, strengths, objections, conditions and metrics; the collective returns
a consensus dossier. Accept it, pass it under conditions, or override a veto — the dossier keeps
the whole story.

Deeper walkthrough: [pitch-seed](docs/pitch-seed.md) · [specialized swarms](docs/specialized-agent-swarms.md)

---

## The strategic cycle

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

**Two orthogonal axes:** *stage* = execution progress; *status* = decision state. Dormant statuses
(`en_pause`, `consideration_future`, `non_poursuivi`) are **reactivable** via
`POST /v1/cycle/reactivate`.

---

## Complete agent operations

KayrosLab does not hand one prompt to one model. It turns a decision into a governed operation:
evidence is collected, agents receive bounded roles, tools add verifiable facts or calculations,
opposing views are reconciled, and a human approves the result before action.

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

TimesFM is deliberately one tool inside this loop. It forecasts statistically plausible KPI
trajectories from at least 20 ordered observations; it does not replace deterministic business
scenarios, agent judgment or the human gate.

---

## Hybrid Agent Sales Oracle

A hybrid agent combines a governed business role with an authorized stakeholder profile. The role
supplies explicit decision rules; the profile can supply consented communication preferences, DISC
traits, decision triggers and objection patterns. Personality simulation is opt-in per swarm and
never changes the requirement for human arbitration.

<p align="center"><img src="assets/console-impersonator-swarm.webp" alt="A persona panel rehearsing a 12 % price increase: each simulated stakeholder returns CONDITIONAL GO with objections and conditions" width="85%"></p>

### Rehearse an executive decision

1. Upload the proposal, business case, metrics and constraints; every extracted claim keeps its source.
2. Compose a panel from built-in CFO, CTO, Legal, Risk and Operations agents, custom experts, or consented hybrids.
3. Run the cited corpus through `GO`, `CONDITIONAL_GO` and veto rules.
4. Review the friction map, requested evidence and simulated stakeholder reactions before the accountable executive decides.

### Pressure-test a customer RFP

1. Upload the RFP, response, pricing, security, contractual and delivery evidence into one controlled corpus.
2. Map the buying committee: sponsor, procurement, finance, security, legal, operations and technical evaluators.
3. Red-team the cited offer against each veto holder's explicit role rules and authorized decision triggers.
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

**Safeguards:** official connectors or authorized exports only; no LinkedIn scraping; explicit
consent and provenance; tenant isolation; no private-fact fabrication; simulated feedback is
labelled and cannot be presented as a real quote, endorsement or behavioral prediction.

### Integrated web tool

The [Hybrid Agent Sales Oracle workspace](https://www.kayroslab.com/console/) is embedded in the
agent console for provisioned customers — no second login, it reuses the console session:

1. Open the **Sales Oracle** tab in the [console](https://www.kayroslab.com/console/). The bearer token stays in browser memory only; it is never persisted to `localStorage`, cookies or the repository.
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

## Agent console

The [agent console](https://www.kayroslab.com/console/) is the operational surface where governed
decisions run day to day — in production, with self-service workspaces.

**Flow:** connect a channel → open a session and compose a collective → instruct the question → the
collective answers → humans arbitrate → resume with new evidence.

1. **Create a workspace in self service** — signup with verified e-mail (30-minute reset links) or Google / enterprise SSO ([docs/SSO.md](docs/SSO.md)), tenant-scoped space and per-tenant agent registry.
2. **Connect channels** — Slack, Microsoft Teams or Discord credentials stored encrypted server-side (`KAYROS_CONNECTOR_ENCRYPTION_KEY` required), connectivity test included; channel binding is owned by the separate conversational application, not by the console.
3. **Run the collective** — missions run asynchronously (the console shows « Mission en cours… » with per-agent progress); every question triggers individual agent analyses (verdict, strengths and opportunities, objections, required conditions, metrics) aggregated into a consensus dossier: `GO`, `CONDITIONAL_GO` or `NO_GO`.
4. **Arbitrate** — the verdict stays consultative until a human accepts the consensus, passes it under conditions, overrides a veto with justification, or requests re-evaluation; every action is recorded in the durable thread.
5. **Resume** — reply with new evidence or parameters to relaunch the same collective on the same dossier; Postgres-backed threads survive restarts and remain tenant-scoped.

| Console page | What it does |
|---|---|
| **Vue d'ensemble** (Overview) | Connection status, live metrics (sessions, active agents, executions, pending arbitrations), governed mission launcher |
| **Sessions** | Harness sessions: a stable collective, its execution log and its decision dossiers |
| **Agents** | Registry of system, custom, hybrid and **impersonator** agents: mission, constraints, decision rules, provider/model, tools, veto power. Filter by type (business / hybrid / impersonator). |
| **Impersonators** | **Persona simulation** agents rebuilt from authorised clues (LinkedIn profile, Crystal Knows report, authorised export or manual clues) with a **real portrait**, mandatory consent and five guardrails (labelled “Simulation”, never speak for the person, clues-only, idea-test purpose, no material decision). Create one agent, or **create a team of 2–12 impersonators** and open it as a session to test an idea against a whole stakeholder panel. |
| **Décisions** (Decisions) | Durable dossiers — analyses, objections, conditions, replies and arbitrations |
| **Sales Oracle** | Governed case workspace: create a case, upload the evidence corpus, follow ingestion — reuses the console session |
| **Intégrations** (Integrations) | API keys for the [Public API v1](#public-api-v1) (shown once, scoped, revocable), tenant webhook with HMAC signing secret, test ping, delivery log, default mission profile |
| **Réglages** (Settings) | **One-click SSO connect** (Slack OAuth v2, Microsoft Teams admin consent, Discord bot invite) with server-side application credentials, encrypted secrets at rest, connectivity tests, Crystal Knows capability state |

The console runs on the same governed runtime exposed by the API: a session, its dossiers, its
replies and its arbitrations form one durable, tenant-scoped audit trail.

**Version en ligne : 3 sessions par utilisateur et 3 agents construits par session.** Les agents
d'auteur (personnalités bâties sur la somme des œuvres du domaine public) comptent dans cette
limite ; les sources intégrées sont Project Gutenberg, NosLivres/efele, Ebooks libres et gratuits,
Wikisource et l'annuaire Bookatomy.

---

## How it works

### Strategic cycle

See [The strategic cycle](#the-strategic-cycle) above — eight steps, two orthogonal axes
(stage × status), KPI feedback looping Execute back into Listen.

### Novelty & Bisociation

The Bisociator agent generates structured collisions (Framework + Mechanism + Proposal + Bridge).
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

KayrosLab separates a **zero-dependency decision core** from **optional periphery adapters**.
Adapters may call into the core (`ToolRegistry`, memory, LLM); they never replace governance,
gates, or the strategic cycle.

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
  LLM --> P2[(NVIDIA NIM / Mistral / Anthropic)]
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
| `index.mjs` | `createEngine` — providers, memory, orchestrator, novelty injection |
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

Path: [`backend/fastify/`](backend/fastify/) — reuses `core/`. Full route inventory: [docs/API.md](docs/API.md#application-api-internal).
Only the [Public API v1](#public-api-v1) and the MCP endpoint are integration contracts; the
other routes serve KayrosLab's own front ends.

### LLM providers

`GET /health` exposes the live provider chain. Selection order: `LLM_PROVIDER` (forced) >
`NVIDIA_API_KEY` > `MISTRAL_API_KEY` > `ANTHROPIC_API_KEY` > mock. Production runs NVIDIA NIM
(OpenAI-compatible) with `moonshotai/kimi-k3`, the `fast` profile on `nvidia/nemotron-3.5-lightning-30b-a3b`,
Mistral then mock as signalled fallbacks, bounded concurrency and 429 backoff; embeddings use `bge-m3`
on a local Ollama. Every fallback is flagged (`degraded`, `llm.mock`). See
[backend/fastify/DEPLOY-VPS.md](backend/fastify/DEPLOY-VPS.md).

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

| Domain | Endpoints |
|---|---|
| **Cycle SSE** | `POST /v1/cycle/run` · `POST /v1/cycle/reactivate` · `GET /v1/cycle/status` |
| **Memory** | `GET\|POST /v1/memory/l3` · `GET /v1/memory/ideas/:id` · `POST /v1/memory/promote` · `POST /v1/memory/save` |
| **Positioning** | analyze, search, GitHub, ArXiv, OWL, `GET /v1/positionning/ontology` |
| **Governance** | `POST /v1/ideas/:id/gates` · `GET /v1/gates` · `POST /v1/gates/:id/resolve` |
| **Specialized swarms** | `GET\|POST /v1/swarm/agents` · `POST /v1/swarm/configurations` · `POST /v1/swarm/configurations/:swarmId/run` · `GET /v1/swarm/runs/:id` · `GET /v1/swarm/runs/:id/dossier` · `POST /v1/swarm/runs/:id/arbitrate` |
| **Hybrid profiles** | `POST /v1/swarm/agents/:agentId/personality/import` |
| **Sales Oracle documents** | `POST\|GET /v1/sales-oracle/cases` · `POST /v1/sales-oracle/cases/:id/documents/uploads` · `POST /v1/sales-oracle/cases/:id/documents/:documentId/complete` · document list/status |
| **TimesFM forecasts** | `GET /v1/forecast/status` · `POST /v1/ideas/:id/forecast` · `GET /v1/ideas/:id/forecasts` |
| **Public API v1** | `GET /v1/public/me` · `GET /v1/public/collectives` · `POST /v1/public/missions` · `GET /v1/public/missions/:id` · `GET /v1/public/missions?external_ref=` · `GET /v1/public/openapi.json` · `GET /docs` — see [docs/API.md](docs/API.md) |
| **Console integrations** | `GET /v1/console/integrations` · `POST /v1/console/integrations/keys` · `DELETE /v1/console/integrations/keys/:keyId` · `PUT /v1/console/integrations/webhook` · `POST /v1/console/integrations/webhook/{secret,test}` · `GET /v1/console/integrations/deliveries` |
| **Developer Portal MCP** | `POST /mcp` — scoped Streamable HTTP tools, resources and prompt for agentic API consumers |
| **Agent Console** | `GET /v1/console/overview` · agents CRUD (+ human profile import/upload) · **impersonator agents** (`POST /v1/console/impersonators`) and **impersonator teams** (`POST /v1/console/impersonator-teams`) · connectors (one-click connect / configure / test) · sessions (harness) · `POST /v1/console/sessions/:sessionId/run` (202, async) · threads · `POST /v1/console/threads/:threadId/messages` (202) · `POST /v1/console/threads/:threadId/arbitrate` |
| **Contact** | `POST /v1/contact` — public contact request (honeypot, per-IP rate limit, e-mail routed server-side) |
| **Auteurs du domaine public** | `GET /v1/literary/authors` · `GET /v1/literary/sources` · `GET /v1/literary/search?q=` — recherche temps réel (Gutenberg, NosLivres/efele, EbooksGratuits, Wikisource) · `POST /v1/literary/authors/:authorId/agent` · `POST /v1/literary/agents` — personnalité d'agent construite depuis la somme des œuvres du domaine public (txt/html/epub) + portrait |
| **Connectors** | Slack events + interactive · Discord `/kayros` · Teams Bot Framework messages · link tokens |
| LLM & tools | `POST /v1/llm` · `POST /v1/embed` |
| Auth | `/v1/auth/` register · login · logout · me · password forgot/reset · SSO (`GET /v1/auth/sso`, `POST /v1/auth/sso/start`, `POST /v1/auth/sso/callback`) — Google and enterprise OIDC |
| Salon | `/v1/salon/state` · `/v1/salon/translate` · `/v1/salon/kb/*` · `/v1/salon/x/*` · `/v1/salon/whatsapp/*` — see [docs/SALON.md](docs/SALON.md) |
| Health & metrics | `GET /health` (public: provider chain, persistence, SSO, SMTP — no secrets) · `GET /metrics` (Prometheus, `METRICS_TOKEN` or loopback) |
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
| `frontend/console-app` | **Production agent console** (served at `/console/`) — self-service signup, Slack/Teams/Discord room binding, agent registry with veto & hybrid profiles, durable decision dossiers, Sales Oracle tab, human arbitration. Do not overwrite. |
| `backend/web/public/salon/` | **Salon** (served at `/salon/`) — literary/philosophical circles. Not Slack rooms. |
| `crates/salon-core` | Rust protocol for Salon (`evaluate` → WASM) |

---

## Configuration

See `backend/fastify/.env.sample` and `core/OLLAMA.md`.

Key environment variables:

| Variable | Role |
|---|---|
| `NVIDIA_API_KEY` · `NVIDIA_MODEL` · `NVIDIA_FAST_MODEL` | Primary LLM provider (NVIDIA NIM); production model `moonshotai/kimi-k3`, `fast` profile model |
| `MISTRAL_API_KEY` · `ANTHROPIC_API_KEY` | Fallback LLM providers |
| `LLM_PROVIDER` · `LLM_FALLBACK` · `LLM_MAX_CONCURRENCY` · `LLM_MAX_RETRIES` | Force a provider, override the fallback chain, concurrency and 429 retries |
| `KAYROS_CONSOLE_RUN_TIMEOUT_MS` | Max duration of an async console mission (default 30 min) |
| `OIDC_ISSUER` · `OIDC_CLIENT_ID` · `OIDC_CLIENT_SECRET` | Enterprise SSO (Authelia at `sso.kayroslab.com`) |
| `GOOGLE_OAUTH_CLIENT_ID` · `GOOGLE_OAUTH_CLIENT_SECRET` | "Sign in with Google" on the console |
| `KAYROS_PUBLIC_API_URL` · `KAYROS_PUBLIC_RATE_LIMIT` · `KAYROS_PUBLIC_MISSIONS_PER_DAY` | Public API v1 base URL and limits |
| `KAYROS_WEBHOOK_ALLOW_HTTP` · `KAYROS_WEBHOOK_ALLOW_PRIVATE` · `KAYROS_MISSION_QUEUE` | Webhook SSRF guards (keep `false` in prod) and durable mission queue |
| `METRICS_TOKEN` | Bearer token for `/metrics` (otherwise loopback only) |
| `LINKEDIN_ACCESS_TOKEN` | Optional official LinkedIn authenticated-member profile import |
| `CRYSTALKNOWS_API_TOKEN` | Optional Crystal Knows Data API key (server-side only) for real-personality import |
| `CRYSTALKNOWS_API_VERSION` · `CRYSTALKNOWS_ALLOW_PREDICTIONS` · `CRYSTALKNOWS_API_BASE` | `v4` (default) or legacy `v1`; opt-in paid async predictions; base URL override |
| `KAYROS_SHARED_TENANT_IDS` | Comma-separated tenants whose agent registry is shared by unrelated self-service accounts (default `default`): real personality profiles are never published to their registry |
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

### Production topology

| Host | Serves | How |
|---|---|---|
| `www.kayroslab.com` | Landing, demos, whitepapers, console SPA (`/console/`), Salon (`/salon/`) | GitHub Pages (`CNAME`) |
| `api.kayroslab.com` | Fastify backend, Public API v1, `/docs`, `/mcp`, `/health` | OVH VPS — nginx → PM2 `kayros-api` on port 8787, local Postgres, Ollama `bge-m3` |
| `sso.kayroslab.com` | OpenID Connect provider (Authelia) | VPS — `setup-ssl-sso.yml`, [docs/SSO.md](docs/SSO.md) |
| `n8n.kayroslab.com` | Self-hosted n8n for the Salesforce integration | VPS — `setup-n8n-vps.yml`, [integrations/n8n/README.md](integrations/n8n/README.md) |

Monitoring: single-node Prometheus + Alertmanager (Slack routing) + Grafana in [`monitoring/`](monitoring/README.md),
loopback-only, with deployment silences.

### OVH VPS (backend)

```bash
# On the VPS after setting DATABASE_URL in backend/fastify/.env
bash deploy/ovh-vps/deploy-backend.sh
bash deploy/ovh-vps/install-cron-backup.sh
```

CI: `.github/workflows/deploy-vps-backend.yml` (SSH + PM2, port **8787**) — a merge on `main` rewrites the
server `.env` from GitHub secrets (NVIDIA / Mistral / Anthropic keys, OAuth clients, SMTP, metrics token) and reloads PM2.

| Tier | Description | Status |
|---|---|---|
| **P0** | Standalone offline (mock) | ✅ |
| **P1** | Local sovereign — Ollama quant-aware | ✅ |
| **P2** | Governed cloud — Fastify + optional Postgres | ✅ |

Also see [RUNBOOK.md](RUNBOOK.md).

---

## Development & tests

```bash
# Engine unit tests (zero dependency)
cd core && node --test

# Backend (Fastify routes, public API, console, auth)
cd backend/fastify && npm ci && npm test

# Site, Salon, deployment and integration checks (from the repo root)
node --test tests/*.test.mjs
```

CI workflows (`.github/workflows/`): `core-tests.yml`, `backend-tests.yml`, `pg-tests.yml` (Postgres
stores incl. integrations), `integrations-check.yml` (n8n workflows), `i18n-check.yml`,
`monitoring-config.yml`.

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
| **v21** | **Governed agent console in production** — self-service signup, encrypted connector secrets, Slack/Teams/Discord room binding, Postgres-backed durable decision threads with human arbitration | ✅ |
| **v22** | **NVIDIA NIM LLM + async missions** — Kimi K3 primary with Mistral fallback, 429 robustness, asynchronous console missions with progress, Prometheus/Alertmanager monitoring | ✅ |
| **v23** | **Public API v1 & CRM integrations** — per-tenant API keys, `demo`/`fast`/`deep` profiles, HMAC-signed webhooks with durable retries, OpenAPI 3.1 + `/docs`, console Intégrations page, Salesforce PoC via n8n / Zapier, Google sign-in | ✅ |

---

## Documentation

| I want to… | Start here |
|---|---|
| Understand the engine modules and API | [core/README.md](core/README.md) · [engine architecture](docs/engine-architecture.md) |
| Run local, quant-aware inference | [core/OLLAMA.md](core/OLLAMA.md) |
| Operate in production | [RUNBOOK.md](RUNBOOK.md) |
| Compose swarms, hybrid agents and Sales Oracle cases | [docs/specialized-agent-swarms.md](docs/specialized-agent-swarms.md) |
| Call the API (Public API v1, webhooks, route inventory) | **[docs/API.md](docs/API.md)** · [OpenAPI spec](docs/openapi/kayroslab-public-v1.json) · [live docs](https://api.kayroslab.com/docs) |
| Connect Salesforce through n8n or Zapier | [integrations/README.md](integrations/README.md) |
| Connect Codex, Claude Code or Cursor | [Developer Portal MCP](docs/developer-portal-mcp.md) |
| Read the functional and technical specs | [SPECIFICATIONS_FONCTIONNELLES.md](SPECIFICATIONS_FONCTIONNELLES.md) · [SPECIFICATIONS_TECHNIQUES.md](SPECIFICATIONS_TECHNIQUES.md) |
| Follow the Slack / Teams / Discord product thesis | [SPECIFICATIONS_CONNECTEURS_CHAT.md](SPECIFICATIONS_CONNECTEURS_CHAT.md) |
| Use the optional adapters | [backend/adapters/README.md](backend/adapters/README.md) |
| Understand TimesFM forecasting | [docs/TIMESFM_FORECASTING.md](docs/TIMESFM_FORECASTING.md) |
| Run the demo end to end | [docs/pitch-seed.md](docs/pitch-seed.md) |
| Track releases | [CHANGELOG.md](CHANGELOG.md) |
| Dig into past iterations | [docs/v13-slack-ontology.md](docs/v13-slack-ontology.md) · [docs/v14-slack-ontology.md](docs/v14-slack-ontology.md) |

---

## Why "KayrosLab"?

**Kairos** (καιρός) is ancient Greek for the opportune moment — not the time on the clock, but the
fleeting instant when conditions align and acting makes the difference. Chronos tells you it is
Tuesday; kairos tells you it is time.

Most organisations decide on chronos: the quarterly committee, the roadmap review, the loudest
opinion. KayrosLab exists to find the kairos in your evidence — and to tell you, with objections and
numbers attached, whether the moment is now, now under conditions, or not yet. The lab in the name
is the governed workshop where that question gets rehearsed before reality runs the experiment.

The longer narrative lives in the [whitepaper](https://www.kayroslab.com/whitepaper-kayroslab.html).

---

## Contact

**Geoffroy de La Tournelle** — Founder & Director, KayrosLab
[geoffroydelatournelle@gmail.com](mailto:geoffroydelatournelle@gmail.com) · [LinkedIn](https://www.linkedin.com/in/gdelatournelle/)

---

## License

Proprietary — © KayrosLab / Geoffroy de La Tournelle. All rights reserved unless otherwise stated in writing.

---

*KayrosLab — Turning noise into governed strategy.*
