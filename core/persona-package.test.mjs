import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPersonaPackage, synchronizePersonaPackage, personaAgentDefinition } from './persona-package.mjs';
import { normalizeImpersonator, impersonatorGuardrails, impersonatorContext } from './impersonator.mjs';
import { SwarmService } from './swarm.mjs';

const json = (o) => JSON.stringify(o);
const pub = { name: 'Alex Martin', role: 'CFO', source: 'public', public_sources: ['https://example.com/alex'] };

test('source public : consentement non requis mais public_sources exigé', () => {
  const i = normalizeImpersonator({ persona_name: 'A', source: 'public', public_sources: ['https://x.example/a'] });
  assert.equal(i.legal_basis, 'public_data');
  assert.equal(i.consent_confirmed, false);
  assert.deepEqual(i.public_sources, ['https://x.example/a']);
  assert.throws(() => normalizeImpersonator({ persona_name: 'A', source: 'public' }), /public_sources/);
  assert.throws(() => normalizeImpersonator({ persona_name: 'A', source: 'public', public_sources: ['pas-une-url'] }), /URLs/);
});

test('les autres sources gardent l\'exigence de consentement', () => {
  for (const source of ['linkedin', 'crystalknows', 'export', 'manual', 'enriched']) {
    assert.throws(() => normalizeImpersonator({ persona_name: 'A', source, public_sources: ['https://x.example'] }), /consentement/);
    assert.equal(normalizeImpersonator({ persona_name: 'A', source, consent_confirmed: true }).legal_basis, 'consent');
  }
});

test('garde-fous IMP_* et veto inchangés pour une persona publique', () => {
  const d = personaAgentDefinition(pub, { file: 'alex.yaml' });
  assert.equal(d.agent_id, 'alex');
  assert.equal(d.veto_power, true);
  assert.deepEqual(impersonatorGuardrails(d.metadata.impersonator).map((r) => r.rule_id),
    ['IMP_01_LABEL', 'IMP_02_NEVER_SPEAK_FOR', 'IMP_03_CLUES_ONLY', 'IMP_04_IDEA_TEST', 'IMP_05_NO_MATERIAL_DECISION']);
  assert.match(impersonatorContext(d), /données publiques uniquement \(https:\/\/example.com\/alex\)/);
});

test('loadPersonaPackage : un fichier par persona, rejets rapportés, catalog/ ignoré', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personas-'));
  await writeFile(join(dir, 'alex.json'), json(pub));
  await writeFile(join(dir, 'sans-consentement.json'), json({ name: 'B', source: 'manual' }));
  await writeFile(join(dir, 'notes.txt'), 'ignoré');
  await mkdir(join(dir, 'catalog'));
  await writeFile(join(dir, 'catalog', 'modele.json'), json(pub));
  const { personas, errors } = await loadPersonaPackage(dir);
  assert.deepEqual(personas.map((p) => p.definition.agent_id), ['alex']);
  assert.equal(errors.length, 1);
  assert.match(errors[0].error, /consentement/);
});

test('loadPersonaPackage : dossier absent = aucune persona', async () => {
  assert.deepEqual(await loadPersonaPackage(join(tmpdir(), 'inexistant-kayros-xyz')), { personas: [], errors: [] });
});

test('synchronizePersonaPackage : crée puis ignore (idempotent, pas d\'écrasement)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personas-'));
  await writeFile(join(dir, 'alex.json'), json(pub));
  const swarm = new SwarmService({});
  const first = await synchronizePersonaPackage(swarm, dir);
  assert.deepEqual(first.created, ['alex']);
  const agent = swarm.registry.get('alex');
  assert.equal(agent.veto_power, true);
  assert.equal(agent.metadata.impersonator.legal_basis, 'public_data');
  const second = await synchronizePersonaPackage(swarm, dir);
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.skipped, ['alex']);
});

test('parseur YAML injecté', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'personas-'));
  await writeFile(join(dir, 'p.yaml'), 'ignored');
  const { personas } = await loadPersonaPackage(dir, { parse: () => pub });
  assert.equal(personas[0].definition.agent_id, 'p');
});
