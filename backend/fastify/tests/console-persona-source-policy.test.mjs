// Agent personnifié : chaque source passe par core/source-policy.mjs (finalité person_profiling).
// Réseau entièrement simulé (fetch injectés) ; un refus de politique renvoie 403 et son code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import consoleRoute from '../routes/console.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { ConnectorConfigurationService, InMemoryConnectorConfigStore } from '../../../core/connector-config.mjs';

const html = readFileSync(new URL('../../../core/fixtures/crystal-public-geoffroy2104.html', import.meta.url), 'utf8');
const res = (status, body) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body) });
const enc = (s) => Buffer.from(s).toString('base64url');

function withEnv(t, vars) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; }
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

async function buildApp(t, extra = {}) {
  const swarm = new SwarmService({ llm: null });
  const hybridGateway = new HybridAgentGateway({ swarm });
  const visited = []; const githubCalls = []; const mailCalls = []; const crystalCalls = [];
  const app = Fastify();
  app.decorate('kayrosContext', {
    hybridGateway, connectorConfig: new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore() }), engine: { swarm },
    crystalKnowsConfigured: false, connectorEncryptionConfigured: false, xBearerToken: '',
    publicSourceVisitor: async (urls) => { visited.push(...urls); return urls.map((url) => ({ url, final_url: url, status: 200, title: 'Page publique', excerpt: 'Directrice financière.', sha256: 'a'.repeat(64), fetched_at: '2026-11-13T10:00:00.000Z' })); },
    githubFetch: async (url, init) => {
      githubCalls.push({ url, auth: init.headers.authorization || null });
      const path = url.replace('https://api.github.com', '');
      if (path === '/users/octocat') return new Response(JSON.stringify({ login: 'octocat', name: 'The Octocat', bio: 'Ingénieure plateforme' }), { status: 200 });
      if (path.startsWith('/users/octocat/repos')) return new Response(JSON.stringify([{ name: 'infra', language: 'Go', description: 'outils' }]), { status: 200 });
      return new Response('{}', { status: 404 });
    },
    mailFetch: async (url, opts) => {
      mailCalls.push(url);
      if (url.includes('graph.microsoft.com')) return res(200, { value: [{ from: { emailAddress: { address: 'geo@x.fr' } }, subject: 's', body: { contentType: 'text', content: 'Valide. Lance lundi.' } }] });
      if (url.includes('/messages?')) return res(200, { messages: [{ id: 'a' }] });
      return res(200, { payload: { headers: [{ name: 'From', value: 'geo@x.fr' }], parts: [{ mimeType: 'text/plain', body: { data: enc('Go pour vendredi. Trop long, résume.') } }] } });
    },
    crystalPublicFetch: async (url) => { crystalCalls.push(url); return { ok: true, status: 200, url, text: async () => html }; },
    ...extra,
  });
  app.decorate('requireAuth', async () => ({ sub: 'u1', email: 'owner@kayros.test', role: 'comex', tenantId: 'tenant-a' }));
  await app.register(consoleRoute);
  t.after(() => app.close());
  const agentCount = () => swarm.registry.list({ tenantId: 'tenant-a' }).length;
  return { app, swarm, visited, githubCalls, mailCalls, crystalCalls, agentCount };
}

const enrich = (app, payload) => app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { consent_confirmed: true, ...payload } });
const create = (app, payload) => app.inject({ method: 'POST', url: '/v1/console/impersonators', payload });
const viaOf = (out, type) => out.json().profile.profile_sources.find((s) => s.source === type)?.collected_via || [];

test('enrich : Gmail / Outlook actifs par défaut, provenance gmail/outlook sur les e-mails', async (t) => {
  withEnv(t, { KAYROS_MAILBOX_ENRICH: null, KAYROS_PERSONA_PUBLIC_MODEL: null });
  const { app, mailCalls } = await buildApp(t);
  const out = await enrich(app, { gmail: { access_token: 'goodtoken0' }, outlook: { access_token: 'goodtoken0' }, email_address: 'geo@x.fr' });
  assert.equal(out.statusCode, 200, out.body);
  assert.ok(mailCalls.length >= 2);
  const via = viaOf(out, 'email');
  assert.deepEqual(via.map((v) => `${v.source}/${v.mode}/${v.scope}`), ['gmail/api/messages', 'outlook/api/messages']);
  assert.ok(via.every((v) => /^(gmail|outlook)@2026-11-1\d$/.test(v.terms_version) && v.collected_at && v.policy_version));
  assert.ok(!out.body.includes('goodtoken0'));
});

test('enrich : KAYROS_MAILBOX_ENRICH=off → 410 inchangé (code policy source_disabled), aucun appel', async (t) => {
  withEnv(t, { KAYROS_MAILBOX_ENRICH: 'off' });
  const { app, mailCalls } = await buildApp(t);
  for (const payload of [{ gmail: { access_token: 'goodtoken0' } }, { outlook: { access_token: 'goodtoken0' } }]) {
    const out = await enrich(app, { ...payload, emails: ['Bonjour'] });
    assert.equal(out.statusCode, 410);
    assert.equal(out.json().code, 'mailbox_enrich_disabled');
    assert.equal(out.json().policy_code, 'source_disabled');
  }
  assert.equal(mailCalls.length, 0);
});

test('enrich : textes collés, archive X, export LinkedIn, Crystal (HTML, page publique, export) autorisés et tracés', async (t) => {
  withEnv(t, { KAYROS_PERSONA_PUBLIC_MODEL: null });
  const { app, crystalCalls } = await buildApp(t);
  const pasted = await enrich(app, { emails: ['Go lundi. Résume.', 'Chiffre ? Délai ?'], x_posts: ['On tranche vite.', 'Go.'] });
  assert.equal(pasted.statusCode, 200, pasted.body);
  assert.deepEqual(viaOf(pasted, 'email').map((v) => `${v.source}/${v.scope}`), ['user_text/emails']);
  assert.deepEqual(viaOf(pasted, 'x').map((v) => `${v.source}/${v.scope}`), ['user_text/x_posts']);
  const li = await enrich(app, { linkedin_export: { 'Profile.csv': 'First Name,Last Name,Headline\nClaire,Martin,DAF' } });
  assert.equal(li.statusCode, 200, li.body);
  assert.deepEqual(viaOf(li, 'linkedin').map((v) => `${v.source}/${v.mode}/${v.scope}`), ['linkedin/import/data_export']);
  const page = await enrich(app, { crystal_public_url: 'https://www.crystalknows.com/p/geoffroy2104' });
  assert.equal(page.statusCode, 200, page.body);
  assert.equal(crystalCalls.length, 1);
  assert.deepEqual(viaOf(page, 'crystalknows').map((v) => `${v.source}/${v.mode}/${v.scope}`), ['crystalknows/public_visit/public_profile']);
  const pastedHtml = await enrich(app, { crystal_public_html: html });
  assert.deepEqual(viaOf(pastedHtml, 'crystalknows').map((v) => v.scope), ['public_page_html']);
});

test('enrich : X par API avec jeton (provenance x/api), filtre art. 9 (422) conservé après la politique', async (t) => {
  withEnv(t, { KAYROS_PERSONA_PUBLIC_MODEL: 'on' });
  const xFetch = async (url) => (url.includes('/users/by/username/')
    ? res(200, { data: { id: '1', username: 'geo', name: 'Geo', description: 'CEO' } })
    : res(200, { data: [{ text: 'On tranche vite.' }, { text: 'Go lundi.' }] }));
  const { app } = await buildApp(t, { xBearerToken: 'xtok', xFetch });
  const out = await enrich(app, { x_username: 'geo' });
  assert.equal(out.statusCode, 200, out.body);
  assert.deepEqual(viaOf(out, 'x').map((v) => `${v.source}/${v.mode}/${v.scope}`), ['x/api/profile']);
  const sensitive = await enrich(app, { emails: ['Je suis en arrêt maladie depuis lundi.'] });
  assert.equal(sensitive.statusCode, 422);
  assert.equal(sensitive.json().code, 'special_category_data');
});

test('persona : LinkedIn par API (linkedin_url) refusé 403 avant création ; export LinkedIn accepté', async (t) => {
  withEnv(t, { KAYROS_PUBLIC_SOURCES_VISIT: null });
  const { app, agentCount } = await buildApp(t);
  const before = agentCount();
  const refused = await create(app, { name: 'Sarah Jenkins', source: 'linkedin', linkedin_url: 'https://www.linkedin.com/in/sarah' });
  assert.equal(refused.statusCode, 403, refused.body);
  assert.equal(refused.json().code, 'mode_not_allowed');
  assert.equal(refused.json().source, 'linkedin');
  assert.equal(refused.json().mode, 'api');
  assert.equal(agentCount(), before, 'aucun agent créé');
  const exported = await create(app, { name: 'Sarah Jenkins', source: 'export', export_source: 'linkedin', profile_data: { localizedFirstName: 'Sarah', localizedLastName: 'Jenkins', localizedHeadline: 'CFO' } });
  assert.equal(exported.statusCode, 201, exported.body);
  const sources = exported.json().agent.human_profile.profile_sources;
  assert.equal(sources.find((s) => s.source === 'linkedin').collected_via[0].mode, 'import');
});

test('persona : URLs X, LinkedIn, Reddit, Discord refusées (403, refused_urls), rien n’est visité', async (t) => {
  withEnv(t, { KAYROS_PUBLIC_SOURCES_VISIT: null });
  const { app, visited, githubCalls, agentCount } = await buildApp(t);
  const before = agentCount();
  for (const [url, source] of [['https://x.com/claire', 'x'], ['https://twitter.com/claire', 'x'], ['https://fr.linkedin.com/in/claire', 'linkedin'], ['https://www.reddit.com/user/claire', 'reddit'], ['https://discord.gg/abc', 'discord']]) {
    const out = await create(app, { name: 'Claire Martin', source: 'public', public_sources: ['https://exemple.fr/equipe', url] });
    assert.equal(out.statusCode, 403, `${url} ${out.body}`);
    assert.equal(out.json().code, 'mode_not_allowed');
    assert.equal(out.json().purpose, 'person_profiling');
    assert.deepEqual(out.json().refused_urls, [{ url, source, mode: 'public_visit', code: 'mode_not_allowed' }]);
  }
  assert.equal(visited.length, 0);
  assert.equal(githubCalls.length, 0);
  assert.equal(agentCount(), before);
});

test('persona : page web visitée, GitHub lu par API REST seulement ; provenance dans la vue de conformité', async (t) => {
  withEnv(t, { KAYROS_PUBLIC_SOURCES_VISIT: null, KAYROS_PERSONA_PUBLIC_MODEL: 'on', GITHUB_TOKEN: 'ghtok' });
  const { app, visited, githubCalls } = await buildApp(t);
  const out = await create(app, { name: 'Claire Martin', source: 'public', public_sources: ['https://exemple.fr/equipe', 'https://github.com/octocat'] });
  assert.equal(out.statusCode, 201, out.body);
  assert.deepEqual(visited, ['https://exemple.fr/equipe']);
  assert.ok(githubCalls.length === 2 && githubCalls.every((c) => c.url.startsWith('https://api.github.com/') && c.auth === 'Bearer ghtok'));
  const evidence = out.json().agent.metadata.impersonator.public_evidence;
  assert.equal(evidence.find((e) => e.url === 'https://exemple.fr/equipe').collection.source, 'web');
  assert.equal(evidence.find((e) => e.url === 'https://github.com/octocat').collection.source, 'github');
  const view = out.json().agent.persona_compliance.profile_sources;
  const gh = view.find((s) => s.url === 'https://github.com/octocat');
  assert.equal(gh.type, 'github'); assert.equal(gh.mode, 'api');
  assert.match(gh.terms_version, /^github@/); assert.ok(gh.collected_at);
  const web = view.find((s) => s.url === 'https://exemple.fr/equipe');
  assert.equal(web.terms_version, 'web@2026-11-13'); assert.equal(web.collected_at, '2026-11-13T10:00:00.000Z');
  // Label Estimé / Vérifié inchangé.
  assert.equal(out.json().agent.persona_compliance.label, 'Simulation · Estimé');
});

test('équipe de personas : un membre refusé → 403 pour toute l’équipe, rien créé', async (t) => {
  withEnv(t, { KAYROS_PUBLIC_SOURCES_VISIT: null });
  const { app, visited, agentCount } = await buildApp(t);
  const before = agentCount();
  const out = await app.inject({ method: 'POST', url: '/v1/console/impersonator-teams', payload: { name: 'Panel', members: [
    { name: 'A', source: 'public', public_sources: ['https://exemple.fr/a'] },
    { name: 'B', source: 'public', public_sources: ['https://www.reddit.com/user/b'] },
  ] } });
  assert.equal(out.statusCode, 403, out.body);
  assert.equal(out.json().member, 'B');
  assert.equal(out.json().refused_urls[0].source, 'reddit');
  assert.equal(visited.length, 0);
  assert.equal(agentCount(), before);
});

test('re-visite : URLs héritées refusées tracées (policy_code), toutes refusées → 403', async (t) => {
  withEnv(t, { KAYROS_PUBLIC_SOURCES_VISIT: null });
  const { app, swarm, visited } = await buildApp(t);
  const mk = (agent_id, public_sources) => swarm.createAgent({
    agent_id, role_name: 'Persona', department: 'Externe', seniority: 'executive', primary_focus: 'test',
    metadata: { impersonator: { persona_name: agent_id, source: 'public', public_sources } },
  }, { tenantId: 'tenant-a', by: 'test' });
  mk('legacy_mixed', ['https://exemple.fr/a', 'https://x.com/legacy']);
  mk('legacy_x', ['https://x.com/legacy']);
  const mixed = await app.inject({ method: 'POST', url: '/v1/console/impersonators/legacy_mixed/public-sources/visit' });
  assert.equal(mixed.statusCode, 200, mixed.body);
  assert.deepEqual(visited, ['https://exemple.fr/a']);
  assert.deepEqual(mixed.json().refused_urls, [{ url: 'https://x.com/legacy', source: 'x', mode: 'public_visit', code: 'mode_not_allowed' }]);
  assert.equal(mixed.json().public_evidence.find((e) => e.url === 'https://x.com/legacy').policy_code, 'mode_not_allowed');
  const allRefused = await app.inject({ method: 'POST', url: '/v1/console/impersonators/legacy_x/public-sources/visit' });
  assert.equal(allRefused.statusCode, 403);
  assert.equal(allRefused.json().code, 'mode_not_allowed');
  assert.equal(visited.length, 1);
});

test('imports de profil d’un agent : LinkedIn par API → 403, export → 201 ; aperçu DISC autorisé', async (t) => {
  const { app, swarm } = await buildApp(t);
  swarm.createAgent({ agent_id: 'cfo_x', role_name: 'CFO', department: 'Finance', seniority: 'executive', primary_focus: 'chiffres' }, { tenantId: 'tenant-a', by: 'test' });
  const api = await app.inject({ method: 'POST', url: '/v1/console/agents/cfo_x/personality', payload: { consent_confirmed: true, imports: [{ source: 'linkedin', linkedin_url: 'https://www.linkedin.com/in/sarah' }] } });
  assert.equal(api.statusCode, 403, api.body);
  assert.equal(api.json().code, 'mode_not_allowed');
  const exp = await app.inject({ method: 'POST', url: '/v1/console/agents/cfo_x/personality', payload: { consent_confirmed: true, imports: [{ source: 'linkedin', profile_data: { localizedFirstName: 'Sarah', localizedLastName: 'J' } }] } });
  assert.equal(exp.statusCode, 200, exp.body);
  const disc = await app.inject({ method: 'POST', url: '/v1/console/personality/preview', payload: { consent_confirmed: true, source: 'disc', disc_type: 'Di' } });
  assert.equal(disc.statusCode, 200, disc.body);
  const crystal = await app.inject({ method: 'POST', url: '/v1/console/personality/preview', payload: { consent_confirmed: true, source: 'crystalknows', email: 'a@b.fr' } });
  assert.equal(crystal.statusCode, 503, 'API Crystal autorisée par la politique, mais non configurée');
});

test('API swarm : import LinkedIn par API → 403 (ProfileImportService), export accepté', async (t) => {
  const { bearer, buildTestApp, registerComex } = await import('./test-helpers.mjs');
  const { app, ctx } = await buildTestApp();
  t.after(() => app.close());
  await registerComex(ctx);
  const auth = { authorization: `Bearer ${await bearer(ctx, 'comex@test.local', 'secret1234')}` };
  const created = await app.inject({ method: 'POST', url: '/v1/swarm/agents', headers: auth, payload: { agent_id: 'cfo_pol', role_name: 'CFO', department: 'Finance', seniority: 'executive', primary_focus: 'chiffres' } });
  assert.equal(created.statusCode, 201, created.body);
  const api = await app.inject({ method: 'POST', url: '/v1/swarm/agents/cfo_pol/personality/import', headers: auth, payload: { consent_confirmed: true, imports: [{ source: 'linkedin', profile_url: 'https://linkedin.com/in/sarah' }] } });
  assert.equal(api.statusCode, 403, api.body);
  assert.equal(api.json().code, 'mode_not_allowed');
  assert.equal(api.json().source, 'linkedin');
  const exp = await app.inject({ method: 'POST', url: '/v1/swarm/agents/cfo_pol/personality/import', headers: auth, payload: { consent_confirmed: true, imports: [{ source: 'linkedin', profile_data: { localizedFirstName: 'Sarah', localizedLastName: 'J' } }] } });
  assert.equal(exp.statusCode, 201, exp.body);
});
