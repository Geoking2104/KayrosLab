import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp } from './test-helpers.mjs';

describe('backend /health', () => {
  let app;
  beforeEach(async () => { const built = await buildTestApp(); app = built.app; });
  afterEach(async () => { if (app) await app.close(); });

  it('returns ok + providers without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    const j = res.json();
    assert.equal(j.ok, true);
    assert.ok(Array.isArray(j.providers));
    assert.equal(app.kayrosContext.providers.mock != null || app.kayrosContext.providers.length >= 1, true);
  });
});
