# KayrosLab API

Reference for the HTTP surfaces exposed by **api.kayroslab.com** (Fastify backend, `backend/fastify/`).

| Surface | Audience | Auth | Stability |
|---|---|---|---|
| [Public API v1](#public-api-v1) — `/v1/public/*` | CRMs and automation tools (Salesforce via n8n / Zapier, Make…) | API key `kl_live_…` | **Stable, documented in OpenAPI 3.1** |
| [Developer Portal MCP](#developer-portal-mcp) — `/mcp` | Agentic clients (Codex, Claude Code, Cursor) | MCP bearer token | Stable, scoped |
| [Application API](#application-api-internal) — `/v1/*` | The console, the Salon and the public demos | Console session (Bearer) or public demo routes | Internal — may change without notice |

| Resource | URL |
|---|---|
| Base URL (production) | `https://api.kayroslab.com` |
| Readable reference (quick start + interactive Scalar viewer) | https://api.kayroslab.com/docs |
| OpenAPI 3.1 specification | https://api.kayroslab.com/v1/public/openapi.json |
| Spec source in this repo | [`openapi/kayroslab-public-v1.json`](openapi/kayroslab-public-v1.json) (served as-is; `servers` rewritten from `KAYROS_PUBLIC_API_URL`) |
| Health | `GET https://api.kayroslab.com/health` (public) |
| Salesforce PoC in 15 minutes | [`integrations/n8n/README.md`](../integrations/n8n/README.md) · Zapier variant: [`integrations/zapier/README.md`](../integrations/zapier/README.md) |
| Architecture of the integrations | [`ARCHITECTURE-CONSOLE-INTEGRATIONS.md`](ARCHITECTURE-CONSOLE-INTEGRATIONS.md) |
| Operations (keys, webhooks, troubleshooting) | [`RUNBOOK.md`](../RUNBOOK.md) § Intégrations |

> The OpenAPI file is the contract. If this page and the spec ever disagree, the spec wins — update both in the same PR.

---

## Public API v1

A small, stable surface to launch a **mission** on a console **collective** (a console session and
its agents) from an external tool, then read back the verdict — `GO`, `CONDITIONAL_GO` or `NO_GO` —
with risks, conditions, each agent's opinion and a link to the full dossier. Missions run through the
same gateway as the console: they appear in the console and are **arbitrated there by a human**.

Implementation: [`backend/fastify/routes/public-api.mjs`](../backend/fastify/routes/public-api.mjs),
[`backend/fastify/routes/public-docs.mjs`](../backend/fastify/routes/public-docs.mjs),
[`core/integrations/`](../core/integrations/) (API keys, profiles, missions, webhooks, durable queue),
schema [`core/sql/migrations/20261009_public_api_integrations.sql`](../core/sql/migrations/20261009_public_api_integrations.sql).

### Endpoints

| Method | Path | Scope | Purpose |
|---|---|---|---|
| `GET` | `/v1/public/me` | any valid key | Connection test: tenant, key, service account, scopes, allowed collectives, profiles |
| `GET` | `/v1/public/collectives` | `collectives:read` | Active collectives usable by the key (id, name, voting threshold, agents with role / persona / veto) |
| `POST` | `/v1/public/missions` | `missions:write` | Launch a mission — **`Idempotency-Key` header required** — returns `202` |
| `GET` | `/v1/public/missions/{mission_id}` | `missions:read` | Status and flat verdict of one mission |
| `GET` | `/v1/public/missions?external_ref=…&limit=…` | `missions:read` | Missions attached to a CRM object (`limit` 1–100, default 20) |
| `GET` | `/v1/public/openapi.json` | none | OpenAPI 3.1 specification |
| `GET` | `/docs` | none | Human-readable reference |

### Authentication

1. In the console, open **Intégrations → Clés d'API** (role `comex` or `admin`) and create a key. The
   full token is shown **once**; KayrosLab stores only its SHA-256 fingerprint.
2. Send it as `Authorization: Bearer kl_live_<prefix>_<secret>` **or** `X-Api-Key: kl_live_…`.

Keys are tenant-scoped, revocable, can expire (`expires_in_days`), and can be restricted to a list of
collectives (empty list = every collective of the tenant).

| Scope | Granted by default | Allows |
|---|---|---|
| `missions:write` | ✅ | `POST /v1/public/missions` |
| `missions:read` | ✅ | `GET /v1/public/missions…` |
| `collectives:read` | ✅ | `GET /v1/public/collectives` |
| `webhooks:manage` | — | Reserved scope (accepted on keys) |

### Execution profiles

| Profile | Engine | Typical duration | Use |
|---|---|---|---|
| `demo` | Prepared answers per role, no LLM call | < 5 s | Test the Salesforce ↔ n8n ↔ KayrosLab wiring. Labelled `[Démo]`, `llm.simulated = true` — **never use it to decide** |
| `fast` *(default)* | Fast NVIDIA model (`NVIDIA_FAST_MODEL`, default `nvidia/nemotron-3.5-lightning-30b-a3b`) | 1–2 min | Real verdict for integrations |
| `deep` | Server LLM configuration (production: NVIDIA NIM `moonshotai/kimi-k3`) | ~12 min | Sensitive deals |

If the fast provider is unavailable (no `NVIDIA_API_KEY`), `fast` falls back to the server configuration;
the response says so (`note`, `llm.profile`). The `202` response carries an `eta_seconds` estimate.

### Launch a mission

```bash
curl -s https://api.kayroslab.com/v1/public/missions \
  -H "Authorization: Bearer $KAYROS_API_KEY" \
  -H "Idempotency-Key: sf-0065g00000XyZabAAF-Proposal" \
  -H "Content-Type: application/json" \
  -d '{
        "collective_id": "room_…",
        "question": "Faut-il signer ACME à -15 % ?",
        "profile": "fast",
        "external_ref": "salesforce:Opportunity:0065g00000XyZabAAF",
        "callback_url": "https://n8n.example.com/webhook-waiting/123",
        "callback_events": ["mission.completed", "mission.failed"],
        "metadata": { "amount": 120000, "stage": "Proposal/Price Quote", "account": "ACME" }
      }'
```

| Field | Required | Notes |
|---|---|---|
| `collective_id` | ✅ | From `GET /v1/public/collectives` |
| `question` | ✅ | 3–12 000 characters |
| `context` | | Free text passed to the collective (≤ 24 000) |
| `profile` | | `demo` · `fast` (default) · `deep` |
| `external_ref` | | `"system:object:id"` string or `{ system, object?, id, url? }` |
| `callback_url` | | HTTPS, public host only (anti-SSRF). Receives this mission's signed events |
| `callback_events` | | Subset of `mission.completed`, `mission.failed`, `mission.arbitrated` (default: all). With an n8n **Wait** node pass `["mission.completed","mission.failed"]` — its resume URL works only once |
| `metadata` | | Flat CRM fields (string / number / boolean / null), added to the context and echoed back |

**Idempotency.** Replaying the same request with the same `Idempotency-Key` returns the existing mission
(`200`, header `idempotent-replayed: true`); the same key with a different body returns `409
idempotency_key_reused`. Recommended key for Salesforce: `sf-<OpportunityId>-<StageName>`.

### Mission lifecycle

`POST` → `202` (`state: running`, `poll_url`) → either poll `GET /v1/public/missions/{id}` until
`state != running`, or wait for the signed webhook.

| `state` | Meaning |
|---|---|
| `running` | The collective is working (`progress: { completed, total }`) |
| `completed` | Collective verdict available — **human arbitration pending** in the console |
| `failed` | Mission failed (`error` explains why) |
| `arbitrated` | A human decided in the console (`human_decision`) |

Main response fields: `mission_id`, `status` (internal thread status), `state`, `verdict`
(`GO` · `CONDITIONAL_GO` · `NO_GO` · `NEEDS_CLARIFICATION` · `null`), `verdict_label`, `summary`,
`risks[]`, `conditions[]`, `clarification_questions[]`, `agents[]` (`agent_id`, `name`, `role`,
`verdict`, `reason`, `persona`), `human_decision`, `llm` (`provider`, `profile`, `simulated`,
`degraded`), `dossier_url` (console link `…/console/#activity?thread=…`), `external_ref`, `metadata`,
`created_at`, `updated_at`. Full schemas: `components.schemas` in the spec.

### Webhooks

Two destinations can receive mission events: the mission's `callback_url`, and the tenant subscription
URL configured in **console → Intégrations** (events filterable, secret revealable / rotatable, test
ping, delivery log).

| Header | Content |
|---|---|
| `X-Kayros-Signature` | `t=<unix>,v1=<hex>` with `v1 = HMAC-SHA256(secret, t + "." + raw body)` |
| `X-Kayros-Event` | `mission.completed` · `mission.failed` · `mission.arbitrated` · `ping` |
| `X-Kayros-Event-Id` | Unique event id — **deduplicate on it** |
| `X-Kayros-Delivery` · `X-Kayros-Attempt` | Delivery id and attempt number |

Body: `{ event, event_id, occurred_at, tenant_id, …Mission }`.

Receiver rules: verify the signature on the **raw body**, reject timestamps more than **5 minutes** off,
answer `2xx` within **10 s**. Otherwise KayrosLab retries at 1 min, 5 min, 30 min, 2 h and 6 h
(6 attempts in total) from a durable outbox. Answer `410` to stop retrying a delivery.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyKayros(secret, rawBody, header, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1 || '', 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

The reference verifier (which also accepts several `v1=` values, for secret rotation) is `verifySignature` in
[`core/integrations/webhooks.mjs`](../core/integrations/webhooks.mjs).

### Errors and limits

Errors are JSON `{ error, code, issues?, mission_id? }`.

| HTTP | `code` examples | When |
|---|---|---|
| `400` | `idempotency_key_required`, `invalid_request`, `invalid_callback_url`, `invalid_external_ref`, `mission_not_started` | Bad header / body |
| `401` | e.g. `api_key_revoked` | Missing, invalid, revoked or expired key (`WWW-Authenticate: Bearer realm="kayroslab"`) |
| `403` | `insufficient_scope` | Key lacks the scope |
| `404` | `collective_not_found`, `mission_not_found` | Unknown or not allowed for this key |
| `409` | `idempotency_key_reused` | Same key, different body |
| `429` | `daily_quota_exceeded` or rate limit | 60 requests/min per key (`KAYROS_PUBLIC_RATE_LIMIT`), 200 missions/day per tenant (`KAYROS_PUBLIC_MISSIONS_PER_DAY`); `Retry-After` on rate limit |
| `503` | `unavailable` | Public API not configured on the instance |

### Console management endpoints (session auth, role `comex` / `admin`)

Used by the console **Intégrations** page ([`backend/fastify/routes/console-integrations.mjs`](../backend/fastify/routes/console-integrations.mjs)):

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/console/integrations` | Keys, scopes, tenant webhook, events, last deliveries, profiles, API / docs / guide URLs |
| `POST` | `/v1/console/integrations/keys` | Create a key `{ name, scopes?, service_account?, collective_ids?, expires_in_days? }` — token returned once |
| `DELETE` | `/v1/console/integrations/keys/:keyId` | Revoke a key |
| `PUT` | `/v1/console/integrations/webhook` | `{ webhook_url?, events?, enabled?, rotate_secret? }` |
| `POST` | `/v1/console/integrations/webhook/secret` | Reveal (create if needed) the signing secret |
| `POST` | `/v1/console/integrations/webhook/test` | Send a signed `ping` and return the delivery result |
| `GET` | `/v1/console/integrations/deliveries?limit=` | Delivery log (1–200) |

### Server configuration

| Variable | Default | Role |
|---|---|---|
| `KAYROS_PUBLIC_API_URL` | `https://api.kayroslab.com` | Base URL written into the served spec and the console |
| `KAYROS_PUBLIC_RATE_LIMIT` | `60` | Requests per minute per API key |
| `KAYROS_PUBLIC_MISSIONS_PER_DAY` | `200` | Missions per tenant per UTC day |
| `KAYROS_WEBHOOK_ALLOW_HTTP` · `KAYROS_WEBHOOK_ALLOW_PRIVATE` | `false` | Allow `http://` / private hosts for callbacks (tests only) |
| `KAYROS_MISSION_QUEUE` · `KAYROS_MISSION_CONCURRENCY` | on with `DATABASE_URL` · `2` | Durable Postgres mission queue |
| `NVIDIA_FAST_MODEL` · `NVIDIA_FAST_MAX_TOKENS` · `NVIDIA_FAST_TIMEOUT_MS` | see `.env.sample` | `fast` profile |

---

## Developer Portal MCP

`POST|GET|DELETE /mcp` — Streamable HTTP MCP endpoint with scoped tools, resources and a prompt for
agentic API consumers. Tokens are SHA-256 digests bound to a tenant and scopes in
`KAYROS_MCP_CLIENTS_JSON`. Full guide and client configs: [`developer-portal-mcp.md`](developer-portal-mcp.md),
[`mcp-configs/`](mcp-configs/).

---

## Application API (internal)

Routes used by KayrosLab's own front ends. They require a console session (`Authorization: Bearer
<session token>` from `/v1/auth/*`) unless marked *public*. They are listed for orientation only and
are **not** a supported integration contract — use the Public API v1 instead. Source of truth:
`backend/fastify/routes/*.mjs`.

| Domain | Routes |
|---|---|
| Health & metrics | `GET /health` *(public: LLM provider chain, persistence, SSO, SMTP state — no secrets)* · `GET /metrics` *(Prometheus; `METRICS_TOKEN` or loopback only)* |
| Auth | `POST /v1/auth/register` · `POST /v1/auth/login` · `GET /v1/auth/sso` *(public: enabled providers — Google, enterprise OIDC)* · `POST /v1/auth/sso/start` · `POST /v1/auth/sso/callback` · `POST /v1/auth/password/forgot` · `POST /v1/auth/password/reset` · `POST /v1/auth/logout` · `GET /v1/auth/me` |
| Agent console | `GET /v1/console/overview` · `GET\|POST /v1/console/agents` · `PATCH /v1/console/agents/:agentId` · `POST /v1/console/agents/:agentId/crystal` · `POST /v1/console/agents/:agentId/personality` · `PUT /v1/console/agents/:agentId/human-profile` · `POST /v1/console/impersonators` · `POST /v1/console/impersonator-teams` · `GET /v1/console/connectors` · `PUT\|PATCH /v1/console/connectors/:platform` · `POST /v1/console/connectors/:platform/connect` · `POST /v1/console/connectors/:platform/test` · `GET\|POST /v1/console/sessions` · `GET /v1/console/sessions/:sessionId` · `PATCH /v1/console/sessions/:sessionId/collective` · `POST /v1/console/sessions/:sessionId/run` *(202, async; `?wait=true` = sync)* · `GET /v1/console/activity` · `GET /v1/console/threads` · `GET /v1/console/threads/:threadId` · `POST /v1/console/threads/:threadId/messages` *(202)* · `POST /v1/console/threads/:threadId/arbitrate` |
| Console integrations | see [above](#console-management-endpoints-session-auth-role-comex--admin) |
| Chat connectors | `POST /v1/connectors/slack/events` · `POST /v1/connectors/{slack,discord,teams}/interactive` · `POST /v1/connectors/{slack,discord,teams}/configured/:connectionId` · `GET /v1/connectors/:platform/oauth/callback` · `POST /v1/connectors/link` · `POST /v1/connectors/link/:token` · `GET /v1/connectors/links` |
| Specialized swarms | `GET\|POST /v1/swarm/agents` · `PATCH /v1/swarm/agents/:agentId/rules` · `POST /v1/swarm/agents/:agentId/personality/import` · `POST /v1/swarm/configurations` · `GET /v1/swarm/configurations/:swarmId` · `POST /v1/swarm/configurations/:swarmId/run` · `GET /v1/swarm/runs/:runId` · `GET /v1/swarm/runs/:runId/dossier` · `POST /v1/swarm/runs/:runId/arbitrate` |
| Sales Oracle | `POST\|GET /v1/sales-oracle/cases` · `GET /v1/sales-oracle/cases/:caseId` · `POST /v1/sales-oracle/cases/:caseId/documents/uploads` · `POST /v1/sales-oracle/cases/:caseId/documents/:documentId/complete` · `GET /v1/sales-oracle/cases/:caseId/documents` · `GET /v1/sales-oracle/documents/:documentId/status` |
| Strategic cycle (SSE) | `POST /v1/cycle/run` · `POST /v1/cycle/reactivate` · `GET /v1/cycle/status` · `GET /v1/runs/suspended` · `GET /v1/runs/:runId` · `POST /v1/runs/:runId/resume` |
| Ideas & portfolio | `GET\|POST /v1/ideas` · `GET\|PATCH /v1/ideas/:id` · `GET /v1/portfolio` · `GET /v1/scorecards` · `GET /v1/activity` · `GET /v1/digest` · per-idea `votes`, `execution`, `roadmap`, `risques`, `capitalisation`, `gates-futurs`, `arbitrage`, `decisions`, `signals`, `tendances`, `scenarios`, `collision`, `eprouver`, `comments`, `projection`, `impact`, `score` |
| Governance | `POST /v1/ideas/:id/gates` · `GET /v1/gates` · `GET /v1/gates/:gateId` · `POST\|GET /v1/gates/:gateId/votes` · `POST /v1/gates/:gateId/resolve` · `POST /v1/ideas/:id/working-group` |
| Campaigns & moderation | `GET\|POST /v1/campaigns` · `GET /v1/moderation` · `POST /v1/ideas/:id/moderate` |
| Memory | `GET\|POST /v1/memory/l3` · `GET /v1/memory/ideas/:ideaId` · `POST /v1/memory/promote` · `POST /v1/memory/save` |
| Positioning | `GET /v1/positionning/ontology` · `POST /v1/positionning/{search,github,arxiv,analyze}` · `POST /v1/positionning/export/owl` |
| Novelty | `POST /v1/novelty/score` · `POST /v1/novelty/embed-text` |
| TimesFM forecasts | `GET /v1/forecast/status` · `POST /v1/ideas/:id/forecast` · `GET /v1/ideas/:id/forecasts` — see [`TIMESFM_FORECASTING.md`](TIMESFM_FORECASTING.md) |
| Reporting & timers | `GET /v1/reporting/dashboard` · `GET /v1/reporting/export` · `POST /v1/reporting/{compare,leaderboard}` · `POST /v1/timer/{deadline,tick}` · `GET /v1/timer/status` |
| LLM & tools | `POST /v1/llm` · `POST /v1/embed` · `GET /v1/tools` · `POST /v1/tools/call` · `POST /v1/govern/query` · `POST /v1/projeter/monitor` |
| Public demo *(public, rate-limited)* | `POST /v1/demo/chat` · `POST /v1/demo/cycle/run` · `POST /v1/demo/novelty/{score,embed-text}` · `POST /v1/demo/positionning/analyze` · `POST /v1/demo/report-leads` |
| Contact *(public)* | `POST /v1/contact` |
| Literary authors | `GET /v1/literary/authors` · `GET /v1/literary/sources` · `GET /v1/literary/authors/:authorId/works` · `GET /v1/literary/search?q=` · `POST /v1/literary/authors/:authorId/agent` · `POST /v1/literary/agents` · `POST /v1/literary/agents/:agentId/books` · `GET /v1/literary/ledger` |
| Salon | `GET\|PUT /v1/salon/state` · `GET /v1/salon/gutenberg/text` · `POST /v1/salon/translate` · `GET /v1/salon/kb/manifest` · `GET /v1/salon/kb/status/:authorId` · `POST /v1/salon/kb/query` · X: `POST /v1/salon/x/oauth/{start,callback}` · `GET\|PATCH\|DELETE /v1/salon/x/binding` · `POST /v1/salon/x/tweets` · `DELETE /v1/salon/x/tweets/:id` · WhatsApp: `GET\|POST /v1/salon/whatsapp/webhook` · `POST /v1/salon/whatsapp/open` |

---

## Verifying the live surface

```bash
curl -fsS https://api.kayroslab.com/health
curl -fsS https://api.kayroslab.com/v1/public/openapi.json | head -c 120; echo
curl -s https://api.kayroslab.com/v1/public/me -H "Authorization: Bearer $KAYROS_API_KEY"
```

The served spec must stay byte-identical (apart from `servers`) to
`docs/openapi/kayroslab-public-v1.json`; `backend/fastify/tests/public-docs.test.mjs` checks the spec
against the served operations and the zod `MissionCreate` schema.
