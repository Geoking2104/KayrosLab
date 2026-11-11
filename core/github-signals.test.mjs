import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGitHubSignalCollector, assertTopicQuery, readRateLimit, signalEvidenceEntry, toEcouterSignal, SIGNAL_LABELS,
} from './github-signals.mjs';
import { createSignedChainSink, createEd25519Signer, generateEvidenceKeys, verifyEvidenceChain } from './evidence-chain.mjs';
import { createMemorySink } from './log-sink.mjs';
import { buildSearchToolDefs } from './adapters/search-tools.mjs';

const NOW = '2026-11-12T00:00:00.000Z';
const REPO = {
  full_name: 'acme/agent-kit', html_url: 'https://github.com/acme/agent-kit', description: 'Toolkit for AI agents',
  topics: ['ai-agents', 'llm'], language: 'TypeScript', stargazers_count: 420, forks_count: 12, open_issues_count: 3,
  created_at: '2025-01-01T00:00:00Z', pushed_at: '2026-11-10T00:00:00Z', private: false,
  owner: { login: 'acme', avatar_url: 'https://avatars.example/acme' },
};
const ISSUE = {
  html_url: 'https://github.com/acme/agent-kit/issues/7', repository_url: 'https://api.github.com/repos/acme/agent-kit',
  title: 'Support MCP transport', state: 'open', comments: 5, labels: [{ name: 'enhancement' }],
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-09T00:00:00Z',
  user: { login: 'jdoe', avatar_url: 'https://avatars.example/jdoe' },
};

function mockFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    const r = responses.shift() || { status: 200, body: { items: [] } };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: new Map(Object.entries(r.headers || { 'x-ratelimit-remaining': '29', 'x-ratelimit-reset': '1794450000', 'x-ratelimit-limit': '30' })),
      json: async () => r.body,
    };
  };
  return { fetchImpl, calls };
}

test('collecte dépôts et issues via l’API, avec provenance complète', async () => {
  const { fetchImpl, calls } = mockFetch([{ status: 200, body: { items: [REPO] } }, { status: 200, body: { items: [ISSUE] } }]);
  const collector = createGitHubSignalCollector({ token: 'tkn', fetchImpl, env: {}, now: () => NOW });
  const out = await collector.collect({ query: 'topic:ai-agents', decisionId: 'dec-1' });
  assert.equal(out.requests, 2);
  assert.equal(out.signals.length, 2);
  assert.match(calls[0].url, /^https:\/\/api\.github\.com\/search\/repositories\?q=topic%3Aai-agents&/);
  assert.match(calls[1].url, /\/search\/issues\?q=topic%3Aai-agents%20is%3Apublic&/);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tkn');
  const [repo, issue] = out.signals;
  for (const s of out.signals) {
    assert.equal(s.provenance.source, 'github');
    assert.equal(s.provenance.collected_at, NOW);
    assert.equal(s.provenance.collection_mode, 'api');
    assert.equal(s.provenance.terms_version, 'github@2026-11-12');
    assert.equal(s.provenance.terms_url, 'https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies');
    assert.equal(s.label, SIGNAL_LABELS.PLATFORM_FACT);
    assert.match(s.provenance.content_hash, /^[0-9a-f]{64}$/);
  }
  assert.equal(repo.url, REPO.html_url);
  assert.deepEqual(repo.tags, ['ai-agents', 'llm']);
  assert.equal(issue.facts.repository, 'acme/agent-kit');
  assert.equal(out.terms.version, 'github@2026-11-12');
});

test('aucun champ de personne n’est conservé (niveau sujet)', async () => {
  const { fetchImpl } = mockFetch([{ status: 200, body: { items: [REPO] } }, { status: 200, body: { items: [ISSUE] } }]);
  const out = await createGitHubSignalCollector({ fetchImpl, env: {}, now: () => NOW }).collect({ query: 'llm agents' });
  const text = JSON.stringify(out.signals);
  assert.doesNotMatch(text, /jdoe|avatar|"user"|"owner"/);
});

test('les qualificatifs qui visent une personne sont refusés avant tout appel réseau', async () => {
  const { fetchImpl, calls } = mockFetch([]);
  const collector = createGitHubSignalCollector({ fetchImpl, env: {} });
  for (const q of ['author:jdoe llm', 'user:jdoe', 'involves:jdoe', 'topic:ai -commenter:x', 'jdoe in:email']) {
    await assert.rejects(collector.collect({ query: q }), (e) => e.code === 'purpose_not_allowed', q);
  }
  await assert.rejects(collector.collect({ query: '' }), (e) => e.code === 'empty_query');
  await assert.rejects(collector.collect({ query: 'llm', kinds: ['users'] }), (e) => e.code === 'scope_not_allowed');
  assert.equal(calls.length, 0);
  assert.equal(assertTopicQuery('org:vercel topic:ai'), 'org:vercel topic:ai');
});

test('plafond de requêtes par décision (borné par la politique)', async () => {
  const { fetchImpl, calls } = mockFetch([{ status: 200, body: { items: [REPO] } }, { status: 200, body: { items: [ISSUE] } }]);
  const out = await createGitHubSignalCollector({ fetchImpl, env: {}, maxRequestsPerDecision: 1 }).collect({ query: 'llm' });
  assert.equal(calls.length, 1);
  assert.equal(out.maxRequests, 1);
  assert.equal(out.stopped, 'request_cap');
  const loose = createGitHubSignalCollector({ fetchImpl: mockFetch([]).fetchImpl, env: {}, maxRequestsPerDecision: 999 });
  assert.equal((await loose.collect({ query: 'llm' })).maxRequests, 10, 'jamais au-delà du plafond de la politique');
});

test('limite de débit : arrêt sur remaining=0 ou 403/429, sans relance', async () => {
  const exhausted = mockFetch([{ status: 200, body: { items: [REPO] }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1794450000' } }]);
  const out = await createGitHubSignalCollector({ fetchImpl: exhausted.fetchImpl, env: {} }).collect({ query: 'llm' });
  assert.equal(exhausted.calls.length, 1);
  assert.equal(out.stopped, 'rate_limited');
  assert.equal(out.rateLimit.remaining, 0);
  assert.equal(out.rateLimit.resetAt, new Date(1794450000 * 1000).toISOString());

  const limited = mockFetch([{ status: 429, body: {}, headers: { 'retry-after': '60' } }]);
  const out2 = await createGitHubSignalCollector({ fetchImpl: limited.fetchImpl, env: {} }).collect({ query: 'llm' });
  assert.equal(limited.calls.length, 1);
  assert.equal(out2.stopped, 'rate_limited');
  assert.equal(out2.signals.length, 0);
  assert.match(out2.warnings.join(' '), /60 s/);
  assert.equal(readRateLimit({ headers: { 'x-ratelimit-remaining': '5' } }).remaining, 5);
});

test('erreurs HTTP et réseau : avertissement, pas d’exception', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/repositories')) throw new Error('ECONNRESET');
    return { ok: false, status: 500, headers: new Map(), json: async () => ({}) };
  };
  const out = await createGitHubSignalCollector({ fetchImpl, env: {} }).collect({ query: 'llm' });
  assert.equal(out.signals.length, 0);
  assert.equal(out.warnings.length, 2);
});

test('enrichissement facultatif : étiquette machine_extraction', async () => {
  const { fetchImpl } = mockFetch([{ status: 200, body: { items: [REPO] } }]);
  const out = await createGitHubSignalCollector({ fetchImpl, env: {}, extract: async () => ({ contenu: 'Résumé machine', tags: ['agents'] }) })
    .collect({ query: 'llm', kinds: ['repositories'] });
  const [s] = out.signals;
  assert.equal(s.label, SIGNAL_LABELS.MACHINE_EXTRACTION);
  assert.equal(s.provenance.label, 'machine_extraction');
  assert.equal(s.provenance.derived_from, 'platform_fact');
  assert.equal(s.facts.stars, 420, 'les faits plateforme restent intacts');
});

test('intégration chaîne de preuves signée et étape Écouter', async () => {
  const keys = generateEvidenceKeys();
  const inner = createMemorySink();
  const sink = createSignedChainSink({ inner, signer: createEd25519Signer(keys.privateKey), now: () => NOW });
  const { fetchImpl } = mockFetch([{ status: 200, body: { items: [REPO] } }, { status: 200, body: { items: [ISSUE] } }]);
  const out = await createGitHubSignalCollector({ fetchImpl, env: {}, now: () => NOW, evidenceSink: sink }).collect({ query: 'llm', decisionId: 'dec-42' });
  await sink.flush();
  const entries = inner.lines.map((line) => JSON.parse(line));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].payload.type, 'signal.collected');
  assert.equal(entries[0].payload.terms_version, 'github@2026-11-12');
  assert.equal(verifyEvidenceChain(inner.lines.join('\n'), { publicKeys: [keys.publicKey] }).ok, true);
  assert.deepEqual(Object.keys(signalEvidenceEntry(out.signals[0], { decisionId: 'd' })).includes('content_hash'), true);
  const ecouter = toEcouterSignal(out.signals[0]);
  assert.equal(ecouter.source, 'github:repositories');
  assert.equal(ecouter.provenance.collection_mode, 'api');
});

test('outil collect_github_signals enregistré avec les outils de recherche', async () => {
  const { fetchImpl } = mockFetch([{ status: 200, body: { items: [REPO] } }]);
  const def = buildSearchToolDefs({ fetchImpl, githubToken: '', env: {} }).find((d) => d.name === 'collect_github_signals');
  assert.ok(def);
  assert.equal(def.sideEffect, 'read');
  const out = await def.handler({ q: 'topic:llm', kinds: ['repositories'] });
  assert.equal(out.signals.length, 1);
  await assert.rejects(def.handler({ q: 'author:jdoe' }), (e) => e.code === 'purpose_not_allowed');
});
