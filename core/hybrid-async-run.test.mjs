// Exécution asynchrone des missions de la console (fil `running` → statut final).
// Aucun appel réseau : le run du collectif est simulé ou alimenté par `agentResults`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HybridAgentGateway, THREAD_RUNNING, THREAD_FAILED, INTERRUPTED_RUN_ERROR,
} from './hybrid-agent-gateway.mjs';
import { InMemoryCollaborationStore } from './collaboration-store.mjs';
import { SwarmService, normalizeAgentAnalysis, extractAgentJson } from './swarm.mjs';
import { OpenAICompatibleProvider } from './kayros-llm.mjs';

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fakeRun(runId, question, verdict = 'GO', extra = {}) {
  return {
    run_id: runId, swarm_name: 'S', question,
    analyses: [{ agent_id: 'cfo', verdict, critical_risks: [], required_mitigations: [], unverified_assumptions: [] }],
    consensus: { verdict, rationale: 'ok', requires_human_arbitration: true },
    status: 'pending_human_arbitration', human_decision: null, audit: [], ...extra,
  };
}

async function setup({ store = new InMemoryCollaborationStore(), runTimeoutMs = 0 } = {}) {
  const swarm = new SwarmService({ logger: null });
  const gateway = new HybridAgentGateway({ swarm, store, runTimeoutMs });
  const room = await gateway.createRoom({ platform: 'console', external_room_id: `ext-${Math.random()}`, name: 'Comex', mode: 'always', active_agents: ['cfo', 'cto', 'legal_counsel'] }, { tenantId: 't1', by: 'a@kayros.test', ownerId: 'u1' });
  return { swarm, gateway, room, store };
}

test('startMessage : fil `running` immédiat, progression x/3, puis statut final', async () => {
  const { swarm, gateway, room } = await setup();
  const gate = deferred();
  let seen = null;
  swarm.run = async (_id, options) => {
    seen = options;
    await options.onProgress({ completed: 1, total: 3, agent_id: 'cfo' });
    await gate.promise;
    await options.onProgress({ completed: 2, total: 3, agent_id: 'cto' });
    await options.onProgress({ completed: 3, total: 3, agent_id: 'legal_counsel' });
    const run = fakeRun(options.runId, options.question);
    swarm.runs.set(swarm._key(options.tenantId, run.run_id), run);
    return run;
  };
  const started = await gateway.startMessage({ platform: 'console', room_id: room.room_id, tenantId: 't1', text: 'Lancer ?', explicit: true, by: 'a@kayros.test' });
  assert.equal(started.thread.status, THREAD_RUNNING);
  assert.ok(started.run_id);
  assert.equal(started.thread.active_run_id, started.run_id);
  assert.equal(started.thread.messages.length, 1, 'la question est enregistrée tout de suite');
  await tick(); await tick();
  assert.equal(seen.runId, started.run_id, 'le run réservé est transmis au collectif');
  let current = await gateway.getThread(started.thread.thread_id, { tenantId: 't1' });
  assert.equal(current.status, THREAD_RUNNING);
  assert.deepEqual(current.progress, { completed: 1, total: 3 });
  gate.resolve();
  const finished = await gateway.waitForThread(started.thread.thread_id);
  assert.equal(finished.status, 'awaiting_arbitration');
  current = await gateway.getThread(started.thread.thread_id, { tenantId: 't1' });
  assert.equal(current.current_run_id, started.run_id);
  assert.equal(current.active_run_id, null);
  assert.equal(current.messages.find((message) => message.kind === 'run').run.consensus.verdict, 'GO');
  const types = (await gateway.activity({ tenantId: 't1' })).map((event) => event.type);
  assert.ok(types.includes('collaboration.run.started'));
  assert.ok(types.includes('collaboration.run.completed'));
  assert.equal(gateway.jobs.size, 0);
});

test('startMessage avec le vrai SwarmService : runId réservé et progression par agent', async () => {
  const { swarm, gateway, room } = await setup();
  const original = swarm.run.bind(swarm);
  const progress = [];
  swarm.run = (id, options) => original(id, {
    ...options,
    onProgress: async (step) => { progress.push(step.completed); return options.onProgress(step); },
    agentResults: {
      cfo: '{"verdict":"GO","primary_reason":"ROI"}',
      cto: '```json\n{"verdict":"GO","primary_reason":"Stack prête"}\n```',
      legal_counsel: '{"verdict":"CONDITIONAL_GO","primary_reason":"RGPD"}',
    },
  });
  const started = await gateway.startMessage({ platform: 'console', room_id: room.room_id, tenantId: 't1', text: 'Lancer ?', explicit: true });
  const finished = await gateway.waitForThread(started.thread.thread_id);
  assert.deepEqual(progress, [1, 2, 3]);
  assert.deepEqual(finished.progress, { completed: 3, total: 3 });
  assert.equal(finished.current_run_id, started.run_id);
  assert.ok(swarm.getRun(started.run_id, { tenantId: 't1' }), 'run persisté sous l’identifiant annoncé');
});

test('échec du collectif : statut `failed` avec un message lisible', async () => {
  const { swarm, gateway, room } = await setup();
  swarm.run = async () => { throw new Error('nvidia http 503'); };
  const started = await gateway.startMessage({ platform: 'console', room_id: room.room_id, tenantId: 't1', text: 'Lancer ?', explicit: true });
  const failed = await gateway.waitForThread(started.thread.thread_id);
  assert.equal(failed.status, THREAD_FAILED);
  assert.equal(failed.error, 'nvidia http 503');
  assert.equal(failed.active_run_id, null);
  assert.match(failed.messages.at(-1).text, /La mission n’a pas abouti : nvidia http 503/);
  assert.ok((await gateway.activity({ tenantId: 't1' })).some((event) => event.type === 'collaboration.run.failed'));
});

test('délai maximal dépassé : le fil passe `failed`, un résultat tardif est ignoré', async () => {
  const { swarm, gateway, room } = await setup({ runTimeoutMs: 20 });
  const late = deferred();
  swarm.run = async (_id, options) => { await late.promise; return fakeRun(options.runId, options.question); };
  const started = await gateway.startMessage({ platform: 'console', room_id: room.room_id, tenantId: 't1', text: 'Lancer ?', explicit: true });
  const failed = await gateway.waitForThread(started.thread.thread_id);
  assert.equal(failed.status, THREAD_FAILED);
  assert.match(failed.error, /délai maximal/);
  late.resolve(); await tick();
  assert.equal((await gateway.getThread(started.thread.thread_id, { tenantId: 't1' })).status, THREAD_FAILED);
});

test('fil en cours : relance, arbitrage et seconde mission sur la session refusés (RUN_IN_PROGRESS)', async () => {
  const { swarm, gateway, room } = await setup();
  const gate = deferred();
  swarm.run = async (_id, options) => { await gate.promise; return fakeRun(options.runId, options.question); };
  const started = await gateway.startMessage({ platform: 'console', room_id: room.room_id, tenantId: 't1', text: 'Lancer ?', explicit: true });
  const threadId = started.thread.thread_id;
  await assert.rejects(gateway.startMessage({ platform: 'console', room_id: room.room_id, tenantId: 't1', text: 'Encore ?', explicit: true }), { code: 'RUN_IN_PROGRESS' });
  await assert.rejects(gateway.startContinueThread(threadId, { tenantId: 't1', text: 'Budget validé' }), { code: 'RUN_IN_PROGRESS' });
  await assert.rejects(gateway.continueThread(threadId, { tenantId: 't1', text: 'Budget validé' }), { code: 'RUN_IN_PROGRESS' });
  await assert.rejects(gateway.arbitrateThread(threadId, { action: 'accept_consensus' }, { tenantId: 't1', by: 'boss' }), { code: 'RUN_IN_PROGRESS' });
  // Isolation tenant : un autre tenant ne voit pas le fil.
  assert.equal(await gateway.getThread(threadId, { tenantId: 't2' }), null);
  await assert.rejects(gateway.startContinueThread(threadId, { tenantId: 't2', text: 'x' }), /fil introuvable/);
  gate.resolve();
  await gateway.idle();
});

test('startContinueThread : relance asynchrone ; un échec conserve le run précédent', async () => {
  const { swarm, gateway, room } = await setup();
  let n = 0;
  let fail = false;
  swarm.run = async (_id, options) => {
    if (fail) throw new Error('quota LLM épuisé');
    n += 1;
    const run = fakeRun(options.runId, options.question, n === 1 ? 'CONDITIONAL_GO' : 'GO');
    swarm.runs.set(swarm._key(options.tenantId, run.run_id), run);
    return run;
  };
  const started = await gateway.startMessage({ platform: 'console', room_id: room.room_id, tenantId: 't1', text: 'Lancer ?', explicit: true });
  const first = await gateway.waitForThread(started.thread.thread_id);
  const rerun = await gateway.startContinueThread(first.thread_id, { tenantId: 't1', text: 'Budget validé', by: 'a@kayros.test' });
  assert.equal(rerun.thread.status, THREAD_RUNNING);
  assert.equal(rerun.thread.current_run_id, first.current_run_id, 'run courant inchangé pendant la relance');
  assert.equal(rerun.thread.messages.at(-1).kind, 'clarification');
  const second = await gateway.waitForThread(first.thread_id);
  assert.equal(second.status, 'awaiting_arbitration');
  assert.equal(second.current_run_id, rerun.run_id);
  fail = true;
  const third = await gateway.startContinueThread(first.thread_id, { tenantId: 't1', text: 'Autre précision' });
  const failed = await gateway.waitForThread(first.thread_id);
  assert.equal(failed.status, THREAD_FAILED);
  assert.equal(failed.current_run_id, second.current_run_id, 'le dernier run réussi reste consultable');
  assert.notEqual(failed.current_run_id, third.run_id);
  // Un fil en échec peut être relancé.
  fail = false;
  await gateway.startContinueThread(first.thread_id, { tenantId: 't1', text: 'Nouvelle tentative' });
  assert.equal((await gateway.waitForThread(first.thread_id)).status, 'awaiting_arbitration');
});

test('redémarrage : les exécutions restées `running` passent `failed` (interrompue)', async () => {
  const store = new InMemoryCollaborationStore();
  const { swarm, gateway, room } = await setup({ store });
  swarm.run = () => new Promise(() => {}); // processus « tué » pendant les analyses
  const started = await gateway.startMessage({ platform: 'console', room_id: room.room_id, tenantId: 't1', text: 'Lancer ?', explicit: true });
  assert.equal(await gateway.recoverInterruptedRuns(), 0, 'une exécution suivie par ce processus n’est pas touchée');
  // Nouveau processus sur le même store.
  const restarted = new HybridAgentGateway({ swarm: new SwarmService({ logger: null }), store });
  assert.equal(await restarted.recoverInterruptedRuns(), 1);
  const thread = await restarted.getThread(started.thread.thread_id, { tenantId: 't1' });
  assert.equal(thread.status, THREAD_FAILED);
  assert.equal(thread.error, INTERRUPTED_RUN_ERROR);
  assert.equal(await restarted.recoverInterruptedRuns(), 0, 'idempotent');
  // La session n'est plus bloquée par le fil interrompu.
  restarted.swarm.run = async (_id, options) => fakeRun(options.runId, options.question);
  const again = await restarted.startMessage({ platform: 'console', room_id: room.room_id, tenantId: 't1', text: 'Relancer ?', explicit: true });
  assert.equal((await restarted.waitForThread(again.thread.thread_id)).status, 'awaiting_arbitration');
});

test('le mode synchrone handleMessage reste inchangé', async () => {
  const { swarm, gateway, room } = await setup();
  swarm.run = async (_id, options) => fakeRun('run-sync', options.question);
  const result = await gateway.handleMessage({ platform: 'console', room_id: room.room_id, tenantId: 't1', text: 'Lancer ?', explicit: true });
  assert.equal(result.run.run_id, 'run-sync');
  assert.equal(result.thread.status, 'awaiting_arbitration');
  assert.equal(gateway.jobs.size, 0);
});

// --- Parseur de verdict : sorties Kimi K3 (reasoning_content + ```json) ---------

const KIMI_JSON = '{\n  "verdict": "NO_GO",\n  "primary_reason": "Marge négative {hors subventions}",\n  "critical_risks": ["Trésorerie < 6 mois"],\n  "required_mitigations": ["Lever 2 M€"],\n  "unverified_assumptions": []\n}';

test('parseur : JSON entouré de ```json (avec prose et accolades autour)', () => {
  const output = `Voici mon analyse {synthèse} :\n\n\`\`\`json\n${KIMI_JSON}\n\`\`\`\n\nJe reste disponible.`;
  assert.equal(extractAgentJson(output).verdict, 'NO_GO');
  const analysis = normalizeAgentAnalysis(output, { agent_id: 'cfo', role_name: 'CFO' });
  assert.equal(analysis.verdict, 'NO_GO');
  assert.equal(analysis.primary_reason, 'Marge négative {hors subventions}');
  assert.deepEqual(analysis.critical_risks, ['Trésorerie < 6 mois']);
  assert.deepEqual(analysis.unverified_assumptions, []);
});

test('parseur : bloc ``` sans langage, et objet tronqué toujours géré comme avant', () => {
  assert.equal(normalizeAgentAnalysis('```\n{"verdict":"GO","primary_reason":"ok"}\n```', { agent_id: 'cto' }).verdict, 'GO');
  const truncated = normalizeAgentAnalysis('{"verdict":"CONDITIONAL_GO","metrics":[{"metric":"a"}],"primary_reason":"coup', { agent_id: 'cto' });
  assert.equal(truncated.verdict, 'CONDITIONAL_GO');
  assert.notEqual(truncated.primary_reason, '', 'raison issue du texte brut, pas d’un sous-objet');
});

test('provider NVIDIA (Kimi K3) : reasoning_content ignoré, contenu ```json parsé en verdict', async () => {
  const fetchImpl = async () => ({
    ok: true,
    headers: { get: () => null },
    json: async () => ({
      model: 'moonshotai/kimi-k3',
      choices: [{
        finish_reason: 'stop',
        message: {
          reasoning_content: 'Je pense que la réponse est GO {brouillon} mais vérifions…',
          content: `\`\`\`json\n${KIMI_JSON}\n\`\`\``,
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }),
  });
  const provider = new OpenAICompatibleProvider({
    id: 'nvidia', baseUrl: 'https://nvidia.invalid/v1', apiKey: 'factice-test', defaultModel: 'moonshotai/kimi-k3', fetchImpl,
  });
  const completion = await provider.complete({ messages: [{ role: 'user', content: 'Lancer ?' }] });
  assert.ok(!completion.text.includes('brouillon'), 'le raisonnement n’entre pas dans le texte');
  const analysis = normalizeAgentAnalysis(completion.text, { agent_id: 'cfo' });
  assert.equal(analysis.verdict, 'NO_GO');
  assert.deepEqual(analysis.required_mitigations, ['Lever 2 M€']);
});
