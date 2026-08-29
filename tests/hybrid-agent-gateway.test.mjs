import test from 'node:test';
import assert from 'node:assert/strict';
import { HybridAgentGateway } from '../core/hybrid-agent-gateway.mjs';
import { InMemoryCollaborationStore } from '../core/collaboration-store.mjs';
import { SwarmService } from '../core/swarm.mjs';

function gatewayWithDeterministicAgents() {
  const swarm = new SwarmService();
  const gateway = new HybridAgentGateway({ swarm });
  return { swarm, gateway };
}

test('connects a room to a governed default swarm', async () => {
  const { swarm, gateway } = gatewayWithDeterministicAgents();
  const room = await gateway.createRoom({
    platform: 'slack', external_room_id: 'C42', name: 'Pricing launch',
  }, { tenantId: 'tenant-a', by: 'owner@kayros.test' });

  assert.equal(room.platform, 'slack');
  assert.equal(room.mode, 'mention_only');
  assert.deepEqual(swarm.getConfiguration(room.swarm_id, { tenantId: 'tenant-a' }).active_agents, ['cfo', 'cto', 'legal_counsel']);
  assert.equal((await gateway.listRooms({ tenantId: 'tenant-b' })).length, 0);
});

test('runs only when mentioned and deduplicates platform retries', async () => {
  const { gateway } = gatewayWithDeterministicAgents();
  const room = await gateway.createRoom({ platform: 'discord', external_room_id: 'D7', name: 'COMEX' }, { tenantId: 'tenant-a' });
  const ignored = await gateway.handleMessage({ platform: 'discord', external_room_id: 'D7', message_id: 'm1', text: 'hello' });
  assert.equal(ignored.ignored, true);

  const input = {
    platform: 'discord', external_room_id: 'D7', message_id: 'm2',
    text: '@Kayros faut-il lancer maintenant ?', explicit: true,
    agentResults: null,
  };
  // Inject deterministic analyses through the SwarmService boundary.
  gateway.swarm.run = async (_id, options) => ({
    run_id: 'run-1', swarm_name: 'COMEX — hybrid team', question: options.question,
    analyses: [{ critical_risks: ['Budget non validé'], required_mitigations: ['Valider le budget'] }],
    consensus: { verdict: 'CONDITIONAL_GO', rationale: 'Une condition reste ouverte.', requires_human_arbitration: true },
  });
  const first = await gateway.handleMessage(input);
  const retry = await gateway.handleMessage(input);
  assert.equal(first.run.question, 'faut-il lancer maintenant ?');
  assert.equal(first.summary.verdict, 'CONDITIONAL_GO');
  assert.ok(first.thread.thread_id);
  assert.equal(first.thread.status, 'needs_clarification');
  assert.equal(first.thread.messages.some((message) => message.kind === 'clarification_request'), true);
  assert.equal(retry.duplicate, true);
  assert.equal((await gateway.activity({ roomId: room.room_id })).filter((e) => e.type === 'collaboration.run.completed').length, 1);
});

test('human clarification reruns the same room collective with durable context', async () => {
  const { gateway } = gatewayWithDeterministicAgents();
  await gateway.createRoom({ platform: 'console', external_room_id: 'local-1', name: 'Launch' }, { tenantId: 'tenant-a' });
  let calls = 0;
  gateway.swarm.run = async (_id, options) => {
    calls += 1;
    return {
      run_id: `run-${calls}`, swarm_name: 'Launch', question: options.question,
      analyses: [{ agent_id: 'cfo', role_name: 'CFO', verdict: calls === 1 ? 'CONDITIONAL_GO' : 'GO',
        primary_reason: 'Budget evidence', critical_risks: calls === 1 ? ['Budget inconnu'] : [],
        required_mitigations: calls === 1 ? ['Confirmer le budget'] : [], unverified_assumptions: [] }],
      consensus: { verdict: calls === 1 ? 'CONDITIONAL_GO' : 'GO', rationale: 'review', requires_human_arbitration: true },
    };
  };
  const first = await gateway.handleMessage({ platform: 'console', external_room_id: 'local-1', text: 'Lancer ?', explicit: true, tenantId: 'tenant-a' });
  const continued = await gateway.continueThread(first.thread.thread_id, { tenantId: 'tenant-a', text: 'Budget validé à 120 k€', by: 'owner@test' });
  assert.equal(calls, 2);
  assert.equal(continued.current_run_id, 'run-2');
  assert.equal(continued.messages.filter((message) => message.kind === 'run').length, 2);
});

test('serializes agent work inside one room', async () => {
  const { gateway } = gatewayWithDeterministicAgents();
  await gateway.createRoom({ platform: 'teams', external_room_id: 'T1', name: 'Ops', mode: 'always' }, { tenantId: 'tenant-a' });
  let active = 0;
  let maxActive = 0;
  gateway.swarm.run = async (_id, options) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { run_id: options.question, swarm_name: 'Ops', analyses: [], consensus: { verdict: 'GO', rationale: 'ok', requires_human_arbitration: true } };
  };
  await Promise.all([
    gateway.handleMessage({ platform: 'teams', external_room_id: 'T1', message_id: '1', text: 'A' }),
    gateway.handleMessage({ platform: 'teams', external_room_id: 'T1', message_id: '2', text: 'B' }),
  ]);
  assert.equal(maxActive, 1);
});

test('automatically enables consented hybrid personalities in room swarms', async () => {
  const { swarm, gateway } = gatewayWithDeterministicAgents();
  swarm.assignPersonality('cfo', {
    assigned_name: 'Finance lead', consent_confirmed: true,
    communication_style: 'direct and evidence-first',
  }, { tenantId: 'tenant-a', by: 'owner@kayros.test' });
  const room = await gateway.createRoom({
    platform: 'slack', external_room_id: 'C-HYBRID', name: 'Finance', active_agents: ['cfo', 'cto'],
  }, { tenantId: 'tenant-a' });
  const configuration = swarm.getConfiguration(room.swarm_id, { tenantId: 'tenant-a' });
  assert.equal(configuration.personality_simulation_enabled, true);
});

test('a second instance restores the room swarm and hybrid profile from shared storage', async () => {
  const store = new InMemoryCollaborationStore();
  const swarmA = new SwarmService();
  swarmA.assignPersonality('cfo', {
    assigned_name: 'Shared finance lead', consent_confirmed: true,
    communication_style: 'risk-first',
  }, { tenantId: 'tenant-a' });
  const gatewayA = new HybridAgentGateway({ swarm: swarmA, store });
  const room = await gatewayA.createRoom({
    platform: 'slack', external_room_id: 'C-SHARED', name: 'Shared room', active_agents: ['cfo', 'cto'],
  }, { tenantId: 'tenant-a' });

  const swarmB = new SwarmService();
  const gatewayB = new HybridAgentGateway({ swarm: swarmB, store });
  const result = await gatewayB.handleMessage({
    platform: 'slack', external_room_id: 'C-SHARED', message_id: 'shared-1',
    text: '@Kayros évaluer le lancement', explicit: true,
  });

  assert.equal(result.room.room_id, room.room_id);
  assert.equal(swarmB.getConfiguration(room.swarm_id, { tenantId: 'tenant-a' }).personality_simulation_enabled, true);
  assert.equal(swarmB.registry.get('cfo', { tenantId: 'tenant-a' }).human_profile.assigned_name, 'Shared finance lead');
});
