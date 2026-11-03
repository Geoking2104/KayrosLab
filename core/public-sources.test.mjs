import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicUrl, isPrivateAddress, visitPublicSource, visitPublicSources, extractPageText, normalizePublicEvidence } from './public-sources.mjs';
import { normalizeImpersonator, impersonatorContext, impersonatorAgentDefinition } from './impersonator.mjs';
import { profileFromPublicSources } from './profile-enrichment.mjs';
import { SwarmService } from './swarm.mjs';
import { attachPersonaPublicEvidence } from './persona-package.mjs';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const html = '<html><head><title>Alex Martin — CFO</title><meta name="description" content="Directrice financière."></head><body><script>x()</script><p>Priorité : ROI &amp; maîtrise des coûts.</p></body></html>';
const page = (body = html, init = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });

test('SSRF : schémas, hôtes et adresses privées refusés', () => {
  for (const bad of ['ftp://x.example/a', 'file:///etc/passwd', 'http://localhost/', 'http://127.0.0.1/', 'http://10.1.2.3/', 'http://192.168.0.1/', 'http://169.254.169.254/latest', 'http://[::1]/', 'http://[fd00::1]/', 'http://user:pw@x.example/', 'http://x.example:8080/', 'http://intranet.local/']) {
    assert.throws(() => assertPublicUrl(bad), /source publique/, bad);
  }
  assert.equal(assertPublicUrl('https://x.example/a#frag').href, 'https://x.example/a');
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateAddress('100.64.1.1'), true);
});

test('visite : statut, titre, extrait, date, hash (fetch simulé, aucun réseau)', async () => {
  const calls = [];
  const r = await visitPublicSource('https://x.example/alex', { lookup: publicLookup, now: () => new Date('2026-11-03T13:00:00Z'), fetchImpl: async (url, init) => { calls.push({ url, init }); return page(); } });
  assert.equal(r.error, null);
  assert.equal(r.status, 200);
  assert.equal(r.title, 'Alex Martin — CFO');
  assert.match(r.excerpt, /Directrice financière\. Priorité : ROI & maîtrise des coûts\./);
  assert.doesNotMatch(r.excerpt, /x\(\)/);
  assert.match(r.sha256, /^[a-f0-9]{64}$/);
  assert.equal(r.fetched_at, '2026-11-03T13:00:00.000Z');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls[0].init.credentials, 'omit');
});

test('visite : DNS vers IP privée et redirection vers IP privée refusées', async () => {
  const fetchImpl = async () => { throw new Error('ne doit pas être appelé'); };
  const r1 = await visitPublicSource('https://evil.example/', { fetchImpl, lookup: async () => [{ address: '10.0.0.5' }] });
  assert.match(r1.error, /adresse privée/);
  const r2 = await visitPublicSource('https://x.example/', { lookup: publicLookup, fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }) });
  assert.match(r2.error, /adresse privée/);
  let n = 0;
  const r3 = await visitPublicSource('https://x.example/', { lookup: publicLookup, fetchImpl: async () => { n += 1; return new Response(null, { status: 301, headers: { location: `https://x.example/${n}` } }); } });
  assert.match(r3.error, /trop de redirections/);
});

test('visite : délai et taille max', async () => {
  const slow = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const r = await visitPublicSource('https://x.example/', { lookup: publicLookup, fetchImpl: slow, limits: { timeoutMs: 20 } });
  assert.match(r.error, /délai/);
  const big = await visitPublicSource('https://x.example/', { lookup: publicLookup, fetchImpl: async () => page('a'.repeat(5000), { headers: { 'content-type': 'text/plain' } }), limits: { maxBytes: 1000 } });
  assert.equal(big.bytes, 1000);
  assert.equal(big.truncated, true);
  const ko = await visitPublicSource('https://x.example/404', { lookup: publicLookup, fetchImpl: async () => new Response('nope', { status: 404 }) });
  assert.equal(ko.status, 404); assert.equal(ko.error, 'HTTP 404');
});

test('visitPublicSources dédoublonne ; extractPageText texte brut', async () => {
  const out = await visitPublicSources(['https://x.example/a', 'https://x.example/a', 'https://x.example/b'], { lookup: publicLookup, fetchImpl: async () => page() });
  assert.equal(out.length, 2);
  assert.deepEqual(extractPageText('  hello   world ', 'text/plain'), { title: null, text: 'hello world' });
  assert.equal(normalizePublicEvidence([{ url: 'https://x', sha256: 'bad' }])[0].sha256, null);
});

test('persona : trace liée, extraits dans le profil et dans le contexte effectif (pipeline gouverné)', async () => {
  const swarm = new SwarmService({});
  const def = impersonatorAgentDefinition({ impersonator: { persona_name: 'Alex Martin', source: 'public', public_sources: ['https://x.example/alex'] } });
  let agent = swarm.createAgent(def, { tenantId: 't' });
  const visit = (urls) => visitPublicSources(urls, { lookup: publicLookup, fetchImpl: async () => page() });
  agent = await attachPersonaPublicEvidence(swarm, agent, visit, { tenantId: 't' });
  const imp = agent.metadata.impersonator;
  assert.equal(imp.legal_basis, 'public_data');
  assert.equal(imp.consent_confirmed, true);
  assert.equal(imp.public_evidence.length, 1);
  assert.equal(imp.public_evidence[0].status, 200);
  assert.ok(agent.human_profile.profile_summary.some((s) => /maîtrise des coûts/.test(s)));
  assert.ok(agent.human_profile.profile_sources.some((s) => s.source === 'public'));
  const ctx = impersonatorContext(agent);
  assert.match(ctx, /Sources publiques visitées \(1\/1\)/);
  assert.match(ctx, /Alex Martin — CFO/);
  // Garde-fous et veto conservés.
  assert.equal(agent.veto_power, true);
  assert.ok(normalizeImpersonator(imp));
});

test('profileFromPublicSources ignore les visites en erreur', () => {
  assert.equal(profileFromPublicSources([{ url: 'https://x', error: 'HTTP 500' }]), null);
});
