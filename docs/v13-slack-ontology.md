# v13 — Deeper Slack connectors · Ontology graph

## Slack (beyond webhook text)

Existing stack: `core/connectors.mjs` (`SlackAdapter`, `ConnectorService`, `AccountLinkService`) + `POST /v1/connectors/slack/interactive`.

**Deepened in this release**

| Item | Detail |
|---|---|
| Signature gate | Route rejects requests when `SLACK_SIGNING_SECRET` is set and HMAC fails |
| Idempotence (EF-92) | `createIdempotenceStore` + `slackInteractionId` — double-clicks on Approve are no-ops |
| Platform ids | Canonical `slack:U123` via `platformUserId` for account link lookups |
| Env sample | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_WEBHOOK_URL`, `SLACK_GATE_CHANNEL` |

**Still required for production marketplace**

1. Store account links on disk/Postgres (today: in-memory `AccountLinkService`).
2. Modal flow for revise/reject **reason** (view submission → `governance.resolve` with motif).
3. Message update after resolve (`chat.update` with result view).
4. Vote slash command + KPI drift alert (EF-100–108).

Thesis remains: Slack is an **arbitration room**, not an idea inbox. See `SPECIFICATIONS_CONNECTEURS_CHAT.md`.

## Ontology graph in the demo surface

| Surface | Change |
|---|---|
| `GET /v1/positionning/ontology` | Adds `graph: { nodes, edges, elements }` (Cytoscape-ready) |
| `core/positionning/ontology-graph.mjs` | Pure builder from `ENTITY_TYPES` / `RELATIONSHIPS` |
| `ontology-explorer.html` | Force-directed Cytoscape view + filter tech/business + card list |
| Main demo | Link from explorer header; Positioner step still embeds interactive map (existing semantic + ontology note) |

```bash
cd core && node --test connectors-slack-deep.test.mjs positionning/ontology-graph.test.mjs
```
