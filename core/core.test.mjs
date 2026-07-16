// Tests du cœur « LLM gouverné » — exécutables avec `node --test` (Node 20+, aucune dépendance).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeBackoff, CircuitBreaker, BreakerState, withResilience } from './resilience.mjs';
import { cosine, InMemoryVectorStore, SharedMemory } from './memory.mjs';
import { toStrategic, strategicGlobal, STRATEGIC_DIMS } from './ki.mjs';
import { ToolRegistry, demoTools } from './tool-registry.mjs';
import { KayrosLLM, RoutingPolicy, MockProvider } from './kayros-llm.mjs';
import { GovernanceService, classifySensitive, policyFor, canResolve, GateType } from './governance.mjs';
import { Orchestrator, collect } from './orchestrator.mjs';
import { createEngine } from './index.mjs';

// ---------- Résilience ----------
test('computeBackoff exponentiel sans jitter', () => {
  assert.equal(computeBackoff(0, { baseMs: 100, factor: 2, jitter: false }), 100);
  assert.equal(computeBackoff(1, { baseMs: 100, factor: 2, jitter: false }), 200);
  assert.equal(computeBackoff(3, { baseMs: 100, factor: 2, jitter: false }), 800);
  assert.equal(computeBackoff(10, { baseMs: 100, factor: 2, jitter: false, maxMs: 500 }), 500);
});

test('CircuitBreaker : CLOSED -> OPEN -> HALF_OPEN -> CLOSED', () => {
  let t = 0;
  const cb = new CircuitBreaker({ failureThreshold: 2, coolDownMs: 1000, now: () => t });
  assert.equal(cb.state, BreakerState.CLOSED);
  cb.onFailure(); assert.equal(cb.state, BreakerState.CLOSED);
  cb.onFailure(); assert.equal(cb.state, BreakerState.OPEN);
  assert.equal(cb.allowRequest(), false);
  t = 1000; // cooldown écoulé
  assert.equal(cb.state, BreakerState.HALF_OPEN);
  assert.equal(cb.allowRequest(), true);   // 1 sonde autorisée
  assert.equal(cb.allowRequest(), false);  // 2e sonde refusée
  cb.onSuccess(); assert.equal(cb.state, BreakerState.CLOSED);
});

test('CircuitBreaker : échec en HALF_OPEN rouvre le circuit', () => {
  let t = 0;
  const cb = new CircuitBreaker({ failureThreshold: 1, coolDownMs: 100, now: () => t });
  cb.onFailure(); assert.equal(cb.state, BreakerState.OPEN);
  t = 100; assert.equal(cb.state, BreakerState.HALF_OPEN);
  cb.onFailure(); assert.equal(cb.state, BreakerState.OPEN);
});

test('withResilience : réussit après échecs puis fallback si ouvert', async () => {
  let n = 0;
  const flaky = async () => { n++; if (n < 3) throw new Error('boom'); return 'ok'; };
  const cb = new CircuitBreaker({ failureThreshold: 10 });
  const res = await withResilience(flaky, cb, { maxRetries: 5, baseMs: 1, factor: 1, jitter: false });
  assert.equal(res, 'ok');

  const openCb = new CircuitBreaker({ failureThreshold: 1, fallback: () => 'FALLBACK' });
  openCb.onFailure(); // OPEN
  const r2 = await withResilience(async () => 'jamais', openCb);
  assert.equal(r2, 'FALLBACK');
});

// ---------- Mémoire ----------
test('cosine et recherche vectorielle ordonnée + filtre ideaId', async () => {
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  const store = new InMemoryVectorStore();
  await store.upsert({ id: 'a', ideaId: 'i1', text: 'A', embedding: [1, 0, 0] });
  await store.upsert({ id: 'b', ideaId: 'i1', text: 'B', embedding: [0.9, 0.1, 0] });
  await store.upsert({ id: 'c', ideaId: 'i2', text: 'C', embedding: [1, 0, 0] });
  const res = await store.search([1, 0, 0], 2, { ideaId: 'i1' });
  assert.equal(res.length, 2);
  assert.equal(res[0].id, 'a');
  assert.ok(res[0].score >= res[1].score);
  assert.ok(res.every((r) => r.ideaId === 'i1'));
});

// ---------- KI ----------
test('KI : mapping technique -> stratégique (5 dims, borné 0..10)', () => {
  const tech = { global: 8, velocite: 6, divergence: 7, fiabilite: 9, impact: 8, originalite: 5 };
  const strat = toStrategic(tech);
  assert.deepEqual(Object.keys(strat).sort(), [...STRATEGIC_DIMS].sort());
  for (const d of STRATEGIC_DIMS) { assert.ok(strat[d] >= 0 && strat[d] <= 10); }
  // faisabilite = 0.7*fiabilite + 0.3*velocite = 0.7*9 + 0.3*6 = 8.1
  assert.ok(Math.abs(strat.faisabilite - 8.1) < 1e-9);
  assert.ok(strategicGlobal(strat) > 0);
});

// ---------- Tool Registry ----------
test('ToolRegistry : validation des clés + exécution', async () => {
  const reg = demoTools();
  await assert.rejects(() => reg.call('search_regulatory_risks', {}), /clés manquantes/);
  const out = await reg.call('search_regulatory_risks', { domaine: 'batteries' });
  assert.ok(Array.isArray(out.risques));
  assert.throws(() => new ToolRegistry().register({ name: 'x' }), /handler requis/);
});

// ---------- KayrosLLM ----------
test('KayrosLLM : mock renvoie une réponse + fallback sur échec du primaire', async () => {
  const llm = new KayrosLLM({ mock: new MockProvider() }, new RoutingPolicy({ defaultProvider: 'mock', fallback: 'mock' }));
  const r = await llm.complete({ role: 'Planner', messages: [{ role: 'user', content: 'bonjour' }] });
  assert.match(r.text, /simulee/);
  assert.ok(r.usage.tokensIn > 0);

  const boom = { complete: async () => { throw new Error('down'); } };
  const llm2 = new KayrosLLM({ primary: boom, mock: new MockProvider() }, new RoutingPolicy({ defaultProvider: 'primary', fallback: 'mock' }));
  const r2 = await llm2.complete({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(r2.provider, 'mock');
});

test('RoutingPolicy : souveraineté local force ollama', () => {
  const p = new RoutingPolicy({ defaultProvider: 'anthropic' });
  assert.equal(p.choose({}, { sovereignty: 'local' }), 'ollama');
  assert.equal(p.choose({}, {}), 'anthropic');
});

// ---------- Gouvernance ----------
test('RBAC + résolution de gate (motif obligatoire, rôle habilité)', () => {
  assert.equal(canResolve('comex', GateType.OUTPUT_CENSOR), true);
  assert.equal(canResolve('facilitateur', GateType.OUTPUT_CENSOR), false);
  const gov = new GovernanceService();
  const { gateId } = gov.open({ ideaId: 'i1', type: GateType.OUTPUT_CENSOR, requiredRole: 'comex' });
  assert.throws(() => gov.resolve(gateId, { decision: 'reject', by: 'x', role: 'comex' }), /Motif obligatoire/);
  assert.throws(() => gov.resolve(gateId, { decision: 'approve', by: 'x', role: 'facilitateur' }), /non habilité/);
  const res = gov.resolve(gateId, { decision: 'approve', by: 'geoff', role: 'comex' });
  assert.equal(res.decision, 'approve');
});

test('classifySensitive + policyFor selon le niveau', async () => {
  const neutre = await classifySensitive('bonjour le monde');
  assert.equal(neutre.sensitive, false);
  const reg = await classifySensitive('analyse de conformité RGPD');
  assert.equal(reg.sensitive, true);
  assert.equal(policyFor({ sensitive: false }, 'auto'), null);
  assert.equal(policyFor({ sensitive: false }, 'supervise'), null);
  assert.equal(policyFor({ sensitive: true }, 'supervise'), GateType.OUTPUT_CENSOR);
  assert.equal(policyFor({ sensitive: false }, 'strict'), GateType.OUTPUT_CENSOR);
});

// ---------- Orchestrateur (intégration) ----------
test('Orchestrateur : mode auto -> réponse restituée sans gate', async () => {
  const eng = createEngine();
  const plan = await eng.orchestrator.plan('Idéer une offre neutre');
  const events = await collect(eng.orchestrator.run(plan, { governance: 'auto' }));
  const traces = events.filter((e) => e.type === 'trace');
  const final = events.at(-1);
  assert.equal(traces.length, 4);
  assert.equal(final.type, 'final');
  assert.equal(final.status, 'auto');
});

test('Orchestrateur : mode strict -> gate puis validation humaine', async () => {
  const eng = createEngine();
  const plan = await eng.orchestrator.plan('Décision go/no-go réglementaire');
  const events = [];
  for await (const ev of eng.orchestrator.run(plan, { governance: 'strict' })) {
    events.push(ev);
    if (ev.type === 'gate') eng.governance.resolve(ev.gateId, { decision: 'approve', by: 'geoff', role: 'comex' });
  }
  assert.ok(events.some((e) => e.type === 'gate'));
  assert.equal(events.at(-1).status, 'validated_human');
});

test('Orchestrateur : veto -> sortie bloquée sans contenu sensible', async () => {
  const eng = createEngine();
  const plan = await eng.orchestrator.plan('Publier une décision externe');
  const events = [];
  for await (const ev of eng.orchestrator.run(plan, { governance: 'strict' })) {
    events.push(ev);
    if (ev.type === 'gate') eng.governance.resolve(ev.gateId, { decision: 'reject', by: 'geoff', role: 'comex', reason: 'risque non couvert' });
  }
  const final = events.at(-1);
  assert.equal(final.status, 'blocked_veto');
  assert.match(final.message, /risque non couvert/);
  assert.ok(!('answer' in final));
});

// ---------- HttpBackendProvider + override de fournisseur ----------
import { HttpBackendProvider } from './kayros-llm.mjs';
test('HttpBackendProvider : POST vers le proxy + normalisation', async () => {
  let seen;
  const fakeFetch = async (url, opts) => { seen = { url, body: JSON.parse(opts.body), headers: opts.headers }; return { ok: true, json: async () => ({ text: 'reponse backend', provider: 'anthropic', usage: { tokensIn: 12, tokensOut: 8 } }) }; };
  const p = new HttpBackendProvider({ url: 'https://x/api/govern.php', provider: 'anthropic', secret: 's3cr3t', fetchImpl: fakeFetch });
  const r = await p.complete({ messages: [{ role: 'user', content: 'salut' }], role: 'Planner' });
  assert.equal(r.text, 'reponse backend');
  assert.equal(r.provider, 'anthropic');
  assert.equal(r.usage.tokensIn, 12);
  assert.equal(seen.url, 'https://x/api/govern.php');
  assert.equal(seen.headers['X-Kayros-Secret'], 's3cr3t');
  assert.equal(seen.body.provider, 'anthropic');
});
test('RoutingPolicy : opts.provider force le fournisseur', () => {
  const p = new RoutingPolicy({ defaultProvider: 'mock' });
  assert.equal(p.choose({}, { provider: 'backend' }), 'backend');
  assert.equal(p.choose({}, { sovereignty: 'local' }), 'ollama');
  assert.equal(p.choose({}, {}), 'mock');
});
test('createEngine backendUrl => provider backend par defaut', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ text: 'ok', provider: 'anthropic', usage: {} }) });
  const eng = createEngine({ backendUrl: 'https://x/api/govern.php', fetchImpl: fakeFetch });
  const r = await eng.llm.complete({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(r.provider, 'anthropic');
});

// ---------- QdrantVectorStore (fetch simule) ----------
import { QdrantVectorStore } from './memory.mjs';
test('QdrantVectorStore : ensureCollection + upsert + search (filtre ideaId)', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
    if (opts.method === 'PUT' && url.endsWith('/collections/kayroslab')) return { ok: true, json: async () => ({ result: true }) };
    if (opts.method === 'PUT' && url.endsWith('/points')) return { ok: true, json: async () => ({ result: { status: 'acknowledged' } }) };
    if (opts.method === 'POST' && url.endsWith('/points/search')) return { ok: true, json: async () => ({ result: [ { id: 1, score: 0.97, payload: { ideaId: 'i1', text: 'A' } } ] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const q = new QdrantVectorStore({ dim: 3, apiKey: 'k', fetchImpl: fakeFetch });
  assert.equal(await q.ensureCollection(), true);
  const created = calls.find((c) => c.url.endsWith('/collections/kayroslab') && c.method === 'PUT');
  assert.deepEqual(created.body.vectors, { size: 3, distance: 'Cosine' });

  await q.upsert({ id: 1, ideaId: 'i1', text: 'A', embedding: [1, 0, 0] });
  const up = calls.find((c) => c.url.endsWith('/points') && c.method === 'PUT');
  assert.equal(up.body.points[0].payload.ideaId, 'i1');

  const res = await q.search([1, 0, 0], 5, { ideaId: 'i1' });
  const search = calls.find((c) => c.url.endsWith('/points/search'));
  assert.deepEqual(search.body.filter.must[0], { key: 'ideaId', match: { value: 'i1' } });
  assert.equal(res[0].id, 1);
  assert.equal(res[0].ideaId, 'i1');
  assert.ok(res[0].score > 0.9);
});

// ---------- Embeddings + MemoryService ----------
import { OllamaEmbeddings, MockEmbeddings, HttpEmbeddings, MemoryService } from './embeddings.mjs';

test('MockEmbeddings : deterministe + dimension', async () => {
  const e = new MockEmbeddings({ dim: 8 });
  const a = await e.embed('batteries seconde vie');
  const b = await e.embed('batteries seconde vie');
  assert.equal(a.length, 8);
  assert.deepEqual(a, b);
  const batch = await e.embedBatch(['x', 'y']);
  assert.equal(batch.length, 2);
});

test('OllamaEmbeddings : /api/embed (fetch simule)', async () => {
  const fake = async (url, opts) => {
    assert.ok(url.endsWith('/api/embed'));
    const body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ embeddings: body.input.map(() => [0.1, 0.2, 0.3]) }) };
  };
  const e = new OllamaEmbeddings({ model: 'nomic-embed-text', fetchImpl: fake });
  const v = await e.embed('bonjour');
  assert.deepEqual(v, [0.1, 0.2, 0.3]);
});

test('HttpEmbeddings : proxy backend (fetch simule)', async () => {
  const fake = async (url, opts) => ({ ok: true, json: async () => ({ embeddings: [[1, 0, 0]] }) });
  const e = new HttpEmbeddings({ url: 'https://x/v1/embed', secret: 's', fetchImpl: fake });
  const v = await e.embed('hi');
  assert.deepEqual(v, [1, 0, 0]);
});

test('MemoryService : remember + recall (semantique)', async () => {
  const { InMemoryVectorStore } = await import('./memory.mjs');
  const mem = new MemoryService({ embeddings: new MockEmbeddings({ dim: 16 }), store: new InMemoryVectorStore() });
  await mem.rememberMany([
    { id: 'a', ideaId: 'i1', text: 'pack batteries seconde vie stockage residentiel' },
    { id: 'b', ideaId: 'i1', text: 'recette de tarte aux pommes' },
    { id: 'c', ideaId: 'i2', text: 'autre idee isolee' },
  ]);
  const res = await mem.recall('i1', 'batteries stockage residentiel', 2);
  assert.ok(res.length <= 2);
  assert.equal(res[0].id, 'a');            // le plus proche semantiquement
  assert.ok(res.every((r) => r.ideaId === 'i1')); // isolation par idee
});

test('createEngine expose embeddings + memory (mock offline)', async () => {
  const eng = createEngine();
  assert.ok(eng.embeddings && eng.memory);
  await eng.memory.remember({ id: '1', ideaId: 'x', text: 'test' });
  const r = await eng.memory.recall('x', 'test', 1);
  assert.equal(r[0].id, '1');
});
