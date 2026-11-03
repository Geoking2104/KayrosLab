import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeSkillCatalog, resolveSkills, effectiveSkillTools, assertSkillToolAllowed, loadSkillCatalog } from './persona-skills.mjs';
import { loadPersonaPackage } from './persona-package.mjs';
import { compileEffectiveAgentContext } from './swarm.mjs';
import { ToolRegistry } from './tool-registry.mjs';

const catalog = normalizeSkillCatalog({ skills: [
  { id: 'roi', name: 'ROI', instructions: 'Exiger un ROI', tools: ['estimate_resources', 'send_email'] },
  { id: 'veille', name: 'Veille', tools: ['search_competitors'] },
] });
const registry = new ToolRegistry();
registry.register({ name: 'estimate_resources', description: 'x', sideEffect: 'read', handler: async () => ({}) });
registry.register({ name: 'send_email', description: 'x', sideEffect: 'write', gate: true, handler: async () => ({}) });
registry.register({ name: 'search_competitors', description: 'x', sideEffect: 'read', handler: async () => ({}) });

test('catalogue : ids validés, doublons et inconnus refusés', () => {
  assert.throws(() => normalizeSkillCatalog({ skills: [{ id: 'A B' }] }), /id invalide/);
  assert.throws(() => normalizeSkillCatalog({ skills: [{ id: 'a' }, { id: 'a' }] }), /double/);
  assert.throws(() => resolveSkills(['nope'], catalog), /inconnu/);
  assert.equal(resolveSkills(['roi'], catalog)[0].tools.length, 2);
});

test('outils effectifs = skill ∩ assertToolAllowed (allowlist, gate humaine)', () => {
  const agent = { agent_id: 'p', tools: ['estimate_resources', 'send_email'], metadata: { skills: resolveSkills(['roi', 'veille'], catalog) } };
  const { granted, denied } = effectiveSkillTools(agent, { registry });
  assert.deepEqual(granted, ['estimate_resources']);
  assert.deepEqual(denied.map((d) => d.tool).sort(), ['search_competitors', 'send_email']);
  assert.ok(effectiveSkillTools(agent, { registry, gateApproved: true }).granted.includes('send_email'));
  assert.throws(() => assertSkillToolAllowed(agent, registry.get('search_competitors')), /not permitted/);
  assert.throws(() => assertSkillToolAllowed({ ...agent, tools: ['simulate_trajectory'] }, { name: 'simulate_trajectory', sideEffect: 'read' }), /not provided by any skill/);
  assert.equal(assertSkillToolAllowed(agent, registry.get('estimate_resources')), true);
  // Sans allowlist (persona par défaut) : aucun outil, quelles que soient les skills.
  assert.deepEqual(effectiveSkillTools({ ...agent, tools: [] }, { registry }).granted, []);
});

test('contexte effectif : un skill n\'annonce que les outils autorisés', () => {
  const ctx = compileEffectiveAgentContext({ agent_id: 'persona_p', role_name: 'R', department: 'D', primary_focus: 'F', mission: 'Mission de test', tools: ['estimate_resources'], metadata: { skills: resolveSkills(['roi'], catalog) } });
  assert.match(ctx, /ROI : Exiger un ROI \(outils: estimate_resources\)/);
  assert.doesNotMatch(ctx, /send_email/);
});

test('paquet : skills.yaml chargé, non traité comme persona ; skill inconnu rejeté', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personas-skills-'));
  await writeFile(join(dir, 'skills.json'), '{}');
  await writeFile(join(dir, 'skills.yaml'), JSON.stringify({ skills: [{ id: 'roi', name: 'ROI', tools: ['estimate_resources'] }] }));
  await writeFile(join(dir, 'alex.json'), JSON.stringify({ name: 'Alex', source: 'public', public_sources: ['https://example.com/a'], skills: ['roi'], tools: ['estimate_resources'] }));
  await writeFile(join(dir, 'bad.json'), JSON.stringify({ name: 'B', source: 'public', public_sources: ['https://example.com/b'], skills: ['inconnu'] }));
  const parse = (text) => JSON.parse(text);
  const { personas, errors } = await loadPersonaPackage(dir, { parse });
  const alex = personas.find((p) => p.definition.agent_id === 'alex').definition;
  assert.equal(alex.metadata.skills[0].id, 'roi');
  assert.deepEqual(alex.tools, ['estimate_resources']);
  assert.ok(errors.some((e) => e.file === 'bad.json' && /inconnu/.test(e.error)));
  assert.ok(errors.some((e) => e.file === 'skills.json'));
  assert.ok(!errors.some((e) => e.file === 'skills.yaml'));
});

test('catalogue du dépôt valide', async () => {
  const { parse } = await import('yaml').catch(() => ({ parse: null }));
  if (!parse) return;
  const list = await loadSkillCatalog(new URL('../personas/skills.yaml', import.meta.url).pathname, { parse });
  assert.ok(list.length >= 3);
});
