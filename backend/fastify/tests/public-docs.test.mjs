// Documentation de l'API publique : la spécification OpenAPI se charge, colle
// aux routes réellement servies et au schéma zod de création de mission.
import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import publicDocsRoutes, { loadOpenApiSpec, docsHtml } from '../routes/public-docs.mjs';
import { missionCreateSchema } from '../routes/public-api.mjs';
import { buildTestApp } from './test-helpers.mjs';

test('la spécification OpenAPI 3.1 se charge et décrit les 5 opérations publiques', async () => {
  const spec = await loadOpenApiSpec();
  assert.equal(spec.openapi, '3.1.0');
  assert.equal(spec.servers[0].url, 'https://api.kayroslab.com');
  const operations = Object.entries(spec.paths).flatMap(([path, item]) => Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`));
  assert.deepEqual(operations.sort(), [
    'GET /v1/public/collectives', 'GET /v1/public/me', 'GET /v1/public/missions',
    'GET /v1/public/missions/{mission_id}', 'POST /v1/public/missions',
  ]);
  // Chaque $ref interne pointe vers un schéma existant.
  const refs = [...JSON.stringify(spec).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1]);
  for (const name of refs) assert.ok(spec.components.schemas[name], `schéma ${name}`);
  assert.equal((await loadOpenApiSpec({ baseUrl: 'https://recette.example.com/' })).servers[0].url, 'https://recette.example.com');
});

test('MissionCreate colle au schéma zod de la route (mêmes champs, mêmes requis)', async () => {
  const spec = await loadOpenApiSpec();
  const documented = spec.components.schemas.MissionCreate;
  const shape = missionCreateSchema.shape;
  assert.deepEqual(Object.keys(documented.properties).sort(), Object.keys(shape).sort());
  const required = Object.entries(shape).filter(([, schema]) => !schema.isOptional()).map(([key]) => key).sort();
  assert.deepEqual([...documented.required].sort(), required);
  assert.deepEqual(spec.components.schemas.Profile.enum, ['demo', 'fast', 'deep']);
});

test('chaque chemin documenté est une route servie par l’application', async () => {
  const { app } = await buildTestApp();
  const spec = await loadOpenApiSpec();
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of Object.keys(item)) {
      const url = path.replace('{mission_id}', 'msn_inexistant');
      const res = await app.inject({ method: method.toUpperCase(), url, payload: method === 'post' ? {} : undefined });
      assert.equal(res.statusCode, 401, `${method} ${path} protégé par clé (et non 404)`);
    }
  }
  await app.close();
});

test('GET /v1/public/openapi.json et GET /docs sont publics', async () => {
  const app = Fastify();
  app.decorate('kayrosContext', { publicApiUrl: 'https://api.example.test' });
  await app.register(publicDocsRoutes);
  const spec = await app.inject({ method: 'GET', url: '/v1/public/openapi.json' });
  assert.equal(spec.statusCode, 200);
  assert.equal(spec.json().servers[0].url, 'https://api.example.test');
  const docs = await app.inject({ method: 'GET', url: '/docs' });
  assert.equal(docs.statusCode, 200);
  assert.match(docs.headers['content-type'], /text\/html/);
  assert.match(docs.body, /\/v1\/public\/openapi\.json/);
  assert.match(docs.body, /api\.example\.test\/v1\/public\/missions/);
  assert.match(docs.body, /@scalar\/api-reference@\d+\.\d+\.\d+/, 'version CDN épinglée');
  assert.doesNotMatch(docsHtml({ baseUrl: 'https://x.test/"><script>' }), /"><script>/);
  await app.close();
});
