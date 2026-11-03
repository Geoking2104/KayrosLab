import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAgUiEvents, runRemoteAgUiAgent, remoteAgUiConfig } from './remote-ag-ui.mjs';
import { SwarmService } from '../swarm.mjs';
import { HarnessComplianceError } from '../agent-harness.mjs';

const sse = (...deltas) => [
  { type: 'RUN_STARTED' }, { type: 'TEXT_MESSAGE_START', messageId: 'm' },
  ...deltas.map((delta) => ({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta })),
  { type: 'TEXT_MESSAGE_END', messageId: 'm' }, { type: 'RUN_FINISHED' },
].map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
const def = { agent_id: 'remote_cfo', role_name: 'CFO distant', department: 'Finance', primary_focus: 'ROI', mission: 'Évaluer le ROI', veto_power: true,
  metadata: { runtime: 'remote-ag-ui', remote_ag_ui: { url: 'https://agents.example.com/agui' } } };

test('SSE AG-UI : deltas concaténés, erreur distante remontée', () => {
  assert.equal(parseAgUiEvents(sse('{"verdict":', '"GO"}')).text, '{"verdict":"GO"}');
  assert.equal(parseAgUiEvents(`data: ${JSON.stringify({ type: 'RUN_ERROR', message: 'boom' })}\n\n`).error, 'boom');
});

test('URL distante : SSRF refusé (privé, localhost, port, schéma)', async () => {
  for (const url of ['http://127.0.0.1/x', 'http://localhost/x', 'https://a.example.com:8443/x', 'file:///etc/passwd', 'http://10.0.0.1/']) {
    assert.throws(() => remoteAgUiConfig({ metadata: { remote_ag_ui: { url } } }));
  }
  await assert.rejects(runRemoteAgUiAgent({ definition: def, question: 'Q', fetchImpl: async () => { throw new Error('ne doit pas appeler'); }, lookup: async () => [{ address: '192.168.1.2' }] }), /privée/);
});

test('sortie : règles effectives envoyées + rattachées, checkCompliance appliqué', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => { bodies.push(JSON.parse(init.body)); assert.equal(init.redirect, 'manual'); return new Response(sse('{"verdict":"NO_GO","primary_reason":"ROI non démontré"}'), { status: 200 }); };
  const out = await runRemoteAgUiAgent({ definition: def, question: 'Lancer X ?', fetchImpl, lookup, env: { KAYROS_HARNESS_MODE: 'enforce' } });
  assert.equal(out.provider, 'remote-ag-ui');
  assert.equal(out.compliance.compliant, true);
  assert.ok(Array.isArray(out.effective_rules));
  assert.ok(bodies[0].context.some((c) => c.description === 'kayros_effective_rules'));
});

test('enforce : 1 relance corrective puis HarnessComplianceError ; flag : notation seule', async () => {
  let calls = 0;
  const bad = async () => { calls += 1; return new Response(sse('En résumé, voici mon analyse : GO.'), { status: 200 }); };
  await assert.rejects(runRemoteAgUiAgent({ definition: def, question: 'Q', fetchImpl: bad, lookup, env: { KAYROS_HARNESS_MODE: 'enforce' } }), HarnessComplianceError);
  assert.equal(calls, 2);
  const flagged = await runRemoteAgUiAgent({ definition: def, question: 'Q', fetchImpl: bad, lookup, env: { KAYROS_HARNESS_MODE: 'flag' } });
  assert.equal(flagged.compliance.compliant, false);
});

test('swarm : agent remote-ag-ui dans un run, veto et arbitrage humain inchangés', async () => {
  const swarm = new SwarmService({});
  swarm.remoteAgUi = { fetchImpl: async () => new Response(sse('{"verdict":"NO_GO","primary_reason":"ROI non démontré"}'), { status: 200 }), lookup, env: { KAYROS_HARNESS_MODE: 'enforce' } };
  swarm.createAgent(def, { tenantId: 't', by: 'u' });
  const config = swarm.createConfiguration({ swarm_name: 'S', active_agents: ['remote_cfo', 'cto'], voting_threshold: 'majority' }, { tenantId: 't', by: 'u' });
  const run = await swarm.run(config.swarm_id, { tenantId: 't', question: 'Lancer X ?', by: 'u', agentResults: { cto: { verdict: 'GO', primary_reason: 'ok' } } });
  const remote = run.analyses.find((a) => a.agent_id === 'remote_cfo');
  assert.equal(remote.verdict, 'NO_GO');
  assert.equal(remote.llm_provider, 'remote-ag-ui');
  assert.equal(remote.harness_compliance.compliant, true);
  assert.equal(run.consensus.verdict, 'NO_GO');
  assert.equal(run.status, 'pending_human_arbitration');
});
