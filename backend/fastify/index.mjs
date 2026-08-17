import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import metricsPlugin from 'fastify-metrics';
import buildContext from './lib/context.mjs';
import authPlugin from './plugins/auth.mjs';

const app = Fastify({ logger: true, bodyLimit: 1048576 });

// --- initialisation du contexte partage ---
const ctx = await buildContext();
app.decorate('kayrosContext', ctx);

// --- plugins globaux ---
// Keep the production site whitelisted and allow the standalone HTML demo
// when it is opened directly from disk (browsers send `Origin: null`).
await app.register(cors, { origin: [ctx.ALLOWED_ORIGIN, 'null'] });
await app.register(metricsPlugin, { endpoint: '/metrics' });
await app.register(rateLimit, {
  global: true, max: 100, timeWindow: '1 minute',
  errorResponseBuilder: (req, ctx) => ({
    statusCode: 429, error: 'Too Many Requests', message: `Rate limit depasse. Reessayez dans ${Math.ceil((ctx.ttl || 60000) / 1000)}s.`,
  }),
});
await app.register(authPlugin);

// --- middleware secret partage ---
// Routes /v1/demo/* are public (HTML demo, no client-side key).
app.addHook('preHandler', async (req, reply) => {
  if (!ctx.KAYROS_SECRET) return;
  if (req.method === 'GET') return;
  const path = (req.url || '').split('?')[0];
  if (path.startsWith('/v1/demo/')) return;
  if (path === '/mcp') return; // dedicated scoped Bearer authentication
  if (req.headers['x-kayros-secret'] !== ctx.KAYROS_SECRET) return reply.code(401).send({ error: 'non autorise' });
});

// --- routes ---
await app.register((await import('./routes/health.mjs')).default);
await app.register((await import('./routes/llm.mjs')).default);
await app.register((await import('./routes/novelty.mjs')).default);
await app.register((await import('./routes/cycle.mjs')).default);
await app.register((await import('./routes/memory.mjs')).default);
await app.register((await import('./routes/demo-report-leads.mjs')).default);
await app.register((await import('./routes/auth-routes.mjs')).default);
await app.register((await import('./routes/ideas.mjs')).default);
await app.register((await import('./routes/portfolio.mjs')).default);
await app.register((await import('./routes/impact.mjs')).default);
await app.register((await import('./routes/gates.mjs')).default);
await app.register((await import('./routes/resume.mjs')).default);
await app.register((await import('./routes/demo-cycle.mjs')).default);
await app.register((await import('./routes/campaigns.mjs')).default);
await app.register((await import('./routes/comments.mjs')).default);
await app.register((await import('./routes/reporting.mjs')).default);
await app.register((await import('./routes/timer.mjs')).default);
await app.register((await import('./routes/connectors.mjs')).default);
await app.register((await import('./routes/positionning.mjs')).default);
await app.register((await import('./routes/swarm.mjs')).default);
await app.register((await import('./routes/mcp.mjs')).default);

// --- demarrage ---
const PORT = Number(ctx.PORT || 8787);
app.listen({ port: PORT, host: '0.0.0.0' })
  .then((addr) => app.log.info(`KayrosLab backend sur ${addr}`))
  .catch((e) => { app.log.error(e); process.exit(1); });
