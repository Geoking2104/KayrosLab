# Developer Portal MCP — secure agentic API consumption

KayrosLab exposes a stateless **Streamable HTTP MCP server** at `POST /mcp`. It lets AI coding tools discover and consume governed KayrosLab APIs without copying API schemas into prompts or exposing a broad backend secret.

## Security model

- One random token per coding tool or automation.
- Only the SHA-256 digest is stored on the server.
- Every client is bound to one `tenant_id`, an explicit scope allowlist and an optional expiry date.
- Raw tokens are accepted only in `Authorization: Bearer ...`, never in URLs.
- Requests with a browser `Origin` are rejected unless that origin is listed in `KAYROS_MCP_ALLOWED_ORIGINS`.
- Audits record the client, tenant and MCP method — never the token or tool arguments.
- Personality-profile import and human arbitration are intentionally absent from MCP.

The MCP result remains advisory: a swarm can produce a consensus and decision dossier, but a real person must arbitrate the decision through the authenticated KayrosLab workflow.

## Provision a client

Generate a token locally from the repository root:

```bash
node scripts/generate-mcp-token.mjs \
  --client-id codex-geoff \
  --tenant-id my-tenant \
  --scopes portal:read,swarm:read,swarm:run \
  --expires-at 2027-01-31T23:59:59Z
```

The command prints:

1. the raw `kmcp_...` token, to store once in the coding tool secret store or `KAYROS_MCP_TOKEN`;
2. a JSON entry containing only its digest, client identity, tenant, scopes and expiry.

Merge one or more generated entries into the server variable:

```dotenv
KAYROS_MCP_CLIENTS_JSON=[{"client_id":"codex-geoff","tenant_id":"my-tenant","token_sha256":"<64 hex chars>","scopes":["portal:read","swarm:read","swarm:run"],"expires_at":"2027-01-31T23:59:59.000Z"}]
KAYROS_MCP_RATE_LIMIT=60
KAYROS_MCP_ALLOWED_ORIGINS=
```

Keep `KAYROS_MCP_ALLOWED_ORIGINS` empty for normal desktop coding tools. Add an HTTPS origin only for a trusted browser-hosted MCP client.

For the repository's OVH deployment, store the complete JSON array as the GitHub Actions secret `KAYROS_MCP_CLIENTS_JSON`. The deployment workflow writes it to the VPS `.env` with mode `0600`; when the secret is absent, `/mcp` stays installed but disabled with HTTP 503.

## Scopes and tools

| Scope | MCP tools | Purpose |
|---|---|---|
| `portal:read` | `portal_get_api_catalog` | Discover capabilities, REST mappings and governance boundaries. |
| `swarm:read` | `portal_list_swarm_agents`, `portal_get_swarm_configuration`, `portal_get_swarm_run`, `portal_get_decision_dossier` | Inspect tenant-scoped agents, configurations and evidence. Imported human-profile content is omitted from agent discovery. |
| `swarm:write` | `portal_create_swarm_configuration` | Compose a governed swarm from existing agents. |
| `swarm:run` | `portal_run_swarm` | Execute an existing swarm; no human arbitration. |

Start with `portal:read,swarm:read`. Add write or run scopes only for workflows that require them.

The server also exposes:

- resources: `kayros://developer-portal/api-catalog`, `.../getting-started`, `.../security`;
- prompt: `build-agentic-api-consumer`.

## Configure AI coding tools

Set the endpoint and secret in your shell or secret manager:

```bash
export KAYROS_MCP_URL=https://api.kayroslab.com/mcp
export KAYROS_MCP_TOKEN=kmcp_...
```

Never commit the token. Ready-to-copy templates live in [`docs/mcp-configs/`](mcp-configs/).

### Codex

The recommended configuration keeps the bearer token in an environment variable:

```bash
codex mcp add kayroslab-developer-portal \
  --url https://api.kayroslab.com/mcp \
  --bearer-token-env-var KAYROS_MCP_TOKEN
```

Equivalent TOML: [`mcp-configs/codex.config.toml`](mcp-configs/codex.config.toml).

### Claude Code

Copy [`mcp-configs/claude-code.mcp.json`](mcp-configs/claude-code.mcp.json) to the project root as `.mcp.json`, then approve the project-scoped server in Claude Code.

### Cursor

Copy [`mcp-configs/cursor.mcp.json`](mcp-configs/cursor.mcp.json) to `.cursor/mcp.json`. The template resolves URL and token from environment variables.

### VS Code / GitHub Copilot

Copy [`mcp-configs/vscode.mcp.json`](mcp-configs/vscode.mcp.json) to `.vscode/mcp.json`. VS Code prompts for the URL and stores the token as a password input instead of committing it.

## First agentic workflow

Ask the coding agent:

> Use the KayrosLab Developer Portal. Discover the API catalog, list the agents visible to this tenant, select an existing swarm, run a pre-mortem on this API launch, and return the run ID, consensus, evidence gaps and next human decision. Do not automate arbitration.

The intended sequence is:

1. `portal_get_api_catalog`
2. `portal_list_swarm_agents`
3. `portal_get_swarm_configuration` or `portal_create_swarm_configuration`
4. `portal_run_swarm`
5. `portal_get_decision_dossier`
6. hand off the result for human arbitration

## Operations

- Serve the backend behind HTTPS and preserve the `Authorization`, `Content-Type`, `Accept` and `MCP-Protocol-Version` headers at the reverse proxy.
- Rotate one client without affecting the others by replacing its digest entry.
- Remove a client immediately by deleting its entry and restarting/reloading the backend.
- Use a distinct client and token for CI; never reuse a developer token.
- Monitor `mcp.request` audit events and HTTP 401/403/429 rates.

## Verification

```bash
cd backend/fastify
npm test
```

The integration tests negotiate MCP over a real ephemeral HTTP listener, verify least-privilege tool discovery, run a tenant-bound swarm and assert that raw tokens never enter the audit log.
