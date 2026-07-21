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

// ---------- Orchestrateur memory-aware ----------
test('Orchestrateur : rappel memoire (recall) + memorisation des observations', async () => {
  const eng = createEngine(); // MockEmbeddings + InMemoryVectorStore cables
  await eng.memory.remember({ id: 'seed', ideaId: 'i1', text: 'contrainte reglementaire batteries seconde vie Europe' });
  const plan = await eng.orchestrator.plan('Evaluer batteries seconde vie en Europe', { ideaId: 'i1' });
  const events = [];
  for await (const ev of eng.orchestrator.run(plan, { governance: 'auto' })) events.push(ev);
  const recall = events.find((e) => e.type === 'recall');
  assert.ok(recall, 'un evenement recall doit etre emis');
  assert.ok(recall.items.some((i) => i.id === 'seed'));
  const traces = events.filter((e) => e.type === 'trace');
  assert.equal(traces.length, 4);
  assert.ok(traces.every((t) => t.usedContext === true)); // contexte memoire injecte
  assert.ok(eng.vectors.size() > 1); // seed + observations memorisees
  assert.equal(events.at(-1).status, 'auto');
});

test('Orchestrateur sans memoire vectorielle : aucun recall, fonctionne', async () => {
  const eng = createEngine();
  const plan = await eng.orchestrator.plan('idee neutre', { ideaId: 'vide' });
  // ideaId "vide" n'a rien en memoire -> pas d'evenement recall
  const events = [];
  for await (const ev of eng.orchestrator.run(plan, { governance: 'auto', remember: false })) events.push(ev);
  assert.ok(!events.some((e) => e.type === 'recall'));
  assert.equal(events.filter((e) => e.type === 'trace').length, 4);
  assert.equal(events.at(-1).status, 'auto');
});

// ---------- Planner LLM (plan genere) ----------
test('Planner LLM : plan genere depuis JSON valide', async () => {
  const llm = { complete: async () => ({ text: 'Plan: [{"agent":"Planner","description":"cadrer"},{"agent":"RedTeam","description":"attaquer"},{"agent":"Synthesizer","description":"synthese"}] .', usage: { tokensIn: 1, tokensOut: 1 } }) };
  const orch = new Orchestrator({ llm });
  const plan = await orch.plan('Objectif X', { ideaId: 'i9' });
  assert.equal(plan.generatedBy, 'llm');
  assert.equal(plan.steps.length, 3);
  assert.equal(plan.steps[0].agent, 'Planner');
  assert.equal(plan.steps[0].id, 's1');
  assert.equal(plan.steps.at(-1).agent, 'Synthesizer');
});

test('Planner : repli deterministe si sortie non-JSON (mock)', async () => {
  const eng = createEngine(); // provider mock -> texte non JSON
  const plan = await eng.orchestrator.plan('objectif', { ideaId: 'iF' });
  assert.equal(plan.generatedBy, 'fallback');
  assert.equal(plan.steps.length, 4);
});

test('Planner : llmPlan:false force le repli', async () => {
  const eng = createEngine();
  const plan = await eng.orchestrator.plan('x', { ideaId: 'z', llmPlan: false });
  assert.equal(plan.generatedBy, 'fallback');
  assert.equal(plan.steps.length, 4);
});

test('parsePlanSteps : ignore agents invalides, renvoie null si vide', async () => {
  const { parsePlanSteps } = await import('./orchestrator.mjs');
  assert.equal(parsePlanSteps('pas de json'), null);
  assert.equal(parsePlanSteps('[{"agent":"Inconnu","description":"x"}]'), null);
  const ok = parsePlanSteps('[{"agent":"Critic","description":"c"}]');
  assert.equal(ok.length, 1);
  assert.equal(ok[0].agent, 'Critic');
});

test('parsePlanSteps : retire les blocs <think> (avec crochets parasites)', async () => {
  const { parsePlanSteps } = await import('./orchestrator.mjs');
  const txt = '<think>je liste [a, b, c] et je reflechis</think>[{"agent":"Planner","description":"p"},{"agent":"Synthesizer","description":"s"}]';
  const steps = parsePlanSteps(txt);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].agent, 'Planner');
  assert.equal(steps.at(-1).agent, 'Synthesizer');
});

test('parsePlanSteps : gere les fences markdown', async () => {
  const { parsePlanSteps } = await import('./orchestrator.mjs');
  const txt = '```json\n[{"agent":"Critic","description":"c"}]\n```';
  const steps = parsePlanSteps(txt);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].agent, 'Critic');
});

test('parsePlanSteps : recupere les objets d un JSON tronque', async () => {
  const { parsePlanSteps } = await import('./orchestrator.mjs');
  // tableau non ferme (reponse coupee) : 2 objets complets + 1 incomplet
  const txt = '[{"agent":"Planner","description":"p"},{"agent":"RedTeam","description":"r"},{"agent":"Synthesi';
  const steps = parsePlanSteps(txt);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].agent, 'Planner');
  assert.equal(steps[1].agent, 'RedTeam');
});

test('extractFirstArray / salvageObjects : primitives exportees', async () => {
  const { extractFirstArray, salvageObjects } = await import('./orchestrator.mjs');
  assert.equal(extractFirstArray('rien ici'), null);
  assert.equal(extractFirstArray('a [1,2] b'), '[1,2]');
  assert.equal(salvageObjects('[{"x":1},{"y":2},{"z"').length, 2);
});

test('Planner : think:false transmis a Ollama + plannerModel applique', async () => {
  const { OllamaProvider, KayrosLLM, RoutingPolicy } = await import('./kayros-llm.mjs');
  let captured = null;
  const fetchImpl = async (_url, opts) => {
    captured = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ message: { content: '[{"agent":"Planner","description":"p"},{"agent":"Synthesizer","description":"s"}]' }, prompt_eval_count: 1, eval_count: 1 }) };
  };
  const llm = new KayrosLLM(
    { ollama: new OllamaProvider({ fetchImpl }) },
    new RoutingPolicy({ defaultProvider: 'ollama', fallback: null })
  );
  const orch = new Orchestrator({ llm, plannerModel: 'llama3.2' });
  const plan = await orch.plan('Objectif', { ideaId: 'iT', sovereignty: 'local' });
  assert.equal(plan.generatedBy, 'llm');
  assert.equal(captured.think, false);
  assert.equal(captured.model, 'llama3.2');
});

// ---------- Projeter : projection deterministe + outils + orchestrateur ----------
test('simulateTrajectory : esperance exacte + quantiles ordonnes + reproductible', async () => {
  const { simulateTrajectory } = await import('./projection.mjs');
  const input = { scenarios: [{ probability: 0.5, value: 100 }, { probability: 0.5, value: 0 }], seed: 7, iterations: 5000 };
  const a = simulateTrajectory(input);
  const b = simulateTrajectory(input);
  assert.equal(a.valeurAttendue, 50);            // esperance analytique exacte
  assert.ok(a.p10 <= a.p50 && a.p50 <= a.p90);   // quantiles ordonnes
  assert.deepEqual(a, b);                         // reproductible (meme seed)
});

test('simulateTrajectory : probabilites normalisees + variables ajoutent du bruit', async () => {
  const { simulateTrajectory } = await import('./projection.mjs');
  const r = simulateTrajectory({ scenarios: [{ probability: 2, value: 10 }, { probability: 2, value: 20 }], variables: [{ min: 0, max: 4 }], seed: 1, iterations: 4000 });
  assert.equal(r.scenariosPonderes[0].probability, 0.5); // 2/(2+2)
  assert.equal(r.valeurAttendue, 15);                    // 0.5*10 + 0.5*20 (esperance sans bruit)
  assert.ok(r.p90 > r.p10);
});

test('estimateResources : arithmetique budget/etp/tco/roi', async () => {
  const { estimateResources } = await import('./projection.mjs');
  const r = estimateResources({
    milestones: [{ effortPersonMonths: 10 }, { effortPersonMonths: 5 }],
    costHypotheses: { costPerPersonMonth: 1000, overheadRate: 0.2, horizonMonths: 5, runRateMonthly: 100, expectedRevenue: 30000 },
  });
  assert.equal(r.budget, 18000);     // 15 * 1000 * 1.2
  assert.equal(r.tco, 18500);        // 18000 + 100*5
  assert.equal(r.etp, 3);            // 15 / 5
  assert.equal(r.roiProjete, 0.621622); // (30000-18500)/18500 arrondi
});

test('demoTools : outils Projeter enregistres et appelables', async () => {
  const { demoTools } = await import('./tool-registry.mjs');
  const reg = demoTools();
  assert.ok(reg.get('simulate_trajectory'));
  assert.ok(reg.get('estimate_resources'));
  const r = await reg.call('simulate_trajectory', { scenarios: [{ probability: 1, value: 42 }], seed: 2, iterations: 500 });
  assert.equal(r.valeurAttendue, 42);
});

test('Orchestrator.project : Go -> roadmap + ressources + projections', async () => {
  const eng = createEngine();
  const out = await eng.orchestrator.project({
    status: 'Go',
    milestones: [{ name: 'MVP', effortPersonMonths: 4, durationMonths: 2 }],
    costHypotheses: { costPerPersonMonth: 1000 },
    scenarios: [{ probability: 1, value: 50 }],
    raci: [{ jalon: 'MVP', R: 'geoff' }],
  }, { ideaId: 'p1', seed: 1, iterations: 1000 });
  assert.equal(out.status, 'Go');
  assert.equal(out.roadmap.jalons.length, 1);
  assert.equal(out.roadmap.ressources.budget, 4000);
  assert.equal(out.projections.valeurAttendue, 50);
});

test('Orchestrator.project : No-Go -> capitalisation ; Revision -> renvoi Eprouver', async () => {
  const eng = createEngine();
  const nogo = await eng.orchestrator.project({ status: 'No-Go', apprentissages: ['a', 'b'] }, { ideaId: 'p2' });
  assert.equal(nogo.status, 'No-Go');
  assert.equal(nogo.capitalisation.apprentissages.length, 2);
  const rev = await eng.orchestrator.project({ status: 'Révision', motif: 'revoir X' }, { ideaId: 'p3' });
  assert.equal(rev.status, 'Révision');
  assert.equal(rev.renvoi, 'Éprouver');
});

// ---------- Boucle Projeter -> Ecouter (EF-43) ----------
test('evaluateKpis : detecte les seuils franchis (lte/gte)', async () => {
  const { evaluateKpis } = await import('./loop.mjs');
  const kpis = [
    { id: 'adoption', name: 'Adoption', threshold: 100, comparator: 'lte' }, // alerte si <= 100
    { id: 'churn', name: 'Churn', threshold: 0.1, comparator: 'gte' },        // alerte si >= 0.1
  ];
  const { alerts, ok } = evaluateKpis(kpis, [{ kpiId: 'adoption', value: 80 }, { kpiId: 'churn', value: 0.05 }]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kpiId, 'adoption');
  assert.equal(ok.length, 1);
  assert.equal(ok[0].kpiId, 'churn');
});

test('alertsToSignals : forme des signaux re-injectables', async () => {
  const { alertsToSignals } = await import('./loop.mjs');
  const sig = alertsToSignals([{ kpiId: 'adoption', name: 'Adoption', value: 80, threshold: 100, comparator: 'lte' }], { ideaId: 'i1', now: () => 'T0' });
  assert.equal(sig.length, 1);
  assert.equal(sig[0].source, 'projeter-loop');
  assert.equal(sig[0].date, 'T0');
  assert.match(sig[0].contenu, /Adoption/);
});

test('MonitoringLoop : ordonnanceur injectable (start/tick/stop)', async () => {
  const { MonitoringLoop } = await import('./loop.mjs');
  let captured = null, cleared = false, ticks = 0;
  const scheduler = { setInterval: (fn) => { captured = fn; return 7; }, clearInterval: (h) => { cleared = (h === 7); } };
  const loop = new MonitoringLoop({ task: async () => { ticks++; }, scheduler });
  loop.start(1000);
  assert.equal(typeof captured, 'function');
  captured();                    // simule un tick de l'ordonnanceur
  await loop.tick();             // tick manuel
  assert.equal(ticks, 2);
  loop.stop();
  assert.equal(cleared, true);
  assert.equal(loop.running, false);
});

test('Orchestrator.monitorProjection : alerte -> signal en memoire + re-arbitrage', async () => {
  const eng = createEngine(); // memoire vectorielle mock active
  const before = eng.vectors.size();
  const out = await eng.orchestrator.monitorProjection(
    { kpis: [{ id: 'adoption', name: 'Adoption', threshold: 100, comparator: 'lte' }], readings: [{ kpiId: 'adoption', value: 80 }] },
    { ideaId: 'iLoop' },
  );
  assert.equal(out.alerts.length, 1);
  assert.equal(out.signals.length, 1);
  assert.ok(out.reArbitrage);
  assert.equal(out.reArbitrage.type, 're-arbitrage');
  assert.ok(eng.vectors.size() > before); // signal re-injecte dans Ecouter
});

test('Orchestrator.monitorProjection : aucun seuil franchi -> pas de re-arbitrage', async () => {
  const eng = createEngine();
  const out = await eng.orchestrator.monitorProjection(
    { kpis: [{ id: 'adoption', threshold: 100, comparator: 'lte' }], readings: [{ kpiId: 'adoption', value: 150 }] },
    { ideaId: 'iLoop2' },
  );
  assert.equal(out.alerts.length, 0);
  assert.equal(out.reArbitrage, null);
});

// ---------- P0 : modele, portefeuille, intake, scorecards, vote, impact, notif ----------
test('model : statut orthogonal a etape + historique', async () => {
  const { createIdea, setStage, setStatus, applyDecision } = await import('./model.mjs');
  let idea = createIdea({ id: 'i1', title: 'Offre B2B' });
  assert.equal(idea.stage, 'recueillir');
  assert.equal(idea.status, 'nouveau');
  idea = setStage(idea, 'construire');
  idea = setStatus(idea, 'en_revue');
  assert.equal(idea.stage, 'construire');   // les deux axes evoluent independamment
  assert.equal(idea.status, 'en_revue');
  assert.equal(idea.history.length, 3);
  const go = applyDecision(idea, { status: 'Go' }, { by: 'geoff' });
  assert.equal(go.status, 'en_developpement');
  assert.equal(go.stage, 'projeter');
  assert.throws(() => setStage(idea, 'inconnu'));
});

test('model : reactivation d une idee dormante', async () => {
  const { createIdea, setStatus, reactivate } = await import('./model.mjs');
  const dormante = setStatus(createIdea({ id: 'i2', title: 'X' }), 'non_poursuivi');
  const reprise = reactivate(dormante, { by: 'geoff', stage: 'eprouver' });
  assert.equal(reprise.status, 'en_revue');
  assert.equal(reprise.stage, 'eprouver');
  assert.throws(() => reactivate(reprise));   // plus dormante
});

test('repository + portefeuille : filtres et WIP', async () => {
  const { createIdea, setStage } = await import('./model.mjs');
  const { InMemoryIdeaRepository, counts, portfolio } = await import('./repository.mjs');
  const repo = new InMemoryIdeaRepository();
  await repo.save(createIdea({ id: 'a', title: 'Alpha' }));
  await repo.save(setStage(createIdea({ id: 'b', title: 'Beta' }), 'eprouver'));
  await repo.save(setStage(createIdea({ id: 'c', title: 'Gamma' }), 'eprouver'));
  const c = await counts(repo);
  assert.equal(c.total, 3);
  assert.equal(c.byStage.eprouver, 2);
  assert.equal(c.byStage.recueillir, 1);
  const board = await portfolio(repo);
  assert.equal(board.columns.find((x) => x.stage === 'eprouver').wip, 2);
  const found = await repo.list({ q: 'alph' });
  assert.equal(found.length, 1);
});

test('intake : validation + derivation hypotheses/cibles', async () => {
  const { processIntake } = await import('./intake.mjs');
  const r = processIntake({ valeur: 'réduire le coût de 30%', probleme: 'process manuel', risques: 'concurrent installé' });
  assert.equal(r.validation.ok, true);
  assert.ok(r.hypotheses.some((h) => h.source === 'valeur' && h.critique));
  assert.ok(r.cibles.some((t) => t.origine === 'declare'));
  // champ equipe absent -> angle mort detecte automatiquement
  assert.ok(r.cibles.some((t) => t.id === 't-equipe-absent'));
  const ko = processIntake({ valeur: 'x' });
  assert.equal(ko.validation.ok, false);
  assert.deepEqual(ko.validation.missing, ['probleme']);
  assert.ok(ko.cibles.some((t) => t.origine === 'angle_mort')); // risques non declares
});

test('scorecard : parametrable, multi-grilles par etape', async () => {
  const { Scorecard, defaultScorecards } = await import('./scorecard.mjs');
  const sc = new Scorecard({ id: 't', stage: 'ecouter', scale: 10, criteria: [{ id: 'a', weight: 3 }, { id: 'b', weight: 1 }] });
  const r = sc.score({ a: 10, b: 2 });
  assert.equal(r.total, 8);            // (10*3 + 2*1) / 4
  assert.equal(r.normalise, 80);       // sur 100
  assert.equal(r.couverture, 1);
  const reg = defaultScorecards();
  assert.equal(reg.forStage('ecouter')[0].scale, 10);    // screening leger
  assert.equal(reg.forStage('arbitrer')[0].scale, 100);  // evaluation approfondie
  const partiel = reg.forStage('arbitrer')[0].score({ fit: 80 });
  assert.ok(partiel.couverture < 1 && partiel.evalue);
});

test('evaluation : agregation ponderee par role + recommandation', async () => {
  const { aggregateVotes } = await import('./evaluation.mjs');
  const r = aggregateVotes([
    { by: 'a', role: 'comex', score: 80 },
    { by: 'b', role: 'contributeur', score: 40 },
  ]);
  assert.equal(r.count, 2);
  assert.equal(r.moyenne, 60);
  assert.equal(r.moyennePonderee, 70);   // (80*3 + 40*1)/4
  assert.equal(r.recommandation, 'Go');
  assert.equal(r.parRole.comex.moyenne, 80);
  assert.equal(aggregateVotes([]).recommandation, 'insuffisant');
});

test('impact : totaux + ecart realise vs projete', async () => {
  const { emptyImpact, recordInvestment, recordBenefit, computeVariance, totals } = await import('./impact.mjs');
  let imp = emptyImpact();
  imp = recordInvestment(imp, { montant: 1000 });
  imp = recordBenefit(imp, { montant: 1500 });
  const t = totals(imp);
  assert.equal(t.net, 500);
  assert.equal(t.roiReel, 0.5);
  const v = computeVariance({ valeurAttendue: 400, p10: 100, p90: 900 }, imp);
  assert.equal(v.realise, 500);
  assert.equal(v.ecart, 100);            // 500 realise - 400 projete
  assert.equal(v.dansIntervalle, true);
  assert.equal(v.position, 'conforme');
  const sous = computeVariance({ valeurAttendue: 400, p10: 600, p90: 900 }, imp);
  assert.equal(sous.position, 'sous_performance');
});

test('gouvernance : notification a l ouverture d un gate', async () => {
  const { GovernanceService } = await import('./governance.mjs');
  const recus = [];
  const gov = new GovernanceService({ notifier: (e) => recus.push(e) });
  const { gateId } = gov.open({ ideaId: 'i9', type: 'validation', requiredRole: 'comex', payload: 'x' });
  assert.equal(recus.length, 1);
  assert.equal(recus[0].type, 'gate_opened');
  assert.equal(recus[0].gateId, gateId);
  assert.equal(recus[0].requiredRole, 'comex');
  assert.equal(gov.notifications().length, 1);
  // un notifier defaillant ne doit pas casser l'ouverture du gate
  const gov2 = new GovernanceService({ notifier: () => { throw new Error('smtp down'); } });
  assert.ok(gov2.open({ ideaId: 'i', type: 'validation', requiredRole: 'comex' }).gateId);
});

// ---------- Authentification ----------
test('auth : hash scrypt + verification (jamais de clair)', async () => {
  const { hashPassword, verifyPassword } = await import('./auth.mjs');
  const h = await hashPassword('motdepasse-solide-2026');
  assert.ok(h.startsWith('scrypt$'));
  assert.ok(!h.includes('motdepasse'));                 // le clair n'apparait pas
  assert.equal(await verifyPassword('motdepasse-solide-2026', h), true);
  assert.equal(await verifyPassword('mauvais-mot-de-passe', h), false);
  await assert.rejects(() => hashPassword('court'));    // politique de longueur
});

test('auth : jeton signe, falsification et expiration rejetees', async () => {
  const { issueToken, verifyToken } = await import('./auth.mjs');
  const secret = 'secret-de-test-uniquement';
  const token = await issueToken({ sub: 'u1', role: 'comex' }, secret, { ttlSec: 60 });
  const ok = await verifyToken(token, secret);
  assert.equal(ok.valid, true);
  assert.equal(ok.payload.role, 'comex');

  // signature falsifiee
  const [data] = token.split('.');
  assert.equal((await verifyToken(`${data}.signaturebidon`, secret)).valid, false);
  // payload modifie (elevation de privilege) -> signature invalide
  const forge = Buffer.from(JSON.stringify({ sub: 'u1', role: 'comex', exp: 9e9 })).toString('base64url');
  assert.equal((await verifyToken(`${forge}.${token.split('.')[1]}`, secret)).valid, false);
  // mauvais secret
  assert.equal((await verifyToken(token, 'autre-secret')).valid, false);
  // expiration
  const expire = await verifyToken(token, secret, { now: () => Math.floor(Date.now() / 1000) + 3600 });
  assert.equal(expire.valid, false);
  assert.equal(expire.reason, 'expire');
});

test('auth : inscription, connexion, et non-enumeration des comptes', async () => {
  const { AuthService } = await import('./auth.mjs');
  const auth = new AuthService({ secret: 'secret-de-test-uniquement' });
  const u = await auth.register({ email: 'Geoff@Example.com', password: 'motdepasse-solide-2026', role: 'comex' });
  assert.equal(u.email, 'geoff@example.com');           // normalise
  assert.equal(u.passwordHash, undefined);              // jamais expose
  const { token, user } = await auth.login({ email: 'geoff@example.com', password: 'motdepasse-solide-2026' });
  assert.equal(user.role, 'comex');
  const payload = await auth.verify(token);
  assert.equal(payload.sub, u.id);

  // meme message d'erreur : compte inconnu vs mot de passe faux
  const e1 = await auth.login({ email: 'inconnu@example.com', password: 'x' }).catch((e) => e.message);
  const e2 = await auth.login({ email: 'geoff@example.com', password: 'mauvais' }).catch((e) => e.message);
  assert.equal(e1, e2);
  await assert.rejects(() => auth.register({ email: 'geoff@example.com', password: 'motdepasse-solide-2026' }));
});

test('auth : RBAC et isolation multi-tenant', async () => {
  const { AuthService } = await import('./auth.mjs');
  const { createIdea } = await import('./model.mjs');
  const { InMemoryIdeaRepository } = await import('./repository.mjs');
  const auth = new AuthService({ secret: 'secret-de-test-uniquement' });
  await auth.register({ email: 'c@x.com', password: 'motdepasse-solide-2026', role: 'comex', tenantId: 'acme' });
  const { token } = await auth.login({ email: 'c@x.com', password: 'motdepasse-solide-2026' });
  const payload = await auth.verify(token);

  assert.equal(auth.hasRole(payload, ['comex', 'expert']), true);
  assert.equal(auth.hasRole(payload, ['contributeur']), false);
  assert.throws(() => auth.requireRole(payload, ['contributeur']));

  const repo = new InMemoryIdeaRepository();
  await repo.save(createIdea({ id: 'a', title: 'Acme', tenantId: 'acme' }));
  await repo.save(createIdea({ id: 'b', title: 'Autre', tenantId: 'other' }));
  const visibles = await repo.list({ tenantId: payload.tenantId });
  assert.equal(visibles.length, 1);
  assert.equal(visibles[0].id, 'a');                    // pas de fuite inter-tenant
  assert.equal(auth.sameTenant(payload, { tenantId: 'other' }), false);
});

test('auth : deconnexion revoque le jeton, revocation globale invalide les anciens', async () => {
  const { AuthService } = await import('./auth.mjs');
  const auth = new AuthService({ secret: 'secret-de-test-uniquement' });
  const u = await auth.register({ email: 'r@x.com', password: 'motdepasse-solide-2026' });
  const { token } = await auth.login({ email: 'r@x.com', password: 'motdepasse-solide-2026' });
  assert.ok(await auth.verify(token));            // valide avant deconnexion
  await auth.logout(token);
  await assert.rejects(() => auth.verify(token), (e) => e.code === 'AUTH_REVOKED');

  // revocation globale (ex. changement de mot de passe) : les jetons anterieurs tombent
  const { token: t2 } = await auth.login({ email: 'r@x.com', password: 'motdepasse-solide-2026' });
  auth.sessions.revokeAllForUser(u.id, Math.floor(Date.now() / 1000) + 5);
  await assert.rejects(() => auth.verify(t2), (e) => e.code === 'AUTH_REVOKED');
});

test('auth : limitation des tentatives (anti-bruteforce)', async () => {
  const { AuthService, LoginThrottle } = await import('./auth.mjs');
  let t = 0;
  const throttle = new LoginThrottle({ maxAttempts: 3, windowMs: 1000, now: () => t });
  const auth = new AuthService({ secret: 'secret-de-test-uniquement', throttle });
  await auth.register({ email: 'b@x.com', password: 'motdepasse-solide-2026' });
  for (let i = 0; i < 3; i++) {
    await assert.rejects(() => auth.login({ email: 'b@x.com', password: 'faux' }), (e) => e.code === 'AUTH_INVALID');
  }
  // 4e tentative : verrouille, meme avec le BON mot de passe
  await assert.rejects(
    () => auth.login({ email: 'b@x.com', password: 'motdepasse-solide-2026' }),
    (e) => e.code === 'AUTH_THROTTLED',
  );
  t += 1500;                                       // fenetre expiree
  const ok = await auth.login({ email: 'b@x.com', password: 'motdepasse-solide-2026' });
  assert.ok(ok.token);
});

test('auth : persistance des utilisateurs (survie au redemarrage, ecriture atomique)', async () => {
  const { FileUserStore, AuthService } = await import('./auth.mjs');
  // Faux systeme de fichiers : evite toute E/S disque dans les tests.
  const disque = new Map(); const ecritures = [];
  const fakeFs = {
    async readFile(p) { if (!disque.has(p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return disque.get(p); },
    async writeFile(p, data, opts) { ecritures.push({ p, mode: opts?.mode }); disque.set(p, data); },
    async rename(a, b) { disque.set(b, disque.get(a)); disque.delete(a); },
    async chmod() {},
  };
  const path = '/var/kayros/users.json';

  const store1 = new FileUserStore({ path, fs: fakeFs });
  await store1.load();
  const auth1 = new AuthService({ users: store1, secret: 'secret-de-test-uniquement' });
  await auth1.register({ email: 'p@x.com', password: 'motdepasse-solide-2026', role: 'comex', tenantId: 'acme' });

  // ecriture atomique : on ecrit dans .tmp puis on renomme
  assert.ok(ecritures.some((e) => e.p.endsWith('.tmp')));
  assert.equal(ecritures[0].mode, 0o600);            // permissions restreintes
  assert.ok(disque.has(path) && !disque.has(`${path}.tmp`));

  // "redemarrage" : nouveau magasin, meme fichier
  const store2 = new FileUserStore({ path, fs: fakeFs });
  await store2.load();
  const auth2 = new AuthService({ users: store2, secret: 'secret-de-test-uniquement' });
  const { user } = await auth2.login({ email: 'p@x.com', password: 'motdepasse-solide-2026' });
  assert.equal(user.role, 'comex');
  assert.equal(user.tenantId, 'acme');

  // le fichier ne contient pas le mot de passe en clair
  assert.ok(!disque.get(path).includes('motdepasse-solide-2026'));
});

test('auth : rotation de mot de passe + invalidation des sessions', async () => {
  const { InMemoryUserStore, AuthService, hashPassword } = await import('./auth.mjs');
  const store = new InMemoryUserStore();
  const auth = new AuthService({ users: store, secret: 'secret-de-test-uniquement' });
  const u = await auth.register({ email: 'rot@x.com', password: 'ancien-mot-de-passe-2026' });
  const { token: ancien } = await auth.login({ email: 'rot@x.com', password: 'ancien-mot-de-passe-2026' });

  // rotation : nouvelle empreinte + revocation globale
  const cible = await store.findById(u.id);
  cible.passwordHash = await hashPassword('nouveau-mot-de-passe-2026');
  auth.revokeAllSessions(u.id);
  auth.sessions.revokeAllForUser(u.id, Math.floor(Date.now() / 1000) + 5);

  await assert.rejects(() => auth.verify(ancien), (e) => e.code === 'AUTH_REVOKED');
  await assert.rejects(() => auth.login({ email: 'rot@x.com', password: 'ancien-mot-de-passe-2026' }));
  assert.ok((await auth.login({ email: 'rot@x.com', password: 'nouveau-mot-de-passe-2026' })).token);
});

// ---------- Canaux de notification (circuit reellement branche) ----------
test('notify : webhook envoie une charge utile exploitable', async () => {
  const { WebhookNotifier, formatGateEvent } = await import('./notify.mjs');
  let recu = null;
  const fetchImpl = async (url, opts) => { recu = { url, body: JSON.parse(opts.body) }; return { ok: true, status: 200 }; };
  const w = new WebhookNotifier({ url: 'https://hooks.example/x', fetchImpl });
  const msg = formatGateEvent(
    { gateId: 'g1', gateType: 'validation', requiredRole: 'comex', ideaId: 'i1', createdAt: 'T', evaluation: { count: 2, moyennePonderee: 70, recommandation: 'Go', consensus: true } },
    { titre: 'Offre B2B', destinataires: ['c@x.com'] },
  );
  const r = await w.send(msg);
  assert.equal(r.ok, true);
  assert.equal(recu.url, 'https://hooks.example/x');
  assert.match(recu.body.text, /Offre B2B/);
  assert.match(recu.body.text, /70\/100/);        // l'agregat qui instruit est transmis
  assert.equal(recu.body.gate.gateId, 'g1');
  assert.deepEqual(recu.body.destinataires, ['c@x.com']);
});

test('notify : sans vote, le message le dit explicitement', async () => {
  const { formatGateEvent } = await import('./notify.mjs');
  const msg = formatGateEvent({ ideaId: 'i2', requiredRole: 'comex' }, { titre: 'X' });
  assert.match(msg.texte, /Aucun vote préalable/);
  assert.match(msg.texte, /doit être motivé/);
});

test('notify : un canal en panne n empeche pas les autres', async () => {
  const { CompositeNotifier, ConsoleNotifier, WebhookNotifier } = await import('./notify.mjs');
  const logs = [];
  const ko = new WebhookNotifier({ url: 'https://x', fetchImpl: async () => { throw new Error('injoignable'); } });
  const ok = new ConsoleNotifier({ logger: { info: (m) => logs.push(m) } });
  const res = await new CompositeNotifier([ko, ok]).send({ sujet: 'S', texte: 'T', destinataires: [] });
  assert.equal(res.length, 2);
  assert.equal(res.find((r) => r.canal === 'webhook').ok, false);
  assert.equal(res.find((r) => r.canal === 'console').ok, true);
  assert.equal(logs.length, 1);                    // le canal sain a bien emis
});

test('notify : gateNotifier resout destinataires et ne propage jamais d erreur', async () => {
  const { gateNotifier, CompositeNotifier, WebhookNotifier } = await import('./notify.mjs');
  let recu = null;
  const canal = new CompositeNotifier([new WebhookNotifier({ url: 'https://h', fetchImpl: async (u, o) => { recu = JSON.parse(o.body); return { ok: true }; } })]);
  const n = gateNotifier({ canal, resolveDestinataires: async () => ['a@x.com', 'b@x.com'], resolveTitre: async () => 'Titre' });
  await n({ gateId: 'g', requiredRole: 'comex', ideaId: 'i' });
  assert.deepEqual(recu.destinataires, ['a@x.com', 'b@x.com']);

  // resolution defaillante : renvoie une erreur structuree, ne leve pas
  const nKo = gateNotifier({ canal, resolveDestinataires: async () => { throw new Error('annuaire hs'); } });
  const r = await nKo({ gateId: 'g2' });
  assert.equal(r.ok, false);
  assert.match(r.erreur, /annuaire hs/);
});

test('notify : EmailNotifier sans destinataire n envoie pas', async () => {
  const { EmailNotifier } = await import('./notify.mjs');
  let appels = 0;
  const e = new EmailNotifier({ send: async () => { appels++; } });
  const r = await e.send({ sujet: 'S', texte: 'T', destinataires: [] });
  assert.equal(r.ok, false);
  assert.equal(appels, 0);
});
