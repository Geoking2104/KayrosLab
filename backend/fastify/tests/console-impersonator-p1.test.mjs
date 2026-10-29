import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import consoleRoute from '../routes/console.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { ConnectorConfigurationService, InMemoryConnectorConfigStore } from '../../../core/connector-config.mjs';

const html = readFileSync(new URL('../../../core/fixtures/crystal-public-geoffroy2104.html', import.meta.url), 'utf8');
const res = (status, body) => ({ status, ok: status < 300, json: async () => body });

async function buildApp({ llm = null, extra = {} } = {}) {
  const swarm = new SwarmService({ llm });
  const hybridGateway = new HybridAgentGateway({ swarm });
  const app = Fastify();
  app.decorate('kayrosContext', {
    hybridGateway, connectorConfig: new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore() }), engine: { swarm },
    crystalKnowsConfigured: false, connectorEncryptionConfigured: false, xBearerToken: '', ...extra,
  });
  app.decorate('requireAuth', async () => ({ sub: 'u1', email: 'owner@kayros.test', role: 'comex', tenantId: 'tenant-a' }));
  await app.register(consoleRoute);
  return { app, swarm, hybridGateway };
}

test('disponibilité des chemins et erreurs claires sans jetons serveur', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const p = (await app.inject({ method: 'GET', url: '/v1/console/personality/providers' })).json();
  assert.equal(p.crystalknows_api.ready, false); assert.equal(p.crystalknows_api.env, 'CRYSTALKNOWS_API_TOKEN');
  assert.equal(p.x_api.ready, false); assert.equal(p.x_api.env, 'X_BEARER_TOKEN');
  assert.equal(p.gmail.mode, 'oauth_token_per_request');
  assert.ok(!JSON.stringify(p).match(/Bearer|sk-/));
  const x = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { consent_confirmed: true, x_username: '@geoffroy' } });
  assert.equal(x.statusCode, 503); assert.match(x.json().error, /X_BEARER_TOKEN absent/);
  const withCrystal = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { consent_confirmed: true, crystal_public_html: html, x_username: 'geoffroy' } });
  assert.equal(withCrystal.statusCode, 200); assert.match(withCrystal.json().warnings.join(), /X_BEARER_TOKEN absent/);
  const c = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { consent_confirmed: true, crystal_api: { email: 'a@b.fr' } } });
  assert.equal(c.statusCode, 503); assert.match(c.json().error, /CRYSTALKNOWS_API_TOKEN absent/);
});

test('X_BEARER_TOKEN présent : API X officielle lue', async (t) => {
  const calls = [];
  const xFetch = async (url, opts) => {
    calls.push(opts.headers.authorization);
    if (url.includes('/users/by/username/')) return res(200, { data: { id: '1', username: 'geo', name: 'Geo', description: 'CEO' } });
    return res(200, { data: [{ text: 'On tranche vite.' }, { text: 'Go lundi.' }, { text: 'Chiffre ?' }] });
  };
  const { app } = await buildApp({ extra: { xBearerToken: 'xtok', xFetch } });
  t.after(() => app.close());
  const out = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { consent_confirmed: true, x_username: 'geo' } });
  assert.equal(out.statusCode, 200, out.body);
  assert.ok(out.json().evidence.some((e) => e.source === 'x'));
  assert.equal(calls[0], 'Bearer xtok');
});

test('import Gmail / Outlook sans copier-coller ; jeton refusé → 424', async (t) => {
  const enc = (s) => Buffer.from(s).toString('base64url');
  const mailFetch = async (url, opts) => {
    if (opts.headers.Authorization === 'Bearer badtoken00') return res(401, {});
    if (url.includes('graph.microsoft.com')) return res(200, { value: [{ from: { emailAddress: { address: 'geo@x.fr' } }, subject: 's', body: { contentType: 'text', content: 'Valide. Lance lundi.' } }] });
    if (url.includes('/messages?')) return res(200, { messages: [{ id: 'a' }, { id: 'b' }] });
    return res(200, { payload: { headers: [{ name: 'From', value: 'geo@x.fr' }], parts: [{ mimeType: 'text/plain', body: { data: enc(url.includes('/a') ? 'Go pour vendredi.' : 'Trop long. Résume.') } }] } });
  };
  const { app } = await buildApp({ extra: { mailFetch } });
  t.after(() => app.close());
  const ok = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { consent_confirmed: true, gmail: { access_token: 'goodtoken0' }, outlook: { access_token: 'goodtoken0' }, email_address: 'geo@x.fr' } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().evidence.find((e) => e.source === 'email').samples, 3);
  assert.equal(ok.json().confidence.kind, 'estimate');
  assert.ok(!ok.body.includes('goodtoken0'), 'le jeton n’est jamais renvoyé');
  const bad = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { consent_confirmed: true, gmail: { access_token: 'badtoken00' } } });
  assert.equal(bad.statusCode, 424); assert.match(bad.json().error, /refusé ou expiré/);
});

test('voix avec un vrai modèle : aperçu et mission gardent la réplique du modèle si elle est fidèle', async (t) => {
  const llm = {
    id: 'mistral',
    complete: async (req) => {
      const content = req.messages.map((m) => m.content).join('\n');
      if (req.role === 'impersonator_voice') return { text: 'Quel gain, et pour quand ? Je décide vendredi.', provider: 'mistral' };
      const persona = /VOIX DE LA PERSONA/.test(content);
      return { text: JSON.stringify({ verdict: 'CONDITIONAL_GO', primary_reason: 'ok', simulated_stakeholder_feedback: persona ? 'Je veux le gain chiffré. Décision vendredi.' : '' }), provider: 'mistral' };
    },
  };
  const { app, swarm, hybridGateway } = await buildApp({ llm });
  t.after(() => app.close());
  const enriched = (await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { consent_confirmed: true, crystal_public_html: html } })).json();
  const said = (await app.inject({ method: 'POST', url: '/v1/console/personality/speak', payload: { idea: 'Offre premium', human_profile: enriched.profile } })).json();
  assert.equal(said.source, 'model'); assert.equal(said.model_provider, 'mistral');
  assert.match(said.message, /^Simulation — Quel gain/); assert.ok(said.score.score >= 0.6);
  assert.equal((await app.inject({ method: 'GET', url: '/v1/console/personality/providers' })).json().voice_model.ready, true);

  const created = (await app.inject({ method: 'POST', url: '/v1/console/impersonators', payload: { name: 'Geoffroy', agent_id: 'imp_g', source: 'enriched', consent_confirmed: true, human_profile: enriched.profile } })).json();
  const session = (await app.inject({ method: 'POST', url: '/v1/console/sessions', payload: { name: 'Voix', active_agents: ['cfo', created.agent.agent_id], personality_simulation_enabled: true } })).json();
  const mission = (await app.inject({ method: 'POST', url: `/v1/console/sessions/${session.session.session_id}/run`, payload: { question: 'Offre premium' } })).json();
  const thread = await hybridGateway.waitForThread(mission.thread_id);
  const persona = swarm.getRun(thread.current_run_id, { tenantId: 'tenant-a' }).analyses.find((a) => a.agent_id === 'imp_g');
  assert.equal(persona.persona_voice_fallback, undefined, JSON.stringify(persona));
  assert.equal(persona.simulated_stakeholder_feedback, 'Simulation — Je veux le gain chiffré. Décision vendredi.');
  assert.ok(persona.persona_voice_score.score >= 0.6);
});
