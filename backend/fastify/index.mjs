import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import metricsPlugin from 'fastify-metrics';
import buildContext from './lib/context.mjs';
import authPlugin from './plugins/auth.mjs';
import { applyEnvFileDefaults } from './lib/env-file.mjs';

applyEnvFileDefaults();

const app = Fastify({ logger: true, bodyLimit: 5 * 1024 * 1024 });

app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  req.rawBody = body;
  try { done(null, JSON.parse(body)); }
  catch (error) { done(error); }
});

const ctx = await buildContext();
app.decorate('kayrosContext', ctx);

await app.register(cors, { origin: [ctx.ALLOWED_ORIGIN, 'null'] });
await app.register(metricsPlugin, { endpoint: '/metrics' });
await app.register(rateLimit, {
  global: true, max: 100, timeWindow: '1 minute',
  errorResponseBuilder: (req, ctx) => ({
    statusCode: 429, error: 'Too Many Requests', message: `Rate limit depasse. Reessayez dans ${Math.ceil((ctx.ttl || 60000) / 1000)}s.`,
  }),
});
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
  if (/^\/v1\/connectors\/(slack|discord|teams)\/configured\/[0-9a-f-]+$/i.test(path)) return;
  if (path === '/mcp') return;
  if (req.headers['x-kayros-secret'] !== ctx.KAYROS_SECRET) return reply.code(401).send({ error: 'non autorise' });
});

await app.register((await import('./routes/health.mjs')).default);
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
await app.register((await import('./routes/positionning.mjs')).default);
await app.register((await import('./routes/swarm.mjs')).default);
await app.register((await import('./routes/sales-oracle.mjs')).default);
await app.register((await import('./routes/mcp.mjs')).default);

const PORT = Number(ctx.PORT || 8787);
app.listen({ port: PORT, host: '0.0.0.0' })
  .then((addr) => app.log.info(`KayrosLab backend sur ${addr}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
