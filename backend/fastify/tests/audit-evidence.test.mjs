// Journal d'audit scellé câblé au backend (pilote Proof-of-Control).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTestApp } from './test-helpers.mjs';
import { buildAuditEvidence } from '../lib/audit-evidence.mjs';
import { generateEvidenceKeys, verifyEvidenceChain, verifyAnchorManifest, verifyEvidenceDir } from '../../../core/index.mjs';

const quiet = { warn() {} };

test('sans clé : journal scellé désactivé, health le signale', async () => {
  const { app } = await buildTestApp();
  const health = (await app.inject({ method: 'GET', url: '/health' })).json();
  assert.deepEqual(health.auditEvidence, { enabled: false });
  assert.deepEqual((await app.inject({ method: 'GET', url: '/v1/audit/evidence' })).json(), { enabled: false });
  await app.close();
});

test('clé invalide : démarrage maintenu, signature désactivée', () => {
  const ae = buildAuditEvidence({ KAYROS_AUDIT_SIGNING_KEY: 'pas-une-cle' }, { logger: quiet });
  assert.equal(ae.enabled, false);
  assert.match(ae.error, /clé/);
});

test('clé base64 + fichier : même kid', () => {
  const keys = generateEvidenceKeys();
  const a = buildAuditEvidence({ KAYROS_AUDIT_SIGNING_KEY: Buffer.from(keys.privateKey).toString('base64'), KAYROS_AUDIT_DIR: mkdtempSync(join(tmpdir(), 'ae-')) });
  const b = buildAuditEvidence({ KAYROS_AUDIT_SIGNING_KEY: keys.privateKey.replace(/\n/g, '\\n'), KAYROS_AUDIT_DIR: mkdtempSync(join(tmpdir(), 'ae-')) });
  assert.equal(a.kid, keys.kid);
  assert.equal(b.kid, keys.kid);
});

test('clé fournie : événements scellés, ancrage protégé et vérifiable', async () => {
  const keys = generateEvidenceKeys();
  const dir = mkdtempSync(join(tmpdir(), 'ae-log-'));
  const anchorDir = mkdtempSync(join(tmpdir(), 'ae-anchor-'));
  const { app } = await buildTestApp({
    KAYROS_AUDIT_SIGNING_KEY: keys.privateKey, KAYROS_AUDIT_DIR: dir,
    KAYROS_AUDIT_ANCHOR_DIR: anchorDir, KAYROS_AUDIT_ANCHOR_INTERVAL_MS: '0',
    KAYROS_SECRET: 's3cret',
  });
  const ctx = app.kayrosContext;
  assert.equal(ctx.auditEvidence.enabled, true);
  const health = (await app.inject({ method: 'GET', url: '/health' })).json();
  assert.deepEqual(health.auditEvidence, { enabled: true, kid: keys.kid, anchoring: ['file'] });

  // L'essaim et la passerelle reçoivent la fonction d'audit scellée.
  const audit = ctx.auditEvidence.sink.asAuditFunction();
  await audit({ type: 'tool.call', runId: 'run-1', tool: 'search' });
  await audit({ type: 'gateway.decision', decision: 'allow' });
  await ctx.auditEvidence.sink.flush();

  const info = (await app.inject({ method: 'GET', url: '/v1/audit/evidence' })).json();
  assert.equal(info.kid, keys.kid);
  assert.equal(info.heads.length, 2);
  const pub = await app.inject({ method: 'GET', url: '/v1/audit/evidence/public-key' });
  assert.equal(pub.body.trim(), keys.publicKey.trim());

  assert.equal((await app.inject({ method: 'POST', url: '/v1/audit/evidence/anchor', payload: {} })).statusCode, 401);
  const anchored = (await app.inject({ method: 'POST', url: '/v1/audit/evidence/anchor', headers: { 'x-kayros-secret': 's3cret' }, payload: { note: 'test' } })).json();
  assert.equal(anchored.skipped, false);
  assert.equal(anchored.entries.length, 2);
  const again = (await app.inject({ method: 'POST', url: '/v1/audit/evidence/anchor', headers: { 'x-kayros-secret': 's3cret' }, payload: {} })).json();
  assert.equal(again.skipped, true);

  const manifestFile = readdirSync(anchorDir).find((n) => n.startsWith('anchor-'));
  const manifest = JSON.parse(readFileSync(join(anchorDir, manifestFile), 'utf8'));
  const checked = verifyAnchorManifest(manifest, { publicKeys: keys.publicKey });
  assert.equal(checked.ok, true);
  const all = await verifyEvidenceDir(dir, { publicKeys: keys.publicKey, anchors: checked.entries });
  assert.equal(all.ok, true, JSON.stringify(all));
  assert.equal(verifyEvidenceChain(readFileSync(join(dir, 'run-1.jsonl'), 'utf8'), { publicKeys: keys.publicKey }).ok, true);
  await app.close();
});

test('redémarrage : la chaîne reprend sans rupture dans le même fichier', async () => {
  const keys = generateEvidenceKeys();
  const dir = mkdtempSync(join(tmpdir(), 'ae-restart-'));
  const env = { KAYROS_AUDIT_SIGNING_KEY: keys.privateKey, KAYROS_AUDIT_DIR: dir };
  const first = buildAuditEvidence(env);
  await first.sink.asAuditFunction()({ type: 'a', runId: 'r' });
  await first.sink.flush();
  const second = buildAuditEvidence(env);
  await second.sink.asAuditFunction()({ type: 'b', runId: 'r' });
  await second.sink.flush();
  const res = verifyEvidenceChain(readFileSync(join(dir, 'r.jsonl'), 'utf8'), { publicKeys: keys.publicKey });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.count, 2);
});
