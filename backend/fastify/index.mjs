import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { createKayrosContext } from './lib/context.mjs';

const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });

await app.register(cors, { origin: true });
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

const ctx = await createKayrosContext();
app.decorate('kayrosContext', ctx);

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
await app.register((await import('./routes/campaigns.mjs')).default);
await app.register((await import('./routes/comments.mjs')).default);
await app.register((await import('./routes/reporting.mjs')).default);
await app.register((await import('./routes/timer.mjs')).default);
await app.register((await import('./routes/connectors.mjs')).default);
await app.register((await import('./routes/positionning.mjs')).default);

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';

try {
  await app.listen({ port, host });
  app.log.info(`KayrosLab API listening on ${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
