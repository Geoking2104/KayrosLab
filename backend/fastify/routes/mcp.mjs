import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createDeveloperPortalMcpServer } from '../lib/developer-portal-mcp.mjs';

function jsonRpcError(reply, statusCode, message, id = null) {
  return reply.code(statusCode).type('application/json').send({
    jsonrpc: '2.0',
    error: { code: statusCode === 401 ? -32001 : statusCode === 403 ? -32003 : -32603, message },
    id,
  });
}

export default async function mcpRoutes(app) {
  app.decorateRequest('mcpPrincipal', null);

  app.addHook('preHandler', async (req, reply) => {
    const origin = String(req.headers.origin || '').trim();
    const allowedOrigins = app.kayrosContext.MCP_ALLOWED_ORIGINS || [];
    if (origin && !allowedOrigins.includes(origin)) {
      return jsonRpcError(reply, 403, 'origine MCP non autorisée', req.body?.id ?? null);
    }

    try {
      req.mcpPrincipal = app.kayrosContext.mcpClients.authenticate(req.headers.authorization || '');
    } catch (error) {
      return jsonRpcError(reply, error.statusCode || 401, error.message, req.body?.id ?? null);
    }
  });

  app.post('/mcp', {
    config: { rateLimit: { max: app.kayrosContext.MCP_RATE_LIMIT || 60, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const principal = req.mcpPrincipal;
    const method = String(req.body?.method || 'unknown');
    await app.kayrosContext.journal?.({
      type: 'mcp.request',
      clientId: principal.clientId,
      tenantId: principal.tenantId,
      method,
    });

    const server = createDeveloperPortalMcpServer({ ctx: app.kayrosContext, principal });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      await server.connect(transport);
      reply.hijack();
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (error) {
      app.log.error({ err: error, clientId: principal.clientId, method }, 'MCP request failed');
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
        reply.raw.setHeader('content-type', 'application/json');
        reply.raw.end(JSON.stringify({
          jsonrpc: '2.0', error: { code: -32603, message: 'Internal MCP error' }, id: req.body?.id ?? null,
        }));
      }
    } finally {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    }
    return reply;
  });

  const methodNotAllowed = async (_req, reply) => reply
    .header('allow', 'POST')
    .code(405)
    .send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });

  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);
}
