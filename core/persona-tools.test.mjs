import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from './tool-registry.mjs';
import { personaToolPolicy, validatePersonaTools } from './persona-tools.mjs';

const registry = new ToolRegistry();
registry.register({ name: 'estimate_resources', description: 'r', sideEffect: 'read', handler: async () => ({}) });
registry.register({ name: 'send_email', description: 'w', sideEffect: 'write', gate: true, handler: async () => ({}) });
registry.register({ name: 'search_competitors', description: 'r', sideEffect: 'read', gate: true, handler: async () => ({}) });

test('politique : écriture jamais assignable ; politique d’espace restreint', () => {
  const p = personaToolPolicy(registry, {});
  assert.equal(p.find((x) => x.name === 'send_email').assignable, false);
  assert.equal(p.find((x) => x.name === 'estimate_resources').assignable, true);
  const r = personaToolPolicy(registry, { KAYROS_PERSONA_TOOL_POLICY: 'search_competitors' });
  assert.equal(r.find((x) => x.name === 'estimate_resources').assignable, false);
});

test('validation : hors registre, écriture, joker, hors politique refusés', () => {
  assert.deepEqual(validatePersonaTools(['estimate_resources', 'estimate_resources', 'search_competitors'], { registry, env: {} }), ['estimate_resources', 'search_competitors']);
  assert.throws(() => validatePersonaTools(['inconnu'], { registry, env: {} }), /absent du registre/);
  assert.throws(() => validatePersonaTools(['send_email'], { registry, env: {} }), /écriture/);
  assert.throws(() => validatePersonaTools('*', { registry, env: {} }), /joker/);
  assert.throws(() => validatePersonaTools(['estimate_resources'], { registry, env: { KAYROS_PERSONA_TOOL_POLICY: 'search_competitors' } }), /politique/);
  assert.throws(() => validatePersonaTools([''], { registry, env: {} }), /non-blank/);
  assert.deepEqual(validatePersonaTools([], { registry, env: {} }), []);
});
