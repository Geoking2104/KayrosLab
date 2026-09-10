import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const root = fileURLToPath(new URL('..', import.meta.url));

test('le vhost www sert le site statique et laisse passer ACME', async () => {
  const [vhost, locations, deployWww, deployBackend, vps] = await Promise.all([
    read('deploy/ovh-vps/nginx-kayroslab-www.conf'),
    read('deploy/ovh-vps/nginx-kayroslab-www-locations.conf'),
    read('deploy/ovh-vps/deploy-www.sh'),
    read('deploy/ovh-vps/deploy-backend.sh'),
    read('.github/workflows/deploy-vps-backend.yml'),
  ]);
  assert.match(vhost, /server_name www\.kayroslab\.com kayroslab\.com/);
  assert.match(vhost, /location \/\.well-known\/acme-challenge\//);
  assert.match(vhost, /include snippets\/kayroslab-www-locations\.conf/);
  assert.match(locations, /root \/var\/www\/kayroslab/);
  assert.match(locations, /location \/salon\/ \{/);
  assert.match(locations, /try_files \$uri \$uri\/ \/salon\/index\.html/);
  assert.match(locations, /location \/console\/ \{/);
  assert.match(locations, /try_files \$uri \$uri\/ \/console\/index\.html/);
  assert.match(locations, /application\/wasm wasm/);
  assert.match(deployWww, /assemble-www\.sh/);
  assert.match(deployWww, /sites-available\/www\.kayroslab\.com/);
  assert.match(deployBackend, /deploy-www\.sh/);
  assert.match(vps, /backend\/web\/public\/salon\/\*\*/);
  assert.match(vps, /index\.fr\.html/);
});

test('assemble-www copie accueil, salon et console', async () => {
  const dest = await mkdtemp(join(tmpdir(), 'kayros-www-'));
  try {
    const result = spawnSync(
      'bash',
      ['deploy/ovh-vps/assemble-www.sh'],
      {
        cwd: root,
        env: { ...process.env, APP_DIR: root, WWW_ROOT: dest },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const [home, salon, consoleIndex] = await Promise.all([
      readFile(join(dest, 'index.fr.html'), 'utf8'),
      readFile(join(dest, 'salon/index.html'), 'utf8'),
      readFile(join(dest, 'console/index.html'), 'utf8'),
    ]);
    assert.match(home, /href="\/salon\/">Salon</);
    assert.match(salon, /Un cercle est une table/);
    assert.match(consoleIndex, /<div id="root">/);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test('le workflow SSL www demande le certificat puis reapplique le vhost', async () => {
  const ssl = await read('.github/workflows/setup-ssl-www.yml');
  assert.match(ssl, /www\.kayroslab\.com/);
  assert.match(ssl, /-d kayroslab\.com/);
  assert.match(ssl, /certbot --nginx/);
  assert.match(ssl, /deploy-www\.sh/);
});
