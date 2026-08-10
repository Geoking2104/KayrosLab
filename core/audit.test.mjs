import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FileAuditStore, InMemoryAuditStore, createAuditStore } from './audit.mjs';

describe('audit store / InMemoryAuditStore', () => {
  it('append, list, where with idea/type/since filters (recent first)', async () => {
    const store = new InMemoryAuditStore({ ring: 100 });
    await store.append({ type: 'etape', ideaId: 'i1', by: 'a@x', ts: '2026-01-01T00:00:01.000Z' });
    await store.append({ type: 'vote', ideaId: 'i1', by: 'b@x', ts: '2026-01-01T00:00:02.000Z' });
    await store.append({ type: 'vote', ideaId: 'i2', by: 'c@x', ts: '2026-01-01T00:00:03.000Z' });
    assert.equal((await store.list()).length, 3);
    const i1 = await store.where({ ideaId: 'i1' });
    assert.equal(i1.length, 2);
    assert.equal(i1[0].ts, '2026-01-01T00:00:02.000Z');
    assert.equal((await store.where({ type: 'vote' })).length, 2);
    assert.equal((await store.where({ since: '2026-01-01T00:00:01.500Z' })).length, 2);
    assert.equal((await store.where({ before: '2026-01-01T00:00:02.500Z' })).length, 2);
  });

  it('ring caps size and drops oldest entries', async () => {
    const store = new InMemoryAuditStore({ ring: 3 });
    for (let i = 0; i < 5; i++) await store.append({ type: 't', ts: `2026-01-01T00:00:0${i}.000Z` });
    assert.equal(store.events.length, 3);
    assert.equal(store.events[0].ts, '2026-01-01T00:00:02.000Z');
  });

  it('createAuditStore picks file vs memory', () => {
    assert.ok(createAuditStore({ file: '/tmp/x.ndjson' }) instanceof FileAuditStore);
    assert.ok(createAuditStore() instanceof InMemoryAuditStore);
  });
});

describe('audit store / FileAuditStore (JSONL persistence)', () => {
  function makeFs() {
    const m = new Map();
    return {
      _map: m,
      async readFile(p, enc) { return m.has(p) ? (enc === 'utf8' ? m.get(p) : Buffer.from(m.get(p))) : null; },
      async appendFile(p, data) { m.set(p, (m.get(p) ?? '') + String(data)); },
    };
  }
  let fs, store, path;
  beforeEach(() => { fs = makeFs(); path = '/tmp/__audit_test.ndjson'; store = new FileAuditStore({ path, fs }); });

  it('writes and reloads across instances', async () => {
    await store.append({ type: 'etape', ideaId: 'i1', by: 'a@x', ts: '2026-01-01T00:00:01.000Z' });
    await store.append({ type: 'vote', ideaId: 'i1', ts: '2026-01-01T00:00:02.000Z' });
    const reloaded = new FileAuditStore({ path, fs });
    await reloaded.load();
    assert.equal(reloaded.events.length, 2);
    assert.equal(reloaded.events[0].type, 'etape');
    assert.equal(reloaded.events[1].ts, '2026-01-01T00:00:02.000Z');
  });

  it('load handles missing file gracefully', async () => {
    const fresh = new FileAuditStore({ path: '/tmp/does-not-exist.ndjson', fs });
    await fresh.load();
    assert.equal(fresh.events.length, 0);
  });

  it('append is resilient when underlying fs fails (best-effort)', async () => {
    const bad = new FileAuditStore({ path: '/tmp/x.ndjson', fs: { readFile: async () => { throw new Error('disk'); }, appendFile: async () => { throw new Error('disk'); } } });
    await bad.append({ type: 't', ts: '2026-01-01T00:00:00.000Z' });
    assert.equal(bad.events.length, 1);
  });

  it('load respects ring size on large logs (keeps newest N)', async () => {
    const big = new FileAuditStore({ path, fs });
    big.ring = 2;
    for (let i = 0; i < 4; i++) await big.append({ type: 't', ts: `2026-01-01T00:00:0${i}.000Z` });
    const reloaded = new FileAuditStore({ path, fs });
    reloaded.ring = 2;
    await reloaded.load();
    assert.equal(reloaded.events.length, 2);
    assert.equal(reloaded.events[0].ts, '2026-01-01T00:00:02.000Z');
  });
});
