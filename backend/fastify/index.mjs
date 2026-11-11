import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import metricsPlugin from 'fastify-metrics';
import buildContext from './lib/context.mjs';
import authPlugin from './plugins/auth.mjs';
import { applyEnvFileDefaults } from './lib/env-file.mjs';
import { metricsEndpoint } from './lib/metrics.mjs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { synchronizePersonaPackage } from '../../core/persona-package.mjs';
import { visitPublicSources } from '../../core/public-sources.mjs';
import { isSignedChatWebhook, registerBodyParsers } from './lib/body-parsers.mjs';
import { serverOptions, rateLimitOptions } from './lib/http-hardening.mjs';

applyEnvFileDefaults();

const app = Fastify(serverOptions());

registerBodyParsers(app);

const ctx = await buildContext();
app.decorate('kayrosContext', ctx);

// Personas déclaratives (un fichier par persona dans personas/) : chargées via le constructeur
// impersonator gouverné, sans écraser un agent existant. KAYROS_PERSONAS_DIR=off désactive.
if (process.env.KAYROS_PERSONAS_DIR !== 'off' && ctx.engine?.swarm) {
  const personasDir = process.env.KAYROS_PERSONAS_DIR || fileURLToPath(new URL('../../personas/', import.meta.url));
  try {
    const result = await synchronizePersonaPackage(ctx.engine.swarm, personasDir, {
      tenantId: process.env.KAYROS_PERSONAS_TENANT_ID || null, parse: (text) => parseYaml(text),
    });
    app.log.info({ personas: result }, 'personas déclaratives synchronisées');
    for (const e of result.errors) app.log.warn(`persona rejetée (${e.file}) : ${e.error}`);
    // Visite des sources publiques en arrière-plan (ne retarde pas le démarrage) ;
    // KAYROS_PUBLIC_SOURCES_VISIT=off la désactive.
    if (String(process.env.KAYROS_PUBLIC_SOURCES_VISIT || '').toLowerCase() !== 'off') {
      synchronizePersonaPackage(ctx.engine.swarm, personasDir, {
        tenantId: process.env.KAYROS_PERSONAS_TENANT_ID || null, parse: (text) => parseYaml(text), visit: (urls) => visitPublicSources(urls),
      }).then((visit) => app.log.info({ visited: visit.visited }, 'sources publiques des personas visitées'))
        .catch((error) => app.log.warn(`visite des sources publiques impossible : ${error.message}`));
    }
  } catch (error) { app.log.error(error, 'synchronisation des personas impossible'); }
}

await app.register(cors, { origin: [ctx.ALLOWED_ORIGIN, 'null'] });
// /metrics : Bearer METRICS_TOKEN si défini, sinon loopback direct uniquement
// (Prometheus local). Toute requête relayée par nginx est refusée.
await app.register(metricsPlugin, { endpoint: metricsEndpoint(process.env) });
await app.register(rateLimit, rateLimitOptions);
await app.register(authPlugin);

app.addHook('preHandler', async (req, reply) => {
  if (!ctx.KAYROS_SECRET) return;
  if (req.method === 'GET') return;
  const path = (req.url || '').split('?')[0];
  if (path.startsWith('/v1/demo/')) return;
  if (path === '/v1/contact') return;
  if (path === '/v1/auth/login' || path === '/v1/auth/register') return;
  if (path.startsWith('/v1/auth/password/')) return;
  if (path.startsWith('/v1/auth/sso')) return;
  if (path.startsWith('/v1/salon/')) return;
  // Webhooks Slack / Discord / Teams : signature de la plateforme vérifiée dans la route.
  if (isSignedChatWebhook(path)) return;
  if (path === '/mcp') return;
  // API publique : authentifiée par clé d'API (routes/public-api.mjs), pas par le secret partagé.
  if (path.startsWith('/v1/public/')) return;
  if (req.headers['x-kayros-secret'] !== ctx.KAYROS_SECRET) return reply.code(401).send({ error: 'non autorise' });
});

await app.register((await import('./routes/health.mjs')).default);
await app.register((await import('./routes/audit-evidence.mjs')).default);
await app.register((await import('./routes/llm.mjs')).default);
await app.register((await import('./routes/novelty.mjs')).default);
await app.register((await import('./routes/cycle.mjs')).default);
await app.register((await import('./routes/memory.mjs')).default);
await app.register((await import('./routes/demo-report-leads.mjs')).default);
await app.register((await import('./routes/contact.mjs')).default);
await app.register((await import('./routes/literary.mjs')).default);
await app.register((await import('./routes/auth-routes.mjs')).default);
await app.register((await import('./routes/salon.mjs')).default);
await app.register((await import('./routes/salon-whatsapp.mjs')).default);
await app.register((await import('./routes/salon-x.mjs')).default);
await app.register((await import('./routes/salon-kb.mjs')).default);
await app.register((await import('./routes/ideas.mjs')).default);
await app.register((await import('./routes/portfolio.mjs')).default);
await app.register((await import('./routes/forecasts.mjs')).default);
await app.register((await import('./routes/impact.mjs')).default);
await app.register((await import('./routes/gates.mjs')).default);
await app.register((await import('./routes/resume.mjs')).default);
await app.register((await import('./routes/demo-cycle.mjs')).default);
await app.register((await import('./routes/campaigns.mjs')).default);
await app.register((await import('./routes/comments.mjs')).default);
await app.register((await import('./routes/reporting.mjs')).default);
await app.register((await import('./routes/timer.mjs')).default);
await app.register((await import('./routes/connectors.mjs')).default);
await app.register((await import('./routes/console.mjs')).default);
await app.register((await import('./routes/console-workspace.mjs')).default);
await app.register((await import('./routes/positionning.mjs')).default);
await app.register((await import('./routes/swarm.mjs')).default);
await app.register((await import('./routes/sales-oracle.mjs')).default);
await app.register((await import('./routes/mcp.mjs')).default);
await app.register((await import('./routes/public-api.mjs')).default);
await app.register((await import('./routes/console-integrations.mjs')).default);
await app.register((await import('./routes/public-docs.mjs')).default);

// Arrêt propre (pm2 reload envoie SIGINT) : les missions en cours retournent
// dans la file Postgres et reprennent aussitôt dans le nouveau processus.
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  app.log.info(`${signal} reçu : arrêt propre`);
  const timer = setTimeout(() => process.exit(0), 4000);
  timer.unref?.();
  try {
    ctx.webhookDispatcher?.stop();
    const released = await ctx.missionWorker?.stop({ release: true });
    if (released) app.log.info(`${released} mission(s) rendue(s) à la file`);
    await app.close();
  } catch (error) { app.log.error(error); }
  process.exit(0);
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

const PORT = Number(ctx.PORT || 8787);
app.listen({ port: PORT, host: '0.0.0.0' })
  .then((addr) => app.log.info(`KayrosLab backend sur ${addr}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
