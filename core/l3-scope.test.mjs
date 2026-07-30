// L3 scope A–D — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMemoryScope } from './memory-scope.mjs';
import { LayeredMemory } from './memory.mjs';
import { createEngine, collect } from './index.mjs';

test('B. tenantId alone normalizes to tenant scope', () => {
  const r = resolveMemoryScope({ tenantId: 'acme' });
  assert.deepEqual(r.scopes, [{ scope: 'tenant', scopeId: 'acme' }]);
  assert.equal(r.tenantId, 'acme');
});

test('A. engine defaults merge under call opts', () => {
  const r = resolveMemoryScope(
    { userId: 'u1' },
    { tenantId: 'acme', defaultScope: 'tenant' },
  );
  assert.ok(r.scopes.some((s) => s.scope === 'user' && s.scopeId === 'u1'));
  assert.ok(r.scopes.some((s) => s.scope === 'tenant' && s.scopeId === 'acme'));
});

test('D. hierarchy user → team → org → tenant', () => {
  const r = resolveMemoryScope({
    userId: 'u', teamId: 't', organizationId: 'o', tenantId: 'ten',
  });
  assert.deepEqual(r.scopes.map((s) => s.scope), ['user', 'team', 'organization', 'tenant']);
});

test('empty scope chain when nothing provided', () => {
  const r = resolveMemoryScope({});
  assert.equal(r.scopes.length, 0);
});

test('explicit scopes array wins', () => {
  const r = resolveMemoryScope({
    tenantId: 'ignored',
    scopes: [{ scope: 'team', scopeId: 'only' }],
  });
  assert.deepEqual(r.scopes, [{ scope: 'team', scopeId: 'only' }]);
});

test('recall L3 hierarchy + dedupe', async () => {
  const mem = new LayeredMemory();
  mem.updateCore({ scope: 'tenant', scopeId: 'acme', kind: 'norm', title: 'N-tenant', content: 'tenant rule' });
  mem.updateCore({ scope: 'user', scopeId: 'u1', kind: 'preference', title: 'N-user', content: 'user pref' });
  mem.updateCore({ scope: 'tenant', scopeId: 'other', kind: 'norm', title: 'N-other', content: 'leak' });

  const open = await mem.recall('x', { layers: ['L3'], k: 10 });
  assert.equal(open.l3.length, 0);

  const chained = await mem.recall('x', {
    layers: ['L3'], k: 10,
    userId: 'u1', tenantId: 'acme',
  });
  assert.equal(chained.l3.length, 2);
  assert.ok(chained.l3.some((c) => c.title === 'N-user'));
  assert.ok(chained.l3.some((c) => c.title === 'N-tenant'));
  assert.ok(!chained.l3.some((c) => c.title === 'N-other'));
});

test('A. createEngine tenantId injects L3 on run', async () => {
  const eng = createEngine({ tenantId: 'acme' });
  eng.layered.updateCore({
    scope: 'tenant', scopeId: 'acme', kind: 'norm',
    title: 'COMEX', content: 'Tout No-Go exige un motif.',
  });
  const plan = await eng.orchestrator.plan('Test L3', { ideaId: 'i1', llmPlan: false });
  const events = await collect(eng.orchestrator.run(plan, { governance: 'auto' }));
  const recall = events.find((e) => e.type === 'recall');
  assert.ok(recall, 'expected recall event');
  assert.ok(recall.preview.includes('COMEX') || recall.preview.includes('No-Go'), 'L3 should appear in context');
});
