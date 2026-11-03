import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { parse } from 'yaml';

const root = new URL('../../../', import.meta.url);

test('docker-compose : fastify + postgres + console, harnais enforce, personas monté, aucun secret en clair', async () => {
  const text = await readFile(new URL('docker-compose.yml', root), 'utf8');
  const doc = parse(text);
  assert.deepEqual(Object.keys(doc.services).sort(), ['console', 'fastify', 'postgres']);
  const api = doc.services.fastify;
  assert.equal(api.environment.KAYROS_HARNESS_MODE, 'enforce');
  assert.equal(api.environment.KAYROS_PERSONAS_DIR, '/app/personas');
  assert.ok(api.volumes.includes('./personas:/app/personas:ro'));
  assert.match(api.environment.KAYROS_AUTH_SECRET, /^\$\{KAYROS_AUTH_SECRET:\?/);
  assert.match(doc.services.postgres.environment.POSTGRES_PASSWORD, /^\$\{POSTGRES_PASSWORD:\?/);
  assert.equal(api.ports, undefined, 'API non exposée directement : passe par la console (nginx)');
  for (const f of ['deploy/docker/fastify.Dockerfile', 'deploy/docker/console.Dockerfile', 'deploy/docker/nginx.conf']) await access(new URL(f, root));
  const dockerfile = await readFile(new URL('deploy/docker/fastify.Dockerfile', root), 'utf8');
  for (const m of dockerfile.matchAll(/^COPY (\S+)\/ /gm)) await access(new URL(`${m[1]}/`, root));
});
