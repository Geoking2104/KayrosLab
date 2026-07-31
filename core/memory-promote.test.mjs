import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LayeredMemory } from './memory.mjs';

test('promoteL2ToL3 creates core and validates scenario', async () => {
  const mem = new LayeredMemory();
  const sc = await mem.distillScenario({
    title: 'No-Go écrit',
    content: 'Tout No-Go exige un motif écrit COMEX.',
    summary: 'Norme COMEX',
    ideaIds: ['idea-1'],
    patternType: 'process',
  });
  const { core, scenario } = await mem.promoteL2ToL3(sc.id, {
    scope: 'tenant',
    scopeId: 'acme',
    kind: 'norm',
  });
  assert.equal(scenario.reviewStatus, 'validated');
  assert.equal(core.scope, 'tenant');
  assert.equal(core.scopeId, 'acme');
  assert.equal(core.title, 'No-Go écrit');
  assert.ok(core.relatedL2Ids.includes(sc.id));
});

test('inspectIdea returns counts', async () => {
  const mem = new LayeredMemory();
  await mem.addAtomicFact({ ideaId: 'i1', content: 'Fait A', type: 'observation' });
  await mem.distillScenario({ title: 'S1', content: 'body', ideaIds: ['i1'] });
  mem.rememberL0({ ideaId: 'i1', step: 'ecouter', kind: 'agent_scratch', content: 'scratch' });
  const info = mem.inspectIdea('i1');
  assert.equal(info.counts.l1, 1);
  assert.equal(info.counts.l2, 1);
  assert.ok(info.counts.l0 >= 1);
});
