import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import consoleRoute from '../routes/console.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { ConnectorConfigurationService, InMemoryConnectorConfigStore } from '../../../core/connector-config.mjs';

const html = readFileSync(new URL('../../../core/fixtures/crystal-public-geoffroy2104.html', import.meta.url), 'utf8');

async function buildApp({ role = 'comex', fetchImpl = null } = {}) {
  const swarm = new SwarmService({});
  const app = Fastify();
  app.decorate('kayrosContext', {
    hybridGateway: new HybridAgentGateway({ swarm }), connectorConfig: new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore() }),
    engine: { swarm }, crystalKnowsConfigured: false, connectorEncryptionConfigured: false, crystalPublicFetch: fetchImpl,
  });
  app.decorate('requireAuth', async () => ({ sub: 'u1', email: 'op@kayros.test', role, tenantId: 'tenant-a' }));
  await app.register(consoleRoute);
  return { app, swarm };
}

test('enrichissement : page publique Crystal + e-mails, puis impersonator « enriched »', async (t) => {
  const urls = [];
  const { app } = await buildApp({ fetchImpl: async (url) => { urls.push(url); return { ok: true, status: 200, text: async () => html }; } });
  t.after(() => app.close());
  const res = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: {
    consent_confirmed: true, crystal_public_url: 'https://www.crystalknows.com/p/geoffroy2104',
    email_address: 'g@k.fr', emails: [{ from: 'g@k.fr', body: 'Go. On tranche vendredi.' }, { from: 'g@k.fr', body: 'Envoie le devis.' }, { from: 'x@y.fr', body: 'Bonjour à tous !' }],
    x_username: 'geoffroy',
  } });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.deepEqual(urls, ['https://www.crystalknows.com/p/geoffroy2104']);
  assert.equal(body.profile.disc_type, 'D');
  assert.equal(body.profile.descriptif.archetype, 'Captain');
  assert.equal(body.agent.display_name, 'Geoffroy de La Tournelle');
  assert.ok(body.warnings.some((w) => /X_BEARER_TOKEN/.test(w)));
  assert.ok(body.limits.length >= 4);

  const created = await app.inject({ method: 'POST', url: '/v1/console/impersonators', payload: {
    name: 'Geoffroy', source: 'enriched', consent_confirmed: true, human_profile: body.profile,
  } });
  assert.equal(created.statusCode, 201, created.body);
  const agent = created.json().agent;
  assert.equal(created.json().enrichment_error, null);
  assert.equal(agent.human_profile.disc_type, 'D');
  assert.equal(agent.human_profile.descriptif.disc_degrees, 128);
});

test('enrichissement : consentement requis, URL hors /p/ refusée, lecture réseau réservée', async (t) => {
  const { app } = await buildApp({ role: 'contributeur', fetchImpl: async () => { throw new Error('ne doit pas être appelé'); } });
  t.after(() => app.close());
  const noConsent = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { crystal_public_html: html } });
  assert.equal(noConsent.statusCode, 400);
  const network = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { consent_confirmed: true, crystal_public_url: 'geoffroy2104' } });
  assert.equal(network.statusCode, 403);
  // HTML collé : pas d'appel réseau, accessible à tous.
  const pasted = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { consent_confirmed: true, crystal_public_html: html, x_posts: ['Go.', 'On livre.', 'Fais court.'] } });
  assert.equal(pasted.statusCode, 200, pasted.body);
  assert.deepEqual(pasted.json().evidence.map((e) => e.source), ['x', 'crystalknows']);
  const empty = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { consent_confirmed: true } });
  assert.equal(empty.statusCode, 400);
  assert.match(empty.json().error, /aucune source/);
});

test('enrichissement : URL Crystal non publique rejetée', async (t) => {
  const { app } = await buildApp({ fetchImpl: async () => ({ ok: true, text: async () => html }) });
  t.after(() => app.close());
  const bad = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { consent_confirmed: true, crystal_public_url: 'https://www.crystalknows.com/app/people/123' } });
  assert.equal(bad.statusCode, 400);
});
