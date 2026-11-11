// Cahier des charges v4, phase 1 : drapeaux KAYROS_PERSONA_PUBLIC_MODEL et KAYROS_MAILBOX_ENRICH.
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import consoleRoute from '../routes/console.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { ConnectorConfigurationService, InMemoryConnectorConfigStore } from '../../../core/connector-config.mjs';

const res = (status, body) => ({ status, ok: status < 300, json: async () => body });

async function buildApp(extra = {}) {
  const swarm = new SwarmService({ llm: null });
  const hybridGateway = new HybridAgentGateway({ swarm });
  const app = Fastify();
  app.decorate('kayrosContext', {
    hybridGateway, connectorConfig: new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore() }), engine: { swarm },
    crystalKnowsConfigured: false, connectorEncryptionConfigured: false, xBearerToken: '', ...extra,
  });
  app.decorate('requireAuth', async () => ({ sub: 'u1', email: 'owner@kayros.test', role: 'comex', tenantId: 'tenant-a' }));
  await app.register(consoleRoute);
  return app;
}

/** Pose des variables d'environnement pour la durée d'un test, puis restaure. */
function withEnv(t, vars) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; }
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

const publicPersona = { name: 'Claire Martin', role: 'DAF', source: 'public', public_sources: ['https://exemple.fr/equipe'], clues: ['Demande toujours le chiffre'] };

test('drapeaux absents : comportement inchangé (pas de vue de conformité, pas de filtre)', async (t) => {
  withEnv(t, { KAYROS_PERSONA_PUBLIC_MODEL: null, KAYROS_MAILBOX_ENRICH: null, KAYROS_PUBLIC_SOURCES_VISIT: 'off' });
  const app = await buildApp(); t.after(() => app.close());
  const p = (await app.inject({ method: 'GET', url: '/v1/console/personality/providers' })).json();
  assert.equal(p.persona_public_model.enabled, false);
  assert.equal(p.gmail.ready, true);
  const created = await app.inject({ method: 'POST', url: '/v1/console/impersonators', payload: { ...publicPersona, clues: ['Délégué syndical, très direct'] } });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().agent.persona_compliance, undefined);
  const enrich = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { emails: ['Je suis syndiqué. Go lundi, envoyez le chiffre.', 'Trop long. Résume.', 'Valide.'] } });
  assert.notEqual(enrich.statusCode, 422);
});

test('KAYROS_MAILBOX_ENRICH=off : Gmail / Outlook → 410, aucun appel réseau, fournisseurs désactivés', async (t) => {
  withEnv(t, { KAYROS_MAILBOX_ENRICH: 'off', KAYROS_PERSONA_PUBLIC_MODEL: null });
  let calls = 0;
  const app = await buildApp({ mailFetch: async () => { calls += 1; return res(200, {}); } }); t.after(() => app.close());
  for (const payload of [{ gmail: { access_token: 'goodtoken0' } }, { outlook: { access_token: 'goodtoken0' } }]) {
    const out = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload });
    assert.equal(out.statusCode, 410, out.body);
    assert.equal(out.json().code, 'mailbox_enrich_disabled');
    assert.ok(!out.body.includes('goodtoken0'));
  }
  assert.equal(calls, 0);
  const p = (await app.inject({ method: 'GET', url: '/v1/console/personality/providers' })).json();
  assert.deepEqual(p.gmail, { ready: false, disabled: true, env: 'KAYROS_MAILBOX_ENRICH' });
  assert.equal(p.outlook.ready, false);
  // Les textes collés restent possibles.
  const pasted = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { emails: ['Go lundi.', 'Trop long. Résume.', 'Valide.'] } });
  assert.equal(pasted.statusCode, 200, pasted.body);
});

test('KAYROS_PERSONA_PUBLIC_MODEL=on : filtre art. 9 bloquant (422) sans renvoyer le texte', async (t) => {
  withEnv(t, { KAYROS_PERSONA_PUBLIC_MODEL: 'on', KAYROS_PUBLIC_SOURCES_VISIT: 'off' });
  const app = await buildApp(); t.after(() => app.close());
  const blocked = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { emails: ['Go lundi.', { subject: 'RDV', body: 'Mon arrêt maladie se termine jeudi' }] } });
  assert.equal(blocked.statusCode, 422, blocked.body);
  assert.equal(blocked.json().code, 'special_category_data');
  assert.deepEqual(blocked.json().findings, [{ field: 'emails', index: 1, categories: ['health'] }]);
  assert.ok(!blocked.body.includes('maladie'));
  const posts = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { x_posts: ['Fier de mon syndicat'] } });
  assert.equal(posts.statusCode, 422);
  const clean = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { emails: ['Go lundi.', 'Trop long. Résume.', 'Valide.'] } });
  assert.equal(clean.statusCode, 200, clean.body);
  const clues = await app.inject({ method: 'POST', url: '/v1/console/impersonators', payload: { ...publicPersona, clues: ['Militante du parti, très directe'] } });
  assert.equal(clues.statusCode, 422);
});

test('KAYROS_PERSONA_PUBLIC_MODEL=on : vue de conformité sur les agents personnifiés seulement', async (t) => {
  withEnv(t, { KAYROS_PERSONA_PUBLIC_MODEL: 'on', KAYROS_PUBLIC_SOURCES_VISIT: 'off' });
  const app = await buildApp(); t.after(() => app.close());
  const created = await app.inject({ method: 'POST', url: '/v1/console/impersonators', payload: publicPersona });
  assert.equal(created.statusCode, 201, created.body);
  const c = created.json().agent.persona_compliance;
  assert.equal(c.legal_basis, 'legitimate_interest');
  assert.equal(c.verification_status, 'estimated');
  assert.equal(c.label, 'Simulation · Estimé');
  assert.ok(c.profile_sources.some((s) => s.type === 'web' && s.url === 'https://exemple.fr/equipe'));
  const list = (await app.inject({ method: 'GET', url: '/v1/console/agents' })).json().agents;
  const persona = list.find((a) => a.agent_id === created.json().agent.agent_id);
  assert.equal(persona.persona_compliance.label, 'Simulation · Estimé');
  assert.ok(list.filter((a) => !a.metadata?.impersonator).every((a) => a.persona_compliance === undefined));
});

test('KAYROS_PERSONA_PUBLIC_MODEL=on : posts X lus par API — sensibles écartés et comptés', async (t) => {
  withEnv(t, { KAYROS_PERSONA_PUBLIC_MODEL: 'on' });
  const xFetch = async (url) => {
    if (url.includes('/users/by/username/')) return res(200, { data: { id: '1', username: 'geo', name: 'Geo', description: 'CEO' } });
    return res(200, { data: [{ text: 'On tranche vite.' }, { text: 'Go lundi.' }, { text: 'Chiffre ?' }, { text: 'Bon ramadan à tous' }] });
  };
  const app = await buildApp({ xBearerToken: 'xtok', xFetch }); t.after(() => app.close());
  const out = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { x_username: 'geo' } });
  assert.equal(out.statusCode, 200, out.body);
  assert.ok(out.json().warnings.some((w) => /1 post\(s\) écarté\(s\)/.test(w)));
  assert.ok(!out.body.includes('ramadan'));
});
