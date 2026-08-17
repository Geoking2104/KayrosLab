import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { renderSwarmDossierMarkdown, resolveEffectiveRules } from '../../../core/swarm.mjs';
import { hasMcpScope, requireMcpScope } from './mcp-auth.mjs';

export const DEVELOPER_PORTAL_CATALOG = Object.freeze({
  name: 'KayrosLab Agentic API',
  version: '1.0.0',
  base_path: '/v1',
  mcp_endpoint: '/mcp',
  authentication: {
    type: 'bearer',
    storage: 'SHA-256 server-side; raw token only in the coding tool secret store',
    tenant_binding: true,
    scopes: ['portal:read', 'swarm:read', 'swarm:write', 'swarm:run'],
  },
  capabilities: [
    {
      id: 'swarm-agents',
      summary: 'Discover governed system, custom and hybrid agent definitions.',
      rest: ['GET /v1/swarm/agents'],
      mcp_tools: ['portal_list_swarm_agents'],
      scope: 'swarm:read',
    },
    {
      id: 'swarm-configurations',
      summary: 'Compose a tenant-scoped decision committee with explicit voting rules.',
      rest: ['POST /v1/swarm/configurations', 'GET /v1/swarm/configurations/:swarmId'],
      mcp_tools: ['portal_create_swarm_configuration', 'portal_get_swarm_configuration'],
      scopes: ['swarm:write', 'swarm:read'],
    },
    {
      id: 'swarm-runs',
      summary: 'Run a governed simulation and inspect its evidence-backed decision dossier.',
      rest: [
        'POST /v1/swarm/configurations/:swarmId/run',
        'GET /v1/swarm/runs/:runId',
        'GET /v1/swarm/runs/:runId/dossier',
      ],
      mcp_tools: ['portal_run_swarm', 'portal_get_swarm_run', 'portal_get_decision_dossier'],
      scopes: ['swarm:run', 'swarm:read'],
    },
  ],
  guardrails: [
    'Every token is bound to one tenant and an explicit scope allowlist.',
    'Hybrid-profile imports and human arbitration are intentionally unavailable through MCP.',
    'Stakeholder output is labelled as simulated and remains advisory until human arbitration.',
    'Tokens are never accepted in query strings and are never written to audit events.',
  ],
});

const GETTING_STARTED = `# KayrosLab Developer Portal MCP

1. Obtain a tenant-bound MCP token from a KayrosLab administrator.
2. Store the raw token in the coding tool secret store or KAYROS_MCP_TOKEN environment variable.
3. Connect the tool to the HTTPS Streamable HTTP endpoint /mcp.
4. Start with portal_get_api_catalog, then discover agents and existing swarm configurations.
5. Treat every simulated stakeholder response as advisory; human arbitration remains outside MCP.`;

const SECURITY_GUIDE = `# Security contract

- Use HTTPS in production and rotate MCP tokens independently per coding tool.
- Grant portal:read and swarm:read by default; add swarm:write or swarm:run only when required.
- The server stores SHA-256 token digests, tenant bindings, scopes and optional expiry timestamps.
- Browser-origin requests are denied unless the origin is explicitly allowlisted.
- MCP cannot import personality data or approve/override a governance decision.`;

function scope(principal) {
  return { tenantId: principal.tenantId, by: `mcp:${principal.clientId}` };
}

function service(ctx) {
  const value = ctx?.engine?.swarm;
  if (!value) throw new Error('swarm service non disponible');
  return value;
}

function result(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function markdownResult(markdown) {
  return { content: [{ type: 'text', text: markdown }] };
}

function safeTool(handler) {
  return async (input) => {
    try { return await handler(input || {}); }
    catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: String(error?.message || error) }],
      };
    }
  };
}

function portalAgent(agent) {
  return {
    agent_id: agent.agent_id,
    agent_type: agent.agent_type,
    role_name: agent.role_name,
    department: agent.department,
    seniority: agent.seniority,
    primary_focus: agent.primary_focus,
    veto_power: agent.veto_power === true,
    effective_rules: resolveEffectiveRules(agent),
    has_authorized_human_profile: !!agent.human_profile,
  };
}

export function createDeveloperPortalMcpServer({ ctx, principal }) {
  const server = new McpServer({
    name: 'kayroslab-developer-portal',
    version: DEVELOPER_PORTAL_CATALOG.version,
  });

  if (hasMcpScope(principal, 'portal:read')) {
    server.registerTool('portal_get_api_catalog', {
      title: 'Get KayrosLab API catalog',
      description: 'Discover the agentic API capabilities, required scopes and governance boundaries before making calls.',
      inputSchema: {},
    }, safeTool(async () => {
      requireMcpScope(principal, 'portal:read');
      return result({ ...DEVELOPER_PORTAL_CATALOG, client: {
        client_id: principal.clientId,
        tenant_id: principal.tenantId,
        scopes: principal.scopes,
      } });
    }));

    server.registerResource('kayroslab-api-catalog', 'kayros://developer-portal/api-catalog', {
      title: 'KayrosLab agentic API catalog', description: 'Machine-readable API capabilities and governance boundaries.', mimeType: 'application/json',
    }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(DEVELOPER_PORTAL_CATALOG, null, 2) }] }));
    server.registerResource('kayroslab-getting-started', 'kayros://developer-portal/getting-started', {
      title: 'KayrosLab MCP getting started', description: 'Secure onboarding sequence for AI coding tools.', mimeType: 'text/markdown',
    }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: GETTING_STARTED }] }));
    server.registerResource('kayroslab-security', 'kayros://developer-portal/security', {
      title: 'KayrosLab MCP security contract', description: 'Token, tenant and human-governance boundaries.', mimeType: 'text/markdown',
    }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: SECURITY_GUIDE }] }));

    server.registerPrompt('build-agentic-api-consumer', {
      title: 'Build an agentic API consumer',
      description: 'Plan a least-privilege KayrosLab integration from discovery through governed execution.',
      argsSchema: {
        outcome: z.string().max(1000).optional().describe('The product outcome the API consumer should deliver'),
      },
    }, async ({ outcome = 'Integrate a governed KayrosLab decision workflow' }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Build this outcome: ${outcome}. First call portal_get_api_catalog. Request only the scopes needed. Reuse existing agents and swarms when possible. Never import personality data, expose credentials, or automate human arbitration. Return the run identifier, consensus, evidence gaps and next human decision.`,
        },
      }],
    }));
  }

  if (hasMcpScope(principal, 'swarm:read')) {
    server.registerTool('portal_list_swarm_agents', {
      title: 'List governed agents',
      description: 'List tenant-visible system, custom and hybrid agents without exposing imported personality data.',
      inputSchema: {},
    }, safeTool(async () => {
      requireMcpScope(principal, 'swarm:read');
      return result({ agents: service(ctx).registry.list(scope(principal)).map(portalAgent) });
    }));

    server.registerTool('portal_get_swarm_configuration', {
      title: 'Get swarm configuration',
      description: 'Read one tenant-scoped swarm configuration.',
      inputSchema: { swarm_id: z.string().min(1).max(128) },
    }, safeTool(async ({ swarm_id }) => {
      requireMcpScope(principal, 'swarm:read');
      const configuration = service(ctx).getConfiguration(swarm_id, scope(principal));
      if (!configuration) throw new Error('swarm introuvable');
      return result(configuration);
    }));

    server.registerTool('portal_get_swarm_run', {
      title: 'Get swarm run',
      description: 'Read a tenant-scoped governed run and its consensus.',
      inputSchema: { run_id: z.string().min(1).max(160) },
    }, safeTool(async ({ run_id }) => {
      requireMcpScope(principal, 'swarm:read');
      const run = service(ctx).getRun(run_id, scope(principal));
      if (!run) throw new Error('run introuvable');
      return result(run);
    }));

    server.registerTool('portal_get_decision_dossier', {
      title: 'Get decision dossier',
      description: 'Render the governed decision matrix, risks, mitigations and human-arbitration status as Markdown.',
      inputSchema: { run_id: z.string().min(1).max(160) },
    }, safeTool(async ({ run_id }) => {
      requireMcpScope(principal, 'swarm:read');
      const run = service(ctx).getRun(run_id, scope(principal));
      if (!run) throw new Error('run introuvable');
      return markdownResult(renderSwarmDossierMarkdown(run));
    }));
  }

  if (hasMcpScope(principal, 'swarm:write')) {
    server.registerTool('portal_create_swarm_configuration', {
      title: 'Create swarm configuration',
      description: 'Compose a tenant-scoped governed committee from existing agents.',
      inputSchema: {
        swarm_id: z.string().min(1).max(128).optional(),
        swarm_name: z.string().min(1).max(300),
        active_agents: z.array(z.string().min(1)).min(1).max(30),
        voting_threshold: z.enum(['unanimous', 'majority', 'veto_power_csuite']),
        personality_simulation_enabled: z.boolean().default(false),
      },
    }, safeTool(async (input) => {
      requireMcpScope(principal, 'swarm:write');
      return result(service(ctx).createConfiguration(input, scope(principal)));
    }));
  }

  if (hasMcpScope(principal, 'swarm:run')) {
    server.registerTool('portal_run_swarm', {
      title: 'Run governed swarm',
      description: 'Run an existing tenant-scoped swarm. The result remains advisory until a human arbitrates it.',
      inputSchema: {
        swarm_id: z.string().min(1).max(128),
        question: z.string().min(1).max(12000),
        context: z.string().max(100000).optional(),
        provider: z.string().max(80).optional(),
        sovereignty: z.string().max(80).optional(),
        model: z.string().max(160).optional(),
      },
    }, safeTool(async ({ swarm_id, ...input }) => {
      requireMcpScope(principal, 'swarm:run');
      return result(await service(ctx).run(swarm_id, { ...input, ...scope(principal) }));
    }));
  }

  return server;
}
