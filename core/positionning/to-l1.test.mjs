import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factsFromPositionning, heuristicPositionning } from './to-l1.mjs';
import { LayeredMemory } from '../memory.mjs';

test('factsFromPositionning emits competitor + gap + metric', () => {
  const analysis = {
    kayrosIndex: 62,
    competitors: [
      { name: 'Acme IoT', url: 'https://acme.example', avgScore: 71, source: 'web', snippet: 'predictive maintenance' },
    ],
    gaps: [
      { entityId: 'ai', entityName: 'IA embarquée', diff: -12, type: 'disadvantage' },
    ],
  };
  const facts = factsFromPositionning(analysis, { ideaId: 'i1', tenantId: 't1' });
  assert.ok(facts.some((f) => f.type === 'metric'));
  assert.ok(facts.some((f) => f.type === 'competitor' && f.content.includes('Acme')));
  assert.ok(facts.some((f) => f.type === 'risk'));
  assert.ok(facts.every((f) => f.ideaId === 'i1'));
});

test('heuristic + layered addAtomicFact', async () => {
  const mem = new LayeredMemory();
  const analysis = heuristicPositionning('Lancer une offre B2B IoT');
  const payloads = factsFromPositionning(analysis, { ideaId: 'idea-x' });
  for (const p of payloads) await mem.addAtomicFact(p);
  const list = mem.getAtomicFacts({ ideaId: 'idea-x' });
  assert.ok(list.length >= 2);
  assert.ok(list.some((f) => f.tags?.includes('positionning')));
});
