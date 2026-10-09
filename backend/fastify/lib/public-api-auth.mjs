// Authentification des routes /v1/public/* par clé d'API (core/integrations/api-keys.mjs).
import { apiKeyFromHeaders, hasApiScope, parseApiKey } from '../../../core/integrations/api-keys.mjs';

/** Principal de service ou `null` (la réponse 401/403/503 est déjà envoyée). */
export async function requireApiKey(app, req, reply, scope = null) {
  const service = app.kayrosContext?.apiKeys;
  if (!service) { reply.code(503).send({ error: 'API publique non configurée', code: 'unavailable' }); return null; }
  try {
    const principal = await service.authenticate(apiKeyFromHeaders(req.headers));
    if (scope && !hasApiScope(principal, scope)) {
      reply.code(403).send({ error: `scope requis : ${scope}`, code: 'insufficient_scope' });
      return null;
    }
    req.apiPrincipal = principal;
    return principal;
  } catch (error) {
    reply.code(error.statusCode || 401).header('www-authenticate', 'Bearer realm="kayroslab"')
      .send({ error: error.message, code: String(error.code || 'unauthorized').toLowerCase() });
    return null;
  }
}

/** Clé de rate-limit par clé d'API (préfixe non secret), sinon par IP. */
export function apiKeyRateLimitKey(req) {
  const parsed = parseApiKey(apiKeyFromHeaders(req.headers));
  return parsed ? `apikey:${parsed.prefix}` : `ip:${req.ip}`;
}
