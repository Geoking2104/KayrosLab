import test from 'node:test';
import assert from 'node:assert/strict';
import { profileRunOptions, normalizeProfile, DemoProvider, DEFAULT_PROFILE } from './profiles.mjs';
import { normalizeAgentAnalysis } from '../swarm.mjs';

test('profils : fast par défaut, demo simulé, deep = configuration serveur', () => {
  assert.equal(DEFAULT_PROFILE, 'fast');
  assert.equal(normalizeProfile('inconnu'), 'fast');
  assert.deepEqual(
    [profileRunOptions('demo').provider, profileRunOptions('demo').simulated],
    ['demo', true],
  );
  const fast = profileRunOptions(undefined, { fastAvailable: true, fastModel: 'm/fast' });
  assert.equal(fast.provider, 'nvidia-fast');
  assert.equal(fast.model, 'm/fast');
  assert.equal(fast.effective_profile, 'fast');
  const fallback = profileRunOptions('fast', { fastAvailable: false });
  assert.equal(fallback.effective_profile, 'deep');
  assert.equal(fallback.provider, undefined);
  assert.ok(fallback.note);
  assert.equal(profileRunOptions('deep', { deepProvider: 'nvidia', deepModel: 'moonshotai/kimi-k3' }).eta_seconds, 720);
});

test('DemoProvider : JSON par rôle, étiqueté [Démo], parsable par le swarm', async () => {
  const provider = new DemoProvider({ delayMs: 0 });
  const res = await provider.complete({ messages: [{ role: 'system', content: 'You are Chief Financial Officer, Finance (executive).' }, { role: 'user', content: 'x' }] });
  assert.equal(res.provider, 'demo');
  const analysis = normalizeAgentAnalysis({ output: res.text, provider: res.provider }, { agent_id: 'cfo' });
  assert.equal(analysis.verdict, 'CONDITIONAL_GO');
  assert.match(analysis.primary_reason, /^\[Démo\]/);
  assert.ok(analysis.critical_risks.length > 0);
  assert.deepEqual(analysis.unverified_assumptions, []);
});
