// Réglages HTTP partagés par index.mjs et ses tests.
//
// L'API tourne derrière nginx sur la même machine (proxy_pass 127.0.0.1:8787,
// X-Forwarded-For = $proxy_add_x_forwarded_for). Sans trustProxy, req.ip valait
// toujours 127.0.0.1 : la limite de débit ne formait qu'un seul compteur pour
// tous les clients. On ne fait confiance qu'au proxy local (préréglage
// « loopback » de proxy-addr : 127.0.0.0/8 et ::1), jamais à `true` : un client
// qui joint l'API directement ne peut pas choisir son IP via X-Forwarded-For.
export const TRUSTED_PROXIES = 'loopback';

export function serverOptions(overrides = {}) {
  return { logger: true, bodyLimit: 5 * 1024 * 1024, trustProxy: TRUSTED_PROXIES, ...overrides };
}

// Une fenêtre par IP cliente (req.ip, résolue via trustProxy).
export const rateLimitOptions = {
  global: true,
  max: 100,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.ip,
  errorResponseBuilder: (req, ctx) => ({
    statusCode: 429, error: 'Too Many Requests', message: `Rate limit depasse. Reessayez dans ${Math.ceil((ctx.ttl || 60000) / 1000)}s.`,
  }),
};
