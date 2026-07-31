import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIdea } from './model.mjs';
import { applyCycleEvent, stageForAgent, reactivate } from './cycle-lifecycle.mjs';

test('stageForAgent maps known agents', () => {
  assert.equal(stageForAgent('Critic'), 'eprouver');
  assert.equal(stageForAgent('Synthesizer'), 'arbitrer');
  assert.equal(stageForAgent('Unknown'), null);
});

test('start moves nouveau/recueillir → en_revue/ecouter', () => {
  const idea = createIdea({ id: 'i1', title: 'T' });
  const { idea: out, changed } = applyCycleEvent(idea, { type: 'start' });
  assert.equal(changed, true);
  assert.equal(out.status, 'en_revue');
  assert.equal(out.stage, 'ecouter');
});

test('trace advances stage by agent', () => {
  let idea = createIdea({ id: 'i1', title: 'T', stage: 'ecouter', status: 'en_revue' });
  ({ idea } = applyCycleEvent(idea, { type: 'trace', agent: 'Critic' }));
  assert.equal(idea.stage, 'eprouver');
  ({ idea } = applyCycleEvent(idea, { type: 'trace', agent: 'Synthesizer' }));
  assert.equal(idea.stage, 'arbitrer');
});

test('final auto → en_developpement + projeter', () => {
  const idea = createIdea({ id: 'i1', title: 'T', stage: 'arbitrer', status: 'en_revue' });
  const { idea: out } = applyCycleEvent(idea, { type: 'final', status: 'auto' });
  assert.equal(out.status, 'en_developpement');
  assert.equal(out.stage, 'projeter');
});

test('reactivate dormant idea', () => {
  let idea = createIdea({ id: 'i1', title: 'T', status: 'en_pause', stage: 'eprouver' });
  idea = reactivate(idea, { by: 'test', stage: 'ecouter' });
  assert.equal(idea.status, 'en_revue');
  assert.equal(idea.stage, 'ecouter');
});
