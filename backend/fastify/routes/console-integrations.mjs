// Console → Intégrations (comex/admin) : clés d'API, webhook signé du tenant,
// journal des livraisons, webhook de test. Les secrets ne sont renvoyés
// qu'au moment de leur création (clé) ou sur demande explicite (secret HMAC).
import { z } from 'zod';
import { API_KEY_SCOPES, DEFAULT_API_KEY_SCOPES } from '../../../core/integrations/api-keys.mjs';
import { WEBHOOK_EVENTS, validateCallbackUrl } from '../../../core/integrations/webhooks.mjs';
import { DEFAULT_PROFILE, EXECUTION_PROFILES } from '../../../core/integrations/profiles.mjs';

const keySchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(API_KEY_SCOPES.length).optional(),
  service_account: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  collective_ids: z.array(z.string().min(1).max(160)).max(50).optional(),
  expires_in_days: z.number().int().min(1).max(3650).nullable().optional(),
});
const webhookSchema = z.object({
  webhook_url: z.string().max(2000).nullable().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  enabled: z.boolean().optional(),
  rotate_secret: z.boolean().optional(),
});
const testSchema = z.object({ url: z.string().max(2000).optional() });

const GUIDE_URL = 'https://github.com/Geoking2104/KayrosLab/blob/main/integrations/n8n/README.md';
function flag(value) { return /^(1|true|yes|on)$/i.test(String(value || '')); }
function urlOptions() {
  return { allowHttp: flag(process.env.KAYROS_WEBHOOK_ALLOW_HTTP), allowPrivate: flag(process.env.KAYROS_WEBHOOK_ALLOW_PRIVATE) };
}
function manager(me, reply) {
  if (['comex', 'admin'].includes(me?.role)) return true;
  reply.code(403).send({ error: 'rôle comex ou admin requis' });
  return false;
}
/** URL affichée sans la fin du chemin (un webhook porte souvent un jeton dans l'URL). */
function maskUrl(raw) {
  try { const url = new URL(raw); const path = url.pathname.length > 20 ? `${url.pathname.slice(0, 14)}…` : url.pathname; return `${url.protocol}//${url.host}${path}`; }
  catch { return '…'; }
}
function deliveryView(item) {
  return {
    delivery_id: item.delivery_id, event: item.event_type, event_id: item.event_id, mission_id: item.mission_id,
    target: maskUrl(item.target_url), status: item.status, attempts: item.attempts,
    last_status: item.last_status, last_error: item.last_error, created_at: item.created_at,
    delivered_at: item.delivered_at, next_attempt_at: item.status === 'pending' ? item.next_attempt_at : null,
  };
}

export default async function consoleIntegrationsRoutes(app) {
  const ctx = () => app.kayrosContext;

  app.get('/v1/console/integrations', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return reply;
    const { apiKeys, integrationSettings, webhookDispatcher, llmConfig, publicApiUrl } = ctx();
    const deliveries = await webhookDispatcher.outbox.list(me.tenantId, { limit: 20 });
    const apiBase = String(publicApiUrl || 'https://api.kayroslab.com').replace(/\/$/, '');
    return {
      keys: await apiKeys.list(me.tenantId),
      scopes: { available: [...API_KEY_SCOPES], default: [...DEFAULT_API_KEY_SCOPES] },
      webhook: await integrationSettings.view(me.tenantId),
      events: [...WEBHOOK_EVENTS],
      deliveries: deliveries.map(deliveryView),
      profiles: {
        default: DEFAULT_PROFILE, available: [...EXECUTION_PROFILES],
        fast_available: !!llmConfig?.fast?.available, fast_model: llmConfig?.fast?.available ? llmConfig.fast.model : null,
        deep_model: llmConfig?.model || null,
      },
      api: { base_url: apiBase, openapi_url: `${apiBase}/v1/public/openapi.json`, docs_url: `${apiBase}/docs`, guide_url: GUIDE_URL },
    };
  });

  app.post('/v1/console/integrations/keys', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return reply;
    const parsed = keySchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'clé invalide', issues: parsed.error.issues });
    const d = parsed.data;
    try {
      const created = await ctx().apiKeys.create({
        tenantId: me.tenantId, name: d.name, scopes: d.scopes, serviceAccount: d.service_account,
        collectiveIds: d.collective_ids || [], expiresInDays: d.expires_in_days ?? null, createdBy: me.email || me.sub,
      });
      // `token` n'est renvoyé qu'ici : la console l'affiche une seule fois.
      return reply.code(201).send({ key: created.key, token: created.token, warning: 'Copiez cette clé maintenant : elle ne sera plus affichée.' });
    } catch (error) { return reply.code(error.statusCode || 400).send({ error: error.message }); }
  });

  app.delete('/v1/console/integrations/keys/:keyId', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return reply;
    const key = await ctx().apiKeys.revoke(me.tenantId, req.params.keyId);
    return key ? { key } : reply.code(404).send({ error: 'clé introuvable' });
  });

  app.put('/v1/console/integrations/webhook', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return reply;
    const parsed = webhookSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'webhook invalide', issues: parsed.error.issues });
    const d = parsed.data;
    let url = d.webhook_url;
    if (url) {
      try { url = validateCallbackUrl(url, urlOptions()); } catch (error) { return reply.code(400).send({ error: error.message.replace('callback_url', 'webhook_url') }); }
    }
    const result = await ctx().integrationSettings.update(me.tenantId, { ...d, webhook_url: url }, { by: me.email || me.sub });
    return { webhook: result.settings, ...(result.secret ? { secret: result.secret, warning: 'Nouveau secret de signature : reportez-le dans n8n / Zapier.' } : {}) };
  });

  // Révèle le secret de signature (comme Stripe « Reveal ») ; le crée au besoin.
  app.post('/v1/console/integrations/webhook/secret', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return reply;
    const secret = await ctx().integrationSettings.ensureSecret(me.tenantId, { by: me.email || me.sub });
    return { secret };
  });

  app.post('/v1/console/integrations/webhook/test', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return reply;
    const parsed = testSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'requête invalide' });
    const settings = await ctx().integrationSettings.get(me.tenantId);
    let url = parsed.data.url || settings.webhook_url;
    if (!url) return reply.code(400).send({ error: 'aucune URL : renseignez l’URL du webhook (ou passez `url`)' });
    try { url = validateCallbackUrl(url, urlOptions()); } catch (error) { return reply.code(400).send({ error: error.message }); }
    await ctx().integrationSettings.ensureSecret(me.tenantId, { by: me.email || me.sub });
    const [delivery] = await ctx().missionEvents.ping(me.tenantId, url);
    await ctx().webhookDispatcher.deliverDue().catch(() => 0);
    const after = (await ctx().webhookDispatcher.outbox.list(me.tenantId, { limit: 50 })).find((item) => item.delivery_id === delivery?.delivery_id) || delivery;
    return { delivery: after ? deliveryView(after) : null };
  });

  app.get('/v1/console/integrations/deliveries', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return reply;
    const items = await ctx().webhookDispatcher.outbox.list(me.tenantId, { limit: Math.max(1, Math.min(200, Number(req.query?.limit) || 50)) });
    return { deliveries: items.map(deliveryView) };
  });
}
