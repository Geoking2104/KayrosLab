import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import llmRoute from '../routes/llm.mjs';

async function fixture() {
  const calls = [];
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { global: false });
  app.decorate('kayrosContext', {
    embeddings: {
      model: 'bge-m3',
      async embedBatch(texts) {
        calls.push(texts);
        return texts.map(() => [0.1, 0.2, 0.3]);
      },
    },
  });
  app.decorate('requireAuth', async (req, reply) => {
    if (req.headers.authorization !== 'Bearer valid') {
      reply.code(401).send({ error: 'jeton requis' });
      return null;
    }
    return { sub: 'u1', tenantId: 't1' };
  });
  await app.register(llmRoute);
  return { app, calls };
}

test('/v1/embed exige une session authentifiee', async (t) => {
  const { app, calls } = await fixture();
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/v1/embed', payload: { input: 'bonheur' } });
  assert.equal(response.statusCode, 401);
  assert.equal(calls.length, 0);
});

test('/v1/embed conserve le modele configure par le serveur', async (t) => {
  const { app, calls } = await fixture();
  t.after(() => app.close());
  const headers = { authorization: 'Bearer valid' };
  const changed = await app.inject({ method: 'POST', url: '/v1/embed', headers, payload: { input: 'bonheur', model: 'autre-modele' } });
  assert.equal(changed.statusCode, 400);
  assert.equal(calls.length, 0);

  const response = await app.inject({ method: 'POST', url: '/v1/embed', headers, payload: { input: 'bonheur' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().model, 'bge-m3');
  assert.deepEqual(calls, [['bonheur']]);
});

test('/v1/embed limite les appels par session/IP', async (t) => {
  const { app } = await fixture();
  t.after(() => app.close());
  const request = { method: 'POST', url: '/v1/embed', headers: { authorization: 'Bearer valid' }, payload: { input: 'bonheur' } };
  for (let i = 0; i < 20; i += 1) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 200);
  }
  const limited = await app.inject(request);
  assert.equal(limited.statusCode, 429);
});
