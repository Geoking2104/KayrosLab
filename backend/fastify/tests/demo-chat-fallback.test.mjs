import test from 'node:test';
import assert from 'node:assert/strict';
import { requestsSemanticMap, semanticMapFallback } from '../routes/llm.mjs';

test('the mock demo fallback satisfies the semantic-map contract', () => {
  const prompt = 'Return ONLY JSON with centralConcept, communities and bridges.';
  assert.equal(requestsSemanticMap(prompt), true);
  const map = JSON.parse(semanticMapFallback(prompt));
  assert.equal(map.communities.length, 4);
  assert.equal(map.bridges.length, 4);
  assert.ok(map.bridges.every((bridge) => bridge.connects.length === 2));
  assert.ok(map.bridges.every((bridge) => Number.isInteger(bridge.distance)));
});
