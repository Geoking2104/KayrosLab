import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPersonaOverview } from './persona-overview.mjs';

const agent = { agent_id: 'imp_alex', display_name: 'Alex', veto_power: true, tools: [], metadata: { skills: [{ id: 'roi', name: 'ROI' }] },
  impersonator: { source: 'public', public_sources: ['https://example.com/a'], public_evidence: [{ url: 'https://example.com/a', status: 200, title: 'A', excerpt: 'E', fetched_at: '2026-11-03T10:00:00Z' }] } };
const runs = [
  { run_id: 'r1', question: 'Q1', created_at: '2026-11-01T10:00:00Z', status: 'overridden_human', consensus: { verdict: 'NO_GO' },
    analyses: [{ agent_id: 'imp_alex', verdict: 'NO_GO', veto_power: true, primary_reason: 'ROI absent' }],
    human_decision: { action: 'override_veto', verdict: 'GO', by: 'ceo@x', justification: 'pari stratégique', decided_at: '2026-11-01T12:00:00Z' } },
  { run_id: 'r2', question: 'Q2', created_at: '2026-11-02T10:00:00Z', status: 'pending_human_arbitration', consensus: { verdict: 'GO' },
    analyses: [{ agent_id: 'imp_alex', verdict: 'GO', veto_power: true, primary_reason: 'OK' }], human_decision: null },
  { run_id: 'r3', question: 'autre', created_at: '2026-11-03T10:00:00Z', analyses: [{ agent_id: 'cfo', verdict: 'NO_GO' }] },
];

test('vue persona : activité, vetos, décisions, mémoire — lecture seule', () => {
  const before = JSON.stringify(runs);
  const o = buildPersonaOverview(agent, runs);
  assert.equal(o.read_only, true);
  assert.deepEqual(o.activity.map((a) => a.run_id), ['r2', 'r1']);
  assert.equal(o.vetoes.length, 1);
  assert.equal(o.vetoes[0].reason, 'ROI absent');
  assert.equal(o.decisionsTimeline[0].decision, 'OVERRIDE');
  assert.equal(o.decisionsTimeline[0].by, 'ceo@x');
  assert.equal(o.memory.public_evidence[0].title, 'A');
  assert.deepEqual(o.memory.recent_reasons, ['OK', 'ROI absent']);
  assert.equal(o.persona.consent_confirmed, true);
  assert.equal(JSON.stringify(runs), before);
  assert.throws(() => buildPersonaOverview(null), /introuvable/);
});
