// File de missions durable : une mission en cours survit à un crash (bail
// expiré) ou à un arrêt propre (missions rendues à la file) et reprend dans
// un nouveau « processus » au lieu d'être marquée `failed`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HybridAgentGateway } from '../hybrid-agent-gateway.mjs';
import { SwarmService } from '../swarm.mjs';
import { InMemoryCollaborationStore } from '../collaboration-store.mjs';
import { InMemoryMissionQueue, MissionWorker } from './mission-queue.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeout = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await check()) return true; await wait(10); }
  return false;
}
function stubRun(swarm, { hang = false, calls = [] } = {}) {
  swarm.run = async (_id, options) => {
    calls.push(options);
    if (hang) await new Promise(() => {});
    const run = {
      run_id: options.runId, swarm_name: 'S', question: options.question,
      analyses: [{ agent_id: 'cfo', verdict: 'GO', critical_risks: [], required_mitigations: [], unverified_assumptions: [] }],
      consensus: { verdict: 'GO', rationale: 'ok', requires_human_arbitration: true }, status: 'pending_human_arbitration', human_decision: null, audit: [],
    };
    swarm.runs.set(swarm._key(options.tenantId, run.run_id), run);
    return run;
  };
  return calls;
}
function processWith({ store, queue, leaseMs = 200, events = [] }) {
  const swarm = new SwarmService({ logger: null });
  const gateway = new HybridAgentGateway({ swarm, store, eventSink: (kind, thread) => { events.push([kind, thread.thread_id]); } });
  const worker = new MissionWorker({ queue, handler: (job) => gateway.executeJob(job), concurrency: 1, pollMs: 20, leaseMs, logger: null });
  gateway.setQueue(queue, worker);
  return { swarm, gateway, worker };
}

test('crash pendant une mission : le bail expire et un nouveau processus la reprend', async () => {
  const store = new InMemoryCollaborationStore();
  const queue = new InMemoryMissionQueue();
  const first = processWith({ store, queue });
  stubRun(first.swarm, { hang: true });
  const room = await first.gateway.createRoom({ platform: 'console', external_room_id: 's1', name: 'S', mode: 'always', active_agents: ['cfo'] }, { tenantId: 't' });
  first.worker.start();
  const started = await first.gateway.startMessage({ platform: 'console', room_id: room.room_id, tenantId: 't', text: 'Lancer ?', explicit: true, by: 'u' });
  assert.equal(started.queued, true);
  assert.ok(await until(async () => (await queue.activeForThread(started.thread.thread_id))?.status === 'running'));
  await first.worker.stop(); // crash : rien n'est rendu à la file

  const events = [];
  const second = processWith({ store, queue, events });
  const calls = stubRun(second.swarm);
  assert.equal(await second.gateway.recoverInterruptedRuns(), 0, 'une mission en file n’est pas marquée failed');
  assert.equal((await store.getThread(started.thread.thread_id)).status, 'running');
  second.worker.start();
  assert.ok(await until(async () => (await store.getThread(started.thread.thread_id)).status === 'awaiting_arbitration'), 'mission reprise et terminée');
  await second.worker.idle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runId, started.run_id, 'même run_id : le fil et le client gardent leurs identifiants');
  const job = queue.jobs.get(`job_${started.run_id}`);
  assert.equal(job.status, 'done');
  assert.equal(job.attempts, 2);
  assert.deepEqual(events, [['completed', started.thread.thread_id]]);
  const thread = await store.getThread(started.thread.thread_id);
  assert.equal(thread.resumed_attempt, 2);
  await second.worker.stop();
});

test('arrêt propre (SIGINT) : la mission est rendue à la file et reprise sans attendre le bail', async () => {
  const store = new InMemoryCollaborationStore();
  const queue = new InMemoryMissionQueue();
  const first = processWith({ store, queue, leaseMs: 60_000 });
  stubRun(first.swarm, { hang: true });
  const room = await first.gateway.createRoom({ platform: 'console', external_room_id: 's2', name: 'S', mode: 'always', active_agents: ['cfo'] }, { tenantId: 't' });
  first.worker.start();
  const started = await first.gateway.startMessage({ platform: 'console', room_id: room.room_id, tenantId: 't', text: 'Lancer ?', explicit: true });
  assert.ok(await until(async () => (await queue.activeForThread(started.thread.thread_id))?.status === 'running'));
  assert.equal(await first.worker.stop({ release: true }), 1);

  const second = processWith({ store, queue, leaseMs: 60_000 });
  stubRun(second.swarm);
  second.worker.start();
  assert.ok(await until(async () => (await store.getThread(started.thread.thread_id)).status === 'awaiting_arbitration'));
  await second.worker.stop();
});

test('au-delà de max_attempts reprises, le fil passe failed avec un message lisible', async () => {
  const store = new InMemoryCollaborationStore();
  const queue = new InMemoryMissionQueue();
  const events = [];
  const proc = processWith({ store, queue, events });
  stubRun(proc.swarm);
  const room = await proc.gateway.createRoom({ platform: 'console', external_room_id: 's3', name: 'S', mode: 'always', active_agents: ['cfo'] }, { tenantId: 't' });
  const started = await proc.gateway.startMessage({ platform: 'console', room_id: room.room_id, tenantId: 't', text: 'Lancer ?', explicit: true });
  queue.jobs.get(`job_${started.run_id}`).attempts = 3; // trois tentatives déjà consommées
  proc.worker.start();
  assert.ok(await until(async () => (await store.getThread(started.thread.thread_id)).status === 'failed'));
  await proc.worker.idle();
  assert.match((await store.getThread(started.thread.thread_id)).error, /redémarrage/);
  assert.deepEqual(events.map(([kind]) => kind), ['failed']);
  await proc.worker.stop();
});

test('sans file, comportement historique : exécution immédiate dans le processus', async () => {
  const store = new InMemoryCollaborationStore();
  const swarm = new SwarmService({ logger: null });
  stubRun(swarm);
  const gateway = new HybridAgentGateway({ swarm, store });
  const room = await gateway.createRoom({ platform: 'console', external_room_id: 's4', name: 'S', mode: 'always', active_agents: ['cfo'] }, { tenantId: 't' });
  const started = await gateway.startMessage({ platform: 'console', room_id: room.room_id, tenantId: 't', text: 'Lancer ?', explicit: true });
  assert.equal(started.queued, false);
  const done = await gateway.waitForThread(started.thread.thread_id, { tenantId: 't' });
  assert.equal(done.status, 'awaiting_arbitration');
});

test('allowConcurrent : deux missions d’intégration simultanées sur un même collectif', async () => {
  const store = new InMemoryCollaborationStore();
  const swarm = new SwarmService({ logger: null });
  stubRun(swarm);
  const gateway = new HybridAgentGateway({ swarm, store });
  const room = await gateway.createRoom({ platform: 'console', external_room_id: 's5', name: 'S', mode: 'always', active_agents: ['cfo'] }, { tenantId: 't' });
  const base = { platform: 'console', room_id: room.room_id, tenantId: 't', text: 'Lancer ?', explicit: true, allowConcurrent: true };
  const a = await gateway.startMessage(base);
  const b = await gateway.startMessage({ ...base, thread_id: 'thread_reserved_1' });
  assert.equal(b.thread.thread_id, 'thread_reserved_1');
  await gateway.idle();
  assert.equal((await store.getThread(a.thread.thread_id)).status, 'awaiting_arbitration');
  assert.equal((await store.getThread('thread_reserved_1')).status, 'awaiting_arbitration');
});
