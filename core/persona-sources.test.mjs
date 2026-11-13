import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERSONA_PURPOSE, assertPersonaCollection, evaluatePersonaCollection, classifyPersonaUrl, planPersonaUrls,
  parseGitHubPersonaUrl, collectGitHubPersonaEvidence, visitPersonaUrls, policyRefusalBody, provenanceOfProfileSource,
  assertProfileImportsAllowed, classifyProfileImport,
} from './persona-sources.mjs';
import { SOURCE_POLICY_VERSION, SourcePolicyError } from './source-policy.mjs';
import { ProfileImportService, normalizeHumanProfile } from './personality.mjs';
import { normalizePublicEvidence } from './public-sources.mjs';
import { personaComplianceView } from './persona-compliance.mjs';

const allowed = (args) => {
  const out = evaluatePersonaCollection(args);
  assert.equal(out.allowed, true, JSON.stringify(out));
  assert.equal(out.purpose, PERSONA_PURPOSE);
  assert.ok(out.termsVersion.startsWith(`${out.source}@`));
  return out;
};
const refused = (args, code) => {
  const out = evaluatePersonaCollection(args);
  assert.equal(out.allowed, false, JSON.stringify(out));
  assert.equal(out.code, code);
  return out;
};

test('persona : sources et modes autorisés (finalité person_profiling)', () => {
  // GitHub : API seulement, profil / dépôts / README de la cible.
  for (const scope of ['profile', 'repos', 'readme']) allowed({ source: 'github', mode: 'api', scope, env: {} });
  // X : API seulement, avec jeton (nom actuel ou historique).
  allowed({ source: 'x', mode: 'api', scope: 'profile', env: { X_API_BEARER_TOKEN: 't' } });
  allowed({ source: 'x', mode: 'api', scope: 'posts', env: { X_BEARER_TOKEN: 't' } });
  // Textes fournis par l'utilisateur KayrosLab.
  for (const scope of ['emails', 'x_posts', 'x_archive']) allowed({ source: 'user_text', mode: 'import', scope, env: {} });
  // Boîtes mail : actives par défaut et pour toute valeur autre que « off ».
  allowed({ source: 'gmail', mode: 'api', scope: 'messages', env: {} });
  allowed({ source: 'outlook', mode: 'api', scope: 'messages', env: { KAYROS_MAILBOX_ENRICH: 'on' } });
  // Imports et saisies existants.
  for (const scope of ['data_export', 'profile_data', 'reference_url']) allowed({ source: 'linkedin', mode: 'import', scope, env: {} });
  allowed({ source: 'crystalknows', mode: 'api', scope: 'profile', env: {} });
  allowed({ source: 'crystalknows', mode: 'public_visit', scope: 'public_profile', env: {} });
  for (const scope of ['json_export', 'public_page_html', 'profile_data']) allowed({ source: 'crystalknows', mode: 'import', scope, env: {} });
  for (const scope of ['manual_profile', 'disc_type', 'clues', 'enriched_profile']) allowed({ source: 'manual', mode: 'import', scope, env: {} });
  allowed({ source: 'web', mode: 'public_visit', scope: 'professional_page', env: {} });
});

test('persona : refus (Reddit, Discord, LinkedIn hors export, tout scraping, X sans jeton, mailbox off)', () => {
  refused({ source: 'reddit', mode: 'api', scope: 'posts', env: { KAYROS_REDDIT_COMMERCIAL_AGREEMENT: 'signed' } }, 'purpose_not_allowed');
  refused({ source: 'reddit', mode: 'api', scope: 'posts', env: {} }, 'purpose_not_allowed');
  for (const mode of ['api', 'scrape', 'public_visit', 'import']) refused({ source: 'discord', mode, env: {} }, 'mode_not_allowed');
  refused({ source: 'linkedin', mode: 'api', scope: 'profile', env: {} }, 'mode_not_allowed');
  refused({ source: 'linkedin', mode: 'scrape', env: {} }, 'mode_not_allowed');
  refused({ source: 'linkedin', mode: 'public_visit', env: {} }, 'mode_not_allowed');
  for (const source of ['github', 'x', 'reddit', 'linkedin', 'crystalknows', 'gmail', 'outlook', 'user_text', 'manual', 'web', 'discord']) {
    // GitHub scrape existe pour les signaux de sujet : refusé ici par la finalité.
    refused({ source, mode: 'scrape', scope: 'profile', env: { X_API_BEARER_TOKEN: 't' } }, source === 'github' ? 'purpose_not_allowed' : 'mode_not_allowed');
  }
  refused({ source: 'github', mode: 'public_visit', env: {} }, 'mode_not_allowed');
  refused({ source: 'github', mode: 'api', scope: 'repositories', env: {} }, 'scope_not_allowed');
  refused({ source: 'x', mode: 'api', scope: 'profile', env: {} }, 'source_disabled');
  refused({ source: 'x', mode: 'public_visit', env: { X_API_BEARER_TOKEN: 't' } }, 'mode_not_allowed');
  refused({ source: 'gmail', mode: 'api', scope: 'messages', env: { KAYROS_MAILBOX_ENRICH: 'off' } }, 'source_disabled');
  refused({ source: 'outlook', mode: 'api', scope: 'messages', env: { KAYROS_MAILBOX_ENRICH: ' OFF ' } }, 'source_disabled');
  refused({ source: 'user_text', mode: 'import', scope: 'clues', env: {} }, 'scope_not_allowed');
  refused({ source: 'web', mode: 'public_visit', env: {} }, 'scope_not_allowed');
  assert.throws(() => assertPersonaCollection({ source: 'tiktok', mode: 'api', env: {} }), (e) => e instanceof SourcePolicyError && e.code === 'unknown_source');
});

test('persona : sources réservées au profilage refusées pour les signaux de sujet', async () => {
  const { evaluateCollection } = await import('./source-policy.mjs');
  for (const source of ['linkedin', 'crystalknows', 'gmail', 'user_text', 'manual', 'web']) {
    const out = evaluateCollection({ source, mode: source === 'web' ? 'public_visit' : source === 'gmail' ? 'api' : 'import', purpose: 'topic_signal', env: {} });
    assert.equal(out.allowed, false, source);
    assert.equal(out.code, 'purpose_not_allowed', source);
  }
});

test('policyRefusalBody : code, source, mode, version, sans secret', () => {
  const body = policyRefusalBody(evaluatePersonaCollection({ source: 'reddit', mode: 'api', scope: 'posts', env: { KAYROS_REDDIT_COMMERCIAL_AGREEMENT: 'signed' } }));
  assert.equal(body.code, 'purpose_not_allowed');
  assert.equal(body.source, 'reddit');
  assert.equal(body.purpose, 'person_profiling');
  assert.equal(body.policy_version, SOURCE_POLICY_VERSION);
  assert.doesNotMatch(JSON.stringify(body), /signed/);
});

test('classifyPersonaUrl : plateformes routées vers leur entrée, GitHub par API', () => {
  assert.deepEqual(parseGitHubPersonaUrl('https://github.com/octo-cat/hello.git'), { login: 'octo-cat', repo: 'hello' });
  assert.equal(parseGitHubPersonaUrl('https://github.com/orgs/acme'), null);
  assert.equal(parseGitHubPersonaUrl('https://gitlab.com/a'), null);
  assert.equal(classifyPersonaUrl('https://github.com/octocat').scope, 'profile');
  assert.equal(classifyPersonaUrl('https://github.com/octocat/hello').scope, 'readme');
  assert.equal(classifyPersonaUrl('https://github.com/search?q=a').mode, 'public_visit');
  assert.equal(classifyPersonaUrl('https://mobile.twitter.com/a').source, 'x');
  assert.equal(classifyPersonaUrl('https://fr.linkedin.com/in/a').source, 'linkedin');
  assert.equal(classifyPersonaUrl('https://old.reddit.com/u/a').source, 'reddit');
  assert.equal(classifyPersonaUrl('https://discord.gg/abc').source, 'discord');
  assert.equal(classifyPersonaUrl('https://www.crystalknows.com/p/a').source, 'crystalknows');
  assert.equal(classifyPersonaUrl('https://exemple.fr/equipe').source, 'web');
  assert.equal(classifyPersonaUrl('pas-une-url').source, 'web');
  const plan = planPersonaUrls(['https://exemple.fr/a', 'https://x.com/a', 'https://github.com/octocat', 'https://www.linkedin.com/in/a', 'https://reddit.com/u/a', 'https://discord.com/x', 'https://exemple.fr/a'], { env: {} });
  assert.deepEqual(plan.allowed.map((a) => a.url), ['https://exemple.fr/a', 'https://github.com/octocat']);
  assert.deepEqual(plan.refused.map((r) => [r.source, r.code]), [['x', 'mode_not_allowed'], ['linkedin', 'mode_not_allowed'], ['reddit', 'mode_not_allowed'], ['discord', 'mode_not_allowed']]);
});

function githubMock(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const path = url.replace('https://api.github.com', '');
    const hit = routes[path];
    if (!hit) return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(typeof hit === 'string' ? hit : JSON.stringify(hit), { status: 200 });
  };
  return { fetchImpl, calls };
}

test('GitHub persona : API REST (profil, dépôts, README), provenance et jeton', async () => {
  const { fetchImpl, calls } = githubMock({
    '/users/octocat': { login: 'octocat', name: 'The Octocat', company: 'GitHub', location: 'SF', bio: 'Builds things' },
    '/users/octocat/repos?type=owner&sort=pushed&per_page=5': [{ name: 'hello', language: 'JS', description: 'demo' }, { name: 'forked', fork: true }],
    '/repos/octocat/hello/readme': '# Hello\nA demo repository.',
  });
  const rec = await collectGitHubPersonaEvidence('https://github.com/octocat/hello', { fetchImpl, token: 'tok', env: {}, now: () => new Date('2026-11-13T00:00:00Z') });
  assert.equal(rec.error, null);
  assert.equal(rec.status, 200);
  assert.equal(rec.title, 'The Octocat · GitHub · SF');
  assert.match(rec.excerpt, /Builds things — Dépôts publics : hello \(JS\) : demo — README hello : # Hello A demo repository\./);
  assert.doesNotMatch(rec.excerpt, /forked/);
  assert.match(rec.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(rec.collection, { source: 'github', mode: 'api', scope: 'readme', collected_at: '2026-11-13T00:00:00.000Z', terms_version: 'github@2026-11-12', policy_version: SOURCE_POLICY_VERSION });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.url.startsWith('https://api.github.com/') && c.init.headers.authorization === 'Bearer tok'));
  // Jamais la page github.com.
  assert.ok(!calls.some((c) => c.url.includes('://github.com')));
});

test('GitHub persona : erreur API tracée, URL non profil refusée sans réseau', async () => {
  const { fetchImpl, calls } = githubMock({});
  const rec = await collectGitHubPersonaEvidence('https://github.com/ghost', { fetchImpl, env: {} });
  assert.equal(rec.status, 404);
  assert.match(rec.error, /HTTP 404/);
  const bad = await collectGitHubPersonaEvidence('https://github.com/orgs/acme', { fetchImpl, env: {} });
  assert.equal(bad.policy_code, 'scope_not_allowed');
  assert.equal(calls.length, 1);
});

test('visitPersonaUrls : refus tracés sans requête, pages par la visite, GitHub par API, ordre conservé', async () => {
  const visited = [];
  const visit = async (urls) => { visited.push(...urls); return urls.map((url) => ({ url, status: 200, title: 'Page', excerpt: 'Texte', fetched_at: '2026-11-13T01:00:00.000Z', error: null })); };
  const { fetchImpl, calls } = githubMock({ '/users/octocat': { login: 'octocat' }, '/users/octocat/repos?type=owner&sort=pushed&per_page=5': [] });
  const out = await visitPersonaUrls(['https://x.com/a', 'https://exemple.fr/p', 'https://github.com/octocat', 'https://www.linkedin.com/in/a'], { visit, githubFetch: fetchImpl, env: {} });
  assert.deepEqual(out.map((r) => r.url), ['https://x.com/a', 'https://exemple.fr/p', 'https://github.com/octocat', 'https://www.linkedin.com/in/a']);
  assert.deepEqual(visited, ['https://exemple.fr/p']);
  assert.equal(calls.length, 2);
  assert.equal(out[0].policy_code, 'mode_not_allowed');
  assert.match(out[0].error, /politique de collecte : mode_not_allowed \(x\/public_visit\)/);
  assert.equal(out[3].policy_code, 'mode_not_allowed');
  assert.deepEqual(out[1].collection, { source: 'web', mode: 'public_visit', scope: 'professional_page', collected_at: '2026-11-13T01:00:00.000Z', terms_version: 'web@2026-11-13', policy_version: SOURCE_POLICY_VERSION });
  assert.equal(out[2].collection.source, 'github');
  // La trace persistée garde la provenance et le code de refus.
  const kept = normalizePublicEvidence(out);
  assert.equal(kept[1].collection.terms_version, 'web@2026-11-13');
  assert.equal(kept[0].policy_code, 'mode_not_allowed');
});

test('imports de profil : export fourni accepté, API LinkedIn refusée avant tout appel', async () => {
  assert.deepEqual(classifyProfileImport({ source: 'linkedin', profile_data: {} }), { source: 'linkedin', mode: 'import', scope: 'profile_data' });
  assert.deepEqual(classifyProfileImport({ source: 'crystalknows', email: 'a@b.c' }), { source: 'crystalknows', mode: 'api', scope: 'profile' });
  assert.throws(() => assertProfileImportsAllowed([{ source: 'linkedin', linkedin_url: 'https://linkedin.com/in/a' }], { env: {} }), (e) => e.code === 'mode_not_allowed');
  let adapterCalls = 0;
  const adapter = { importProfile: async () => { adapterCalls += 1; return { profile_sources: [] }; } };
  const service = new ProfileImportService({ linkedinAdapter: adapter, crystalKnowsAdapter: { importProfile: async () => normalizeHumanProfile({ disc_type: 'D', profile_sources: [{ source: 'crystalknows', import_mode: 'official_api' }] }) }, env: {} });
  await assert.rejects(() => service.importProfile({ source: 'linkedin', consent_confirmed: true, linkedin_url: 'https://linkedin.com/in/a' }), (e) => e instanceof SourcePolicyError && e.code === 'mode_not_allowed');
  assert.equal(adapterCalls, 0);
  const li = await service.importProfile({ source: 'linkedin', consent_confirmed: true, profile_data: { localizedFirstName: 'Sarah', localizedLastName: 'J' } });
  assert.equal(li.profile_sources[0].collected_via[0].source, 'linkedin');
  assert.equal(li.profile_sources[0].collected_via[0].mode, 'import');
  const cr = await service.importProfile({ source: 'crystalknows', consent_confirmed: true, email: 'a@b.c' });
  assert.deepEqual({ ...cr.profile_sources[0].collected_via[0], collected_at: null }, { source: 'crystalknows', mode: 'api', scope: 'profile', collected_at: null, terms_version: 'crystalknows@2026-11-13', policy_version: SOURCE_POLICY_VERSION });
});

test('provenance : stockée à la collecte, sinon déduite ; visible dans la vue de conformité', () => {
  const stored = provenanceOfProfileSource({ source: 'email', collected_via: [{ source: 'gmail', mode: 'api', scope: 'messages', collected_at: '2026-11-13T00:00:00Z', terms_version: 'gmail@2026-11-13', policy_version: SOURCE_POLICY_VERSION }] });
  assert.equal(stored[0].source, 'gmail');
  const inferred = provenanceOfProfileSource({ source: 'linkedin', import_mode: 'data_export', imported_at: '2026-11-01T00:00:00Z' });
  assert.deepEqual(inferred[0], { source: 'linkedin', mode: 'import', scope: 'data_export', collected_at: '2026-11-01T00:00:00Z', terms_version: 'linkedin@2026-11-13', policy_version: SOURCE_POLICY_VERSION, inferred: true });
  assert.deepEqual(provenanceOfProfileSource({ source: 'inconnue' }), []);
  // collected_via survit à la normalisation du profil.
  const hp = normalizeHumanProfile({ assigned_name: 'A', profile_sources: [{ source: 'email', import_mode: 'operator_supplied', collected_via: [{ source: 'user_text', mode: 'import', scope: 'emails', collected_at: 'x', terms_version: 'user_text@2026-11-13', policy_version: 'p', extra: 'drop' }] }] });
  assert.deepEqual(hp.profile_sources[0].collected_via, [{ source: 'user_text', mode: 'import', scope: 'emails', collected_at: 'x', terms_version: 'user_text@2026-11-13', policy_version: 'p' }]);
  const view = personaComplianceView({
    human_profile: hp,
    metadata: { impersonator: {
      public_sources: ['https://exemple.fr/p', 'https://github.com/octocat', 'https://x.com/a'],
      public_evidence: [{ url: 'https://exemple.fr/p', fetched_at: '2026-11-13T01:00:00Z', collection: { source: 'web', mode: 'public_visit', scope: 'professional_page', collected_at: '2026-11-13T01:00:00Z', terms_version: 'web@2026-11-13', policy_version: SOURCE_POLICY_VERSION } }],
    } },
  });
  const [email, web, gh, x] = view.profile_sources;
  assert.equal(email.terms_version, 'user_text@2026-11-13');
  assert.equal(email.collection[0].source, 'user_text');
  assert.equal(web.collected_at, '2026-11-13T01:00:00Z');
  assert.equal(web.terms_version, 'web@2026-11-13');
  assert.equal(gh.type, 'github');
  assert.equal(gh.mode, 'api');
  assert.equal(gh.collection[0].inferred, true);
  assert.equal(x.collection[0].refused, 'mode_not_allowed');
  assert.equal(x.terms_version, null);
});
