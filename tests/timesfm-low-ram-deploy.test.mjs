import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('../deploy/ovh-vps/deploy-timesfm.sh', import.meta.url).pathname;

function run(availableKb, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'timesfm-'));
  try {
    mkdirSync(join(dir, 'backend/fastify'), { recursive: true });
    writeFileSync(join(dir, 'backend/fastify/.env'), 'KAYROS_TIMESFM_ENABLED=true\n');
    const bin = join(dir, 'bin'); mkdirSync(bin);
    // docker factice : « compose version » OK, tout build/up est journalisé et échoue.
    writeFileSync(join(bin, 'docker'), '#!/usr/bin/env bash\nif [[ "$1 $2" == "compose version" ]]; then exit 0; fi\necho "DOCKER_CALLED $*" >&2; exit 42\n');
    chmodSync(join(bin, 'docker'), 0o755);
    writeFileSync(join(dir, 'meminfo'), `MemTotal: 8000000 kB\nMemAvailable: ${availableKb} kB\n`);
    return spawnSync('bash', [script], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, APP_DIR: dir, MEMINFO_FILE: join(dir, 'meminfo'), ...extraEnv },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('RAM insuffisante : avertissement, diagnostic, et le déploiement continue (exit 0)', () => {
  const r = run(1048576);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /WARNING: TimesFM needs at least 3 GiB/);
  assert.match(r.stderr, /available: 1024 MiB/);
  assert.match(r.stderr, /diagnostic mémoire/);
  assert.doesNotMatch(r.stderr, /DOCKER_CALLED .*build/, 'pas de rebuild TimesFM');
});

test('RAM insuffisante + KAYROS_TIMESFM_STRICT=1 : échec explicite', () => {
  const r = run(1048576, { KAYROS_TIMESFM_STRICT: '1' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /WARNING: TimesFM needs at least 3 GiB/);
});

test('RAM suffisante : le build TimesFM est tenté normalement', () => {
  const r = run(4194304);
  assert.match(r.stderr, /DOCKER_CALLED compose .*build --pull timesfm/);
  assert.notEqual(r.status, 0); // docker factice échoue → comportement strict inchangé hors RAM
});
