// Harness partage pour les tests backend Fastify (mock mode).
// Mire en place un contexte kayrosContext + un serveur Fastify minimal
// avec les plugins/routes cibles, sans demarrer d'ecoute ni de secret partage.
import Fastify from 'fastify';
import authPlugin from '../plugins/auth.mjs';
import healthRoute from '../routes/health.mjs';
import authRoutes from '../routes/auth-routes.mjs';
import connectorsRoute from '../routes/connectors.mjs';
import gatesRoute from '../routes/gates.mjs';
import buildContext from '../lib/context.mjs';

export async function buildTestApp(env = {}) {
  const defaults = {
    KAYROS_AUTH_SECRET: 'test-aes-256-secret',
    KAYROS_SECRET: '',            // desactive le preHandler x-kayros-secret
    ANTHROPIC_API_KEY: '', OLLAMA_ENDPOINT: '', MISTRAL_API_KEY: '',
    DATABASE_URL: '', GOOGLE_API_KEY: '', GITHUB_TOKEN: '', GITLAB_TOKEN: '',
    TEAMS_APP_ID: '8f3b2a1c-0000-1111-2222-333344445555',
    TEAMS_BOT_PASSWORD: 'test-bot-secret', TEAMS_WEBHOOK_URL: 'https://webhook.test/teams',
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
  for (const [k, v] of Object.entries(env)) process.env[k] = v;

  const app = Fastify({ logger: false });
  const ctx = await buildContext();
  app.decorate('kayrosContext', ctx);
  await app.register(authPlugin);

  // Reflet du preHandler partage d'index.mjs (no-op quand KAYROS_SECRET vide)
  if (ctx.KAYROS_SECRET) {
    app.addHook('preHandler', async (req, reply) => {
      if (req.method === 'GET') return;
      const p = (req.url || '').split('?')[0];
      if (p.startsWith('/v1/demo/')) return;
      if (req.headers['x-kayros-secret'] !== ctx.KAYROS_SECRET) {
        return reply.code(401).send({ error: 'non autorise' });
      }
    });
  }

  await app.register(healthRoute);
  await app.register(authRoutes);
  await app.register(connectorsRoute);
  await app.register(gatesRoute);
  return { app, ctx };
}

export async function registerComex(ctx, { email = 'comex@test.local', password = 'secret1234', name = 'Comex Test' } = {}) {
  return ctx.auth.register({ email, password, name, role: 'comex', tenantId: 't1' });
}

export async function bearer(ctx, email, password) {
  const { token } = await ctx.auth.login({ email, password });
  return token;
}
