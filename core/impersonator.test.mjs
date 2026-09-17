import test from 'node:test';
import assert from 'node:assert/strict';
import {
  impersonatorAgentDefinition,
  impersonatorContext,
  impersonatorGuardrails,
  normalizeImpersonator,
  personaClues,
} from './impersonator.mjs';
import { SwarmService } from './swarm.mjs';
import { compileEffectiveAgentContext, resolveEffectiveRules } from './swarm.mjs';

const impersonator = {
  persona_name: 'Camille Dubois',
  persona_role: 'VP Procurement',
  persona_company: 'Northwind',
  source: 'crystalknows',
  source_url: 'https://app.crystalknows.com/x',
  purpose: 'idea_test',
  consent_confirmed: true,
  clues: ['décide vite', 'exige des preuves chiffrées'],
};

test('impersonator requires explicit consent and a known source', () => {
  assert.throws(() => normalizeImpersonator({ persona_name: 'X', source: 'linkedin' }), /consentement explicite/);
  assert.throws(() => normalizeImpersonator({ persona_name: 'X', source: 'nope', consent_confirmed: true }), /source inconnue/);
  const ok = normalizeImpersonator(impersonator);
  assert.equal(ok.persona_name, 'Camille Dubois');
  assert.equal(ok.purpose, 'idea_test');
});

test('guardrails cover labelling, no-impersonation, clues-only and material decisions', () => {
  const ids = impersonatorGuardrails(impersonator).map((r) => r.rule_id);
  assert.deepEqual(ids, ['IMP_01_LABEL', 'IMP_02_NEVER_SPEAK_FOR', 'IMP_03_CLUES_ONLY', 'IMP_04_IDEA_TEST', 'IMP_05_NO_MATERIAL_DECISION']);
  const text = impersonatorGuardrails(impersonator).map((r) => r.rule_text).join(' ');
  assert.match(text, /Simulation/);
  assert.match(text, /Ne jamais affirmer être Camille Dubois/);
});

test('persona clues digest only reflects supplied profile fields', () => {
  const clues = personaClues({ assigned_name: 'Camille Dubois', disc_type: 'D/C', communication_style: { tone: 'direct' } });
  assert.equal(clues.disc, 'D/C');
  assert.equal(clues.tone, 'direct');
  assert.deepEqual(clues.motivators, []);
});

test('impersonator definition is a consented hybrid whose context carries the guardrails', () => {
  const definition = impersonatorAgentDefinition({ impersonator, human_profile: { assigned_name: 'Camille Dubois' } });
  assert.equal(definition.agent_id, 'imposteur_camille_dubois');
  assert.equal(definition.human_profile.consent_confirmed, true);
  assert.equal(definition.metadata.impersonator.persona_name, 'Camille Dubois');
  assert.equal(definition.veto_power, true);
  const ctx = impersonatorContext(definition);
  assert.match(ctx, /PERSONA SIMULATION/);
  assert.match(ctx, /Source des indices : crystalknows/);
});

test('the swarm compiles impersonator guardrails into effective rules', () => {
  const swarm = new SwarmService();
  const definition = impersonatorAgentDefinition({ impersonator, human_profile: { assigned_name: 'Camille Dubois' } });
  const agent = swarm.createAgent(definition, { tenantId: 't1', by: 'test' });
  const rules = resolveEffectiveRules(agent);
  assert.ok(rules.some((r) => r.origin === 'impersonator' && r.rule_id === 'IMP_01_LABEL'));
  const context = compileEffectiveAgentContext(agent);
  assert.match(context, /\[IMP_02_NEVER_SPEAK_FOR\] \(impersonator\)/);
  assert.match(context, /PERSONA SIMULATION/);
});

test('an agent without impersonation metadata is unchanged', () => {
  const swarm = new SwarmService();
  const agent = swarm.createAgent({ agent_id: 'plain', role_name: 'R', department: 'D', seniority: 'senior', primary_focus: 'F', connectors: ['console'] }, { tenantId: 't1' });
  assert.equal(impersonatorContext(agent), '');
  assert.ok(!resolveEffectiveRules(agent).some((r) => r.origin === 'impersonator'));
});
