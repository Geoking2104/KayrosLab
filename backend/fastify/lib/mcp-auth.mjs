import { createHash, timingSafeEqual } from 'node:crypto';

export const MCP_SCOPES = Object.freeze([
  'portal:read',
  'swarm:read',
  'swarm:write',
  'swarm:run',
]);

export function hashMcpToken(token) {
  return createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function authError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeClient(entry, index) {
  const clientId = String(entry?.client_id || '').trim();
  const tenantId = String(entry?.tenant_id || '').trim();
  const tokenHash = String(entry?.token_sha256 || '').trim().toLowerCase();
  const scopes = [...new Set(Array.isArray(entry?.scopes) ? entry.scopes : [])];

  if (!clientId || !tenantId || !/^[a-f0-9]{64}$/.test(tokenHash)) {
    throw new Error(`KAYROS_MCP_CLIENTS_JSON[${index}] requiert client_id, tenant_id et token_sha256`);
  }
  const unsupported = scopes.filter((scope) => !MCP_SCOPES.includes(scope));
  if (!scopes.length || unsupported.length) {
    throw new Error(`scopes MCP invalides pour ${clientId}: ${unsupported.join(', ') || 'aucun scope'}`);
  }

  const expiresAt = entry.expires_at ? new Date(entry.expires_at) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    throw new Error(`expires_at invalide pour le client MCP ${clientId}`);
  }

  return Object.freeze({
    clientId,
    tenantId,
    tokenHash,
    scopes: Object.freeze(scopes),
    expiresAt: expiresAt?.toISOString() || null,
  });
}

export function createMcpClientRegistry(json = '') {
  let configured = [];
  if (String(json || '').trim()) {
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) throw new Error('la racine doit être un tableau');
      configured = parsed.map(normalizeClient);
    } catch (error) {
      throw new Error(`KAYROS_MCP_CLIENTS_JSON invalide: ${error.message}`);
    }
  }

  return Object.freeze({
    enabled: configured.length > 0,
    authenticate(authorization = '') {
      if (!configured.length) throw authError('Developer Portal MCP non configuré', 503);
      if (!String(authorization).startsWith('Bearer ')) throw authError('jeton MCP Bearer requis', 401);

      const candidate = Buffer.from(hashMcpToken(String(authorization).slice(7).trim()), 'hex');
      const client = configured.find((item) => {
        const expected = Buffer.from(item.tokenHash, 'hex');
        return candidate.length === expected.length && timingSafeEqual(candidate, expected);
      });
      if (!client) throw authError('jeton MCP invalide', 401);
      if (client.expiresAt && Date.parse(client.expiresAt) <= Date.now()) {
        throw authError('jeton MCP expiré', 401);
      }
      return client;
    },
  });
}

export function hasMcpScope(principal, scope) {
  return !!principal?.scopes?.includes(scope);
}

export function requireMcpScope(principal, scope) {
  if (!hasMcpScope(principal, scope)) throw authError(`scope MCP requis: ${scope}`, 403);
}
