import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp } from './test-helpers.mjs';
import { hashMcpToken } from '../lib/mcp-auth.mjs';

const readToken = 'kmcp_test_read_only';
const fullToken = 'kmcp_test_full_access';
const otherTenantToken = 'kmcp_test_other_tenant';

function clientsJson() {
  return JSON.stringify([
    {
      client_id: 'codex-read', tenant_id: 'tenant-mcp', token_sha256: hashMcpToken(readToken),
      scopes: ['portal:read', 'swarm:read'],
    },
    {
      client_id: 'codex-full', tenant_id: 'tenant-mcp', token_sha256: hashMcpToken(fullToken),
      scopes: ['portal:read', 'swarm:read', 'swarm:write', 'swarm:run'],
    },
    {
      client_id: 'codex-other', tenant_id: 'tenant-other', token_sha256: hashMcpToken(otherTenantToken),
      scopes: ['portal:read', 'swarm:read'],
    },
  ]);
}

async function rpc(baseUrl, token, method, params = {}, id = 1, headers = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      connection: 'close',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return { response, body: await response.json() };
}

describe('Developer Portal MCP', () => {
  let app; let ctx; let baseUrl;

  beforeEach(async () => {
    ({ app, ctx } = await buildTestApp({
      KAYROS_MCP_CLIENTS_JSON: clientsJson(),
      KAYROS_SECRET: 'legacy-shared-secret',
    }));
    ctx.engine.swarm.llm = {
      complete: async () => ({
        text: JSON.stringify({
          verdict: 'GO', primary_reason: 'Evidence is sufficient for a controlled trial.',
          strengths_opportunities: ['Reversible scope'], critical_risks: [], metrics: [],
          required_mitigations: [], unverified_assumptions: [],
        }),
        usage: { tokensIn: 1, tokensOut: 1 },
      }),
    };
    baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  });

  afterEach(async () => { if (app) await app.close(); });

  it('requires a scoped bearer token and rejects browser origins by default', async () => {
    const missing = await fetch(`${baseUrl}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    assert.equal(missing.status, 401);

    const hostile = await rpc(baseUrl, readToken, 'tools/list', {}, 2, { origin: 'https://evil.example' });
    assert.equal(hostile.response.status, 403);
  });

  it('negotiates MCP and exposes only tools permitted by the client scopes', async () => {
    const initialized = await rpc(baseUrl, readToken, 'initialize', {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'node-test', version: '1.0.0' },
    });
    assert.equal(initialized.response.status, 200, JSON.stringify(initialized.body));
    assert.equal(initialized.body.result.serverInfo.name, 'kayroslab-developer-portal');

    const listed = await rpc(baseUrl, readToken, 'tools/list');
    assert.equal(listed.response.status, 200, JSON.stringify(listed.body));
    const names = listed.body.result.tools.map((tool) => tool.name);
    assert.ok(names.includes('portal_get_api_catalog'));
    assert.ok(names.includes('portal_list_swarm_agents'));
    assert.ok(!names.includes('portal_create_swarm_configuration'));
    assert.ok(!names.includes('portal_run_swarm'));

    const catalog = await rpc(baseUrl, readToken, 'tools/call', { name: 'portal_get_api_catalog', arguments: {} });
    assert.equal(catalog.response.status, 200, JSON.stringify(catalog.body));
    assert.equal(catalog.body.result.structuredContent.client.tenant_id, 'tenant-mcp');
    assert.ok(catalog.body.result.structuredContent.guardrails.some((rule) => rule.includes('arbitration')));
  });

  it('creates and runs a tenant-bound swarm without exposing human arbitration', async () => {
    const tools = await rpc(baseUrl, fullToken, 'tools/list');
    const names = tools.body.result.tools.map((tool) => tool.name);
    assert.ok(names.includes('portal_create_swarm_configuration'));
    assert.ok(names.includes('portal_run_swarm'));
    assert.ok(!names.some((name) => name.includes('arbitrate')));
    assert.ok(!names.some((name) => name.includes('personality')));

    const created = await rpc(baseUrl, fullToken, 'tools/call', {
      name: 'portal_create_swarm_configuration',
      arguments: {
        swarm_id: 'mcp_launch_review', swarm_name: 'MCP Launch Review',
        active_agents: ['cfo', 'cto'], voting_threshold: 'majority',
        personality_simulation_enabled: false,
      },
    });
    assert.equal(created.body.result.isError, undefined, JSON.stringify(created.body));
    assert.equal(created.body.result.structuredContent.swarm_id, 'mcp_launch_review');

    const executed = await rpc(baseUrl, fullToken, 'tools/call', {
      name: 'portal_run_swarm',
      arguments: { swarm_id: 'mcp_launch_review', question: 'Should we launch the controlled API pilot?' },
    });
    assert.equal(executed.body.result.isError, undefined, JSON.stringify(executed.body));
    assert.equal(executed.body.result.structuredContent.consensus.verdict, 'GO');
    const runId = executed.body.result.structuredContent.run_id;

    const crossTenant = await rpc(baseUrl, otherTenantToken, 'tools/call', {
      name: 'portal_get_swarm_run', arguments: { run_id: runId },
    });
    assert.equal(crossTenant.body.result.isError, true);
    assert.match(crossTenant.body.result.content[0].text, /introuvable/);

    const audit = ctx.activites.find((event) => event.type === 'mcp.request' && event.method === 'tools/call');
    assert.equal(audit.clientId, 'codex-full');
    assert.equal(audit.tenantId, 'tenant-mcp');
    assert.ok(!JSON.stringify(ctx.activites).includes(fullToken));
  });
});
