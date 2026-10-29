<div align="center">

# KayrosLab

**The governed decision workshop that turns one strategic question into a board-ready verdict.**

You state the decision. A committee of specialized agents with opposing duties investigates the evidence, challenges assumptions, and consolidates objections into a clear verdict — **GO, conditional GO, or NO-GO**. The verdict stays consultative until a human arbitrates. Every claim, source, condition and vote stays in a durable, inspectable dossier.

[![Website](https://img.shields.io/badge/Website-kayroslab.com-0ea5e9?style=flat-square)](https://www.kayroslab.com)
[![Console](https://img.shields.io/badge/Console-Live-2563eb?style=flat-square)](https://www.kayroslab.com/console/)
[![API](https://img.shields.io/badge/API-v1_docs-0f766e?style=flat-square)](https://api.kayroslab.com/docs)

[Try the console](https://www.kayroslab.com/console/) · [Website](https://www.kayroslab.com) · [API docs](https://api.kayroslab.com/docs) · [Contact](mailto:contact@kayroslab.com)

</div>

<p align="center">
  <img src="assets/readme/console-company.webp" alt="KayrosLab console company dashboard: active projects, decisions to arbitrate, collectives and library counters" width="100%">
</p>
<p align="center"><sub><em>The company dashboard: every project with its decision cases, what is waiting for arbitration and what is still under review. Verdicts stay advisory until a human arbitrates.</em></sub></p>

---

## Why KayrosLab exists

Most strategic decisions are made in a meeting where the strongest voice wins and the numbers are adjusted afterwards. Nobody can reconstruct why the decision was taken — until it is too late.

KayrosLab changes the sequence:

1. **You pose one real decision.**
2. **A collective of agents with opposing duties** (finance, legal, engineering, sales…) investigates the evidence and attacks each other's assumptions.
3. **They return a structured verdict** with objections, conditions and a recommendation.
4. **A human arbitrates** — accepts, attaches conditions, or overrides a veto. Everything is recorded.

The result is not a chatbot answer. It is a **governed dossier** you can reopen, audit and defend.

---

## How it works — the 4-step journey

| Step | What happens | What you get |
|------|--------------|--------------|
| **1. The question** | You state the decision in plain language. | A clear mission scoped to one outcome. |
| **2. The collective** | Specialized agents investigate from their duty, not from a single agreeable model. | Objections, ranges, conditions and a consolidated verdict. |
| **3. The verdict** | GO, conditional GO or NO-GO — always consultative. | An inspectable dossier with sources and justifications. |
| **4. Your arbitration** | You accept, condition or override. A veto can block. | An append-only trail ready for the board or the next steering. |

The same process runs from the web console, Slack, Microsoft Teams or Discord.

---

## What the live console shows today

On [kayroslab.com/console](https://www.kayroslab.com/console/), four entries:

| Entry | What you do there |
|-------|-------------------|
| **Company** | Dashboard per company: active projects, cases to arbitrate, cases under review, collectives, skills and context. *Today* lists the next action per open case. |
| **Projects** | Each project carries a **decision graph** you edit like an n8n workflow: question → collectives (in parallel or in sequence) → individual agents → consensus gates (threshold, unanimity, veto) → human arbitration → notification → decision. Nodes are dragged freely, and statuses update live while the run moves forward. Context cascades from company to project to node. Stakeholders (decision maker, sponsor, consulted, informed) receive the decision by email. |
| **Library** | Agents (full form: role, mission, instructions, constraints, tools, model, veto), collectives, versioned **skills** you can restore, and **context sources** (notes, documents, URLs, policies). |
| **Settings** | Connections (Slack, Teams, Discord, Salesforce via API, CrystalKnows export), **members and roles**, workspace. |

<table>
<tr>
<td width="50%"><img src="assets/readme/console-project-graph.webp" alt="Project decision graph with parallel collectives, a veto gate and the decision node"><br><sub>Decision graph: parallel collectives, consensus gate with veto, cascading context.</sub></td>
<td width="50%"><img src="assets/readme/console-library.webp" alt="Library: versioned skills linked to agents and collectives"><br><sub>Library: versioned skills attached to agents and collectives.</sub></td>
</tr>
<tr>
<td width="50%"><img src="assets/readme/console-members.webp" alt="Members and roles: COMEX, Admin, Contributor, Viewer, email invitations"><br><sub>Members: four roles and email invitations.</sub></td>
<td width="50%"><img src="assets/api-docs.webp" alt="Public API v1 documentation"><br><sub>Public API v1, to launch a mission from your CRM or automation.</sub></td>
</tr>
</table>

### How a project runs

- **Parallel branches, joined.** Independent collectives run at the same time, and the next step waits for all of them.
- **Gates stop the flow.** When a gate blocks, the sibling branches still running are suspended and their LLM missions are cancelled, so no tokens are spent for nothing. A COMEX member or an admin lifts the gate with a written justification, and the suspended branches restart.
- **Arbitration branch by branch.** A step can pause for human approval. Each branch waiting for approval gets its own *Approve and continue* button.
- **Temporary composition.** Agent nodes join a collective only for the duration of the mission. The original composition is restored afterwards, even after a server restart or a crash in another process (missions send a heartbeat).
- **Eight-step cycle.** Listen → Map → Build → Position → Test → Arbitrate → Project → Deliver, shown above the graph.

### Roles

| Role | Can |
|------|-----|
| **Admin** | Everything, including members and connections |
| **COMEX** | Arbitrate, lift gates, override a veto |
| **Contributor** | Create projects, run missions, edit the library |
| **Viewer** | Read only. Chat accounts not linked to a member also get this role. |

### English / French

The console ships in **English and French** (EN/FR switch in the header, saved in the browser). User content is never translated.

Every sensitive step can pause for a human. Forecasts are labelled simulations. Secrets stay encrypted. You choose local or cloud per workspace.

---

## The innovation

KayrosLab is the missing layer between conversation and action.

| Approach | What it gives | What is missing |
|----------|---------------|-----------------|
| Chat assistants | Fast answers | No role boundaries, no evidence discipline, no gates, no durable dossier |
| Innovation suites | Idea collection at scale | Weak multi-agent deliberation and human arbitration |
| DIY agent stacks | Orchestration | No memory, console, audit trail or veto by default |

KayrosLab ships the full decision workshop: opposing duties, inspectable reasoning, human gates with veto, and a dossier that survives the meeting.

---

## Trust & control

- **Human gates & veto** — sensitive output pauses for a human. Weighted votes instruct; a veto can block. Append-only trail.
- **Honest numbers** — forecast bands are labelled simulations from stated hypotheses.
- **Tenant isolation** — workspaces, dossiers and memories stay scoped to your organization. Secrets encrypted at rest.
- **Roles enforced server-side** — viewer, contributor, COMEX and admin permissions are checked by the API, not only hidden in the UI. API keys without an owner are refused.
- **Local or cloud** — keep inference on your infrastructure or run a governed cloud. You choose per workspace.

No scraped profiles. No black-box verdicts.

---

## Where it fits

KayrosLab is built for the moment a decision must move from conversation to commitment — with evidence, objections and accountability attached.

Typical uses:
- Launch or pause a project
- Accept or refuse a commercial concession
- Pressure-test a customer RFP against the buying committee
- Prepare a board or steering committee with the objections already surfaced

---

## For technical teams

The public pitch stays buyer-facing. Architects and builders can go deeper:

- Public repository (this one)
- Whitepaper
- Live multi-agent demo
- Public API v1 (`https://api.kayroslab.com/docs`) — launch a mission from your CRM or automation and receive the verdict
- Native Slack, Teams and Discord connectors
- Console API under `/v1/console/*`: companies, projects and their graphs, pipelines (`/projects/:id/pipelines`, `resume`, `approve`, `cancel`), skills, contexts, members and invitations. Details in [`docs/CONSOLE-HYBRID-AGENTS.md`](docs/CONSOLE-HYBRID-AGENTS.md)
- Durable async runs with cancellation (`AbortSignal` propagated down to the LLM call) and multi-process-safe recovery

See the existing detailed technical sections further down in this README for API, connectors and architecture.

---

## Get started

1. Open the [console](https://www.kayroslab.com/console/).
2. Pose one real decision.
3. Let the collective instruct it.
4. Arbitrate the verdict.

Or [book a conversation](mailto:contact@kayroslab.com).

---

*KayrosLab — crash-test your strategic decisions before the real world does.*
