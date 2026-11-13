// Mode public_visit de l'agent personnifié : robots.txt (RFC 9309) respecté avant toute visite.
// Réseau simulé : RobotsGuard injecté (ctx.robotsGuard) avec fetch et DNS factices.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import consoleRoute from '../routes/console.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { ConnectorConfigurationService, InMemoryConnectorConfigStore } from '../../../core/connector-config.mjs';
import { RobotsGuard } from '../../../core/robots-txt.mjs';

const html = readFileSync(new URL('../../../core/fixtures/crystal-public-geoffroy2104.html', import.meta.url), 'utf8');
const ROBOTS = {
  'https://exemple.fr': 'User-agent: *\nDisallow: /prive\n',
  'https://ferme.example': 'User-agent: KayrosLabBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n',
  'https://panne.example': 500,
  'https://www.crystalknows.com': 'User-agent: *\nDisallow: /p/\n',
};

function withEnv(t, vars) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; }
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

async function buildApp(t) {
  const robotsCalls = []; const visited = []; const crystalCalls = [];
  const robotsFetch = async (url) => {
    robotsCalls.push(url);
    const r = ROBOTS[new URL(url).origin];
    if (r === undefined) return new Response('', { status: 404 });
    if (typeof r === 'number') return new Response('err', { status: r });
    return new Response(r, { status: 200 });
  };
  const robotsGuard = new RobotsGuard({ fetchImpl: robotsFetch, lookup: async () => [{ address: '93.184.216.34', family: 4 }] });
  const swarm = new SwarmService({ llm: null });
  const app = Fastify();
  app.decorate('kayrosContext', {
    hybridGateway: new HybridAgentGateway({ swarm }), connectorConfig: new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore() }), engine: { swarm },
    crystalKnowsConfigured: false, connectorEncryptionConfigured: false, xBearerToken: '', robotsGuard,
    publicSourceVisitor: async (urls) => { visited.push(...urls); return urls.map((url) => ({ url, final_url: url, status: 200, title: 'Page', excerpt: 'Texte public.', sha256: 'a'.repeat(64), fetched_at: '2026-11-13T10:00:00.000Z' })); },
    crystalPublicFetch: async (url) => { crystalCalls.push(url); return { ok: true, status: 200, url, text: async () => html }; },
  });
  app.decorate('requireAuth', async () => ({ sub: 'u1', email: 'owner@kayros.test', role: 'comex', tenantId: 'tenant-a' }));
  await app.register(consoleRoute);
  t.after(() => app.close());
  return { app, swarm, visited, robotsCalls, crystalCalls, count: () => swarm.registry.list({ tenantId: 'tenant-a' }).length };
}
const create = (app, payload) => app.inject({ method: 'POST', url: '/v1/console/impersonators', payload });

test('création : page autorisée par robots.txt → 201, trace robots ; page interdite → 403 robots_disallowed, rien créé ni visité', async (t) => {
  withEnv(t, { KAYROS_PUBLIC_SOURCES_VISIT: null });
  const { app, visited, robotsCalls, count } = await buildApp(t);
  const before = count();
  const ko = await create(app, { name: 'Claire Martin', source: 'public', public_sources: ['https://exemple.fr/equipe', 'https://exemple.fr/prive/cv'] });
  assert.equal(ko.statusCode, 403, ko.body);
  assert.equal(ko.json().code, 'robots_disallowed');
  assert.equal(ko.json().refused_urls.length, 1);
  assert.equal(ko.json().refused_urls[0].url, 'https://exemple.fr/prive/cv');
  assert.equal(ko.json().refused_urls[0].robots.rule, 'Disallow: /prive');
  assert.equal(visited.length, 0); assert.equal(count(), before);
  const ok = await create(app, { name: 'Claire Martin', source: 'public', public_sources: ['https://exemple.fr/equipe'] });
  assert.equal(ok.statusCode, 201, ok.body);
  assert.deepEqual(visited, ['https://exemple.fr/equipe']);
  assert.equal(robotsCalls.filter((u) => u === 'https://exemple.fr/robots.txt').length, 1, 'robots.txt mis en cache');
});

test('création : groupe KayrosLabBot interdit, robots.txt en 500 (fail closed), robots.txt 404 permis', async (t) => {
  withEnv(t, { KAYROS_PUBLIC_SOURCES_VISIT: null });
  const { app, visited } = await buildApp(t);
  const ua = await create(app, { name: 'A', source: 'public', public_sources: ['https://ferme.example/a'] });
  assert.equal(ua.statusCode, 403); assert.equal(ua.json().code, 'robots_disallowed');
  const down = await create(app, { name: 'B', source: 'public', public_sources: ['https://panne.example/a'] });
  assert.equal(down.statusCode, 403); assert.equal(down.json().code, 'robots_disallowed');
  assert.match(down.json().refused_urls[0].robots.reason, /injoignable/);
  const none = await create(app, { name: 'C', source: 'public', public_sources: ['https://sans-robots.example/a'] });
  assert.equal(none.statusCode, 201, none.body);
  assert.deepEqual(visited, ['https://sans-robots.example/a']);
});

test('équipe : un membre bloqué par robots.txt → 403 pour toute l’équipe', async (t) => {
  withEnv(t, { KAYROS_PUBLIC_SOURCES_VISIT: null });
  const { app, visited, count } = await buildApp(t);
  const before = count();
  const out = await app.inject({ method: 'POST', url: '/v1/console/impersonator-teams', payload: { name: 'Panel', members: [
    { name: 'A', source: 'public', public_sources: ['https://exemple.fr/a'] },
    { name: 'B', source: 'public', public_sources: ['https://exemple.fr/prive/b'] },
  ] } });
  assert.equal(out.statusCode, 403, out.body);
  assert.equal(out.json().member, 'B'); assert.equal(out.json().code, 'robots_disallowed');
  assert.equal(visited.length, 0); assert.equal(count(), before);
});

test('re-visite d’une persona existante : refus robots tracé (partiel → 200), tout refusé → 403', async (t) => {
  withEnv(t, { KAYROS_PUBLIC_SOURCES_VISIT: null });
  const { app, swarm, visited } = await buildApp(t);
  const mk = (agent_id, public_sources) => swarm.createAgent({ agent_id, role_name: 'Persona', department: 'Externe', seniority: 'executive', primary_focus: 'test',
    metadata: { impersonator: { persona_name: agent_id, source: 'public', public_sources } } }, { tenantId: 'tenant-a', by: 'test' });
  mk('legacy_mixed', ['https://exemple.fr/equipe', 'https://exemple.fr/prive/cv']);
  mk('legacy_blocked', ['https://exemple.fr/prive/cv', 'https://panne.example/x']);
  const mixed = await app.inject({ method: 'POST', url: '/v1/console/impersonators/legacy_mixed/public-sources/visit' });
  assert.equal(mixed.statusCode, 200, mixed.body);
  assert.deepEqual(visited, ['https://exemple.fr/equipe']);
  assert.equal(mixed.json().refused_urls[0].code, 'robots_disallowed');
  const trace = mixed.json().public_evidence.find((e) => e.url === 'https://exemple.fr/prive/cv');
  assert.equal(trace.policy_code, 'robots_disallowed');
  assert.equal(trace.robots.allowed, false);
  const all = await app.inject({ method: 'POST', url: '/v1/console/impersonators/legacy_blocked/public-sources/visit' });
  assert.equal(all.statusCode, 403); assert.equal(all.json().code, 'robots_disallowed');
  assert.equal(all.json().refused_urls.length, 2);
  assert.equal(visited.length, 1);
});

test('enrich CrystalKnows (page publique) : robots.txt interdit → 403, page non demandée', async (t) => {
  const { app, crystalCalls } = await buildApp(t);
  const out = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { consent_confirmed: true, crystal_public_url: 'https://www.crystalknows.com/p/geoffroy2104' } });
  assert.equal(out.statusCode, 403, out.body);
  assert.equal(out.json().code, 'robots_disallowed');
  assert.equal(out.json().source, 'crystalknows');
  assert.equal(out.json().robots.allowed, false);
  assert.equal(crystalCalls.length, 0);
});

test('KAYROS_PUBLIC_SOURCES_VISIT=off sans visiteur : aucune requête robots (rien n’est visité)', async (t) => {
  withEnv(t, { KAYROS_PUBLIC_SOURCES_VISIT: 'off' });
  const { app, robotsCalls } = await buildApp(t);
  app.kayrosContext.publicSourceVisitor = undefined;
  const out = await create(app, { name: 'D', source: 'public', public_sources: ['https://exemple.fr/prive/cv'] });
  assert.equal(out.statusCode, 201, out.body);
  assert.equal(robotsCalls.length, 0);
});
