# v14 — Persist links · Motif modal · Message update · Ontology embed

## Account links on disk / Postgres

`AccountLinkService` accepts an optional durable store:

| Backend | Env | Module |
|---|---|---|
| JSON file | `KAYROS_LINKS_FILE` | `FileAccountLinkStore` |
| Postgres | `DATABASE_URL` + table `kayros_account_links` | `PgAccountLinkStore` |
| Memory | (default) | in-process Map |

Link flow unchanged: `POST /v1/connectors/link` → token → `POST /v1/connectors/link/:token`.

## Motif modal (reject / revise)

1. User clicks **Reject** or **Revise** on a gate Block Kit message.
2. API responds with `response_action: push` and a modal (`buildMotifModal`) requiring a plain-text **motif**.
3. `view_submission` (`callback_id: gate_motif:{decision}:{gateId}`) calls `governance.resolve` with `reason`.
4. Idea stage/status updated via existing `applyGateResolution` path in `ConnectorService`.

## Message update

After resolve, if the interaction carried `message.ts` + channel, the bot calls `chat.update` with `buildGateResultView` so the original card no longer shows live action buttons.

## Ontology in main demo

- Dedicated surface: [`ontology-explorer.html`](../ontology-explorer.html) (Cytoscape).
- Main demo footer links to the explorer; optional inline panel: [`ontology-panel.html`](../ontology-panel.html) (static sample + link).

```bash
cd core && node --test connectors-motif.test.mjs connectors-slack-deep.test.mjs
```
