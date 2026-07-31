// E + F tests — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lexicalScore, rankCores, l3BelongsToTenant } from './memory-rank.mjs';
import { LayeredMemory, FileLayeredStore } from './memory.mjs';

test('E. lexicalScore prefers matching tokens', () => {
  const high = lexicalScore('no-go motif écrit COMEX', {
    title: 'COMEX', content: 'Tout No-Go exige un motif écrit.',
  });
  const low = lexicalScore('no-go motif écrit COMEX', {
    title: 'Couleur', content: 'Palette pastel pour le site.',
  });
  assert.ok(high > low);
});

test('E. rankCores orders by relevance', () => {
  const cores = [
    { id: '1', title: 'Palette', content: 'couleurs pastel' },
    { id: '2', title: 'COMEX', content: 'No-Go exige un motif' },
    { id: '3', title: 'Budget', content: 'plafond 50k' },
  ];
  const ranked = rankCores(cores, 'COMEX No-Go motif', { k: 2 });
  assert.equal(ranked[0].id, '2');
  assert.ok(ranked[0].score >= ranked[1].score);
});

test('E. recall ranks L3 by query', async () => {
  const mem = new LayeredMemory();
  await mem.updateCore({ scope: 'tenant', scopeId: 'acme', kind: 'norm', title: 'Palette', content: 'couleurs' });
  await mem.updateCore({ scope: 'tenant', scopeId: 'acme', kind: 'norm', title: 'COMEX', content: 'No-Go motif écrit obligatoire' });
  const r = await mem.recall('COMEX décision No-Go motif', {
    layers: ['L3'], k: 1, tenantId: 'acme',
  });
  assert.equal(r.l3.length, 1);
  assert.equal(r.l3[0].title, 'COMEX');
  assert.ok(typeof r.l3[0].score === 'number');
});

test('F. snapshot filters L3 by tenantId', async () => {
  const mem = new LayeredMemory();
  await mem.updateCore({ scope: 'tenant', scopeId: 'acme', kind: 'norm', title: 'A', content: 'a' });
  await mem.updateCore({ scope: 'tenant', scopeId: 'other', kind: 'norm', title: 'B', content: 'b' });
  const all = mem.snapshot();
  assert.equal(all.l3.length, 2);
  const acme = mem.snapshot(null, { tenantId: 'acme' });
  assert.equal(acme.l3.length, 1);
  assert.equal(acme.l3[0].title, 'A');
});

test('F. FileLayeredStore path per tenant', async () => {
  const files = new Map();
  const fs = {
    async writeFile(p, data) { files.set(p, data); },
    async readFile(p) {
      if (!files.has(p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return files.get(p);
    },
    async rename(a, b) { files.set(b, files.get(a)); files.delete(a); },
  };
  const store = new FileLayeredStore({ path: './.kayros-memory.json', fs, partitionByTenant: true });
  await store.save({ l1: [], l2: [], l3: [{ id: '1', scope: 'tenant', scopeId: 'acme', title: 'X', content: 'y' }] }, { tenantId: 'acme' });
  assert.ok([...files.keys()].some((k) => String(k).includes('acme')));
  const loaded = await store.load({ tenantId: 'acme' });
  assert.equal(loaded.l3[0].title, 'X');
});

test('l3BelongsToTenant', () => {
  assert.equal(l3BelongsToTenant({ scope: 'tenant', scopeId: 'acme' }, 'acme'), true);
  assert.equal(l3BelongsToTenant({ scope: 'tenant', scopeId: 'other' }, 'acme'), false);
});
