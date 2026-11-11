import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { serverOptions, rateLimitOptions, TRUSTED_PROXIES } from '../lib/http-hardening.mjs';

async function buildApp(max = 2) {
  const app = Fastify(serverOptions({ logger: false }));
  await app.register(rateLimit, { ...rateLimitOptions, max });
  app.get('/ip', async (req) => ({ ip: req.ip }));
  await app.ready();
  return app;
}

test('trustProxy limité au loopback, jamais `true`', () => {
  assert.equal(TRUSTED_PROXIES, 'loopback');
  assert.notEqual(serverOptions().trustProxy, true);
});

test('index.mjs utilise les réglages partagés', () => {
  const src = readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');
  assert.match(src, /Fastify\(serverOptions\(\)\)/);
  assert.match(src, /register\(rateLimit, rateLimitOptions\)/);
});

test('derrière nginx local, req.ip = client transmis par X-Forwarded-For', async () => {
  const app = await buildApp();
  const res = await app.inject({ url: '/ip', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.7' } });
  assert.equal(res.json().ip, '203.0.113.7');
  const chained = await app.inject({ url: '/ip', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.8' } });
  assert.equal(chained.json().ip, '203.0.113.8', "seule l'entrée ajoutée par nginx compte");
  await app.close();
});

test("un client direct ne peut pas usurper une IP via X-Forwarded-For", async () => {
  const app = await buildApp();
  const res = await app.inject({ url: '/ip', remoteAddress: '198.51.100.9', headers: { 'x-forwarded-for': '203.0.113.7' } });
  assert.equal(res.json().ip, '198.51.100.9');
  await app.close();
});

test('la limite de débit compte par client, pas globalement', async () => {
  const app = await buildApp(2);
  const hit = (ip) => app.inject({ url: '/ip', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': ip } });
  assert.equal((await hit('203.0.113.1')).statusCode, 200);
  assert.equal((await hit('203.0.113.1')).statusCode, 200);
  assert.equal((await hit('203.0.113.1')).statusCode, 429);
  assert.equal((await hit('203.0.113.2')).statusCode, 200, 'un autre client garde son quota');
  await app.close();
});
