import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { personaAgentDefinition } from '../../../core/persona-package.mjs';
import { impersonatorGuardrails } from '../../../core/impersonator.mjs';

const dir = new URL('../../../personas/catalog/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.yaml'));

test('catalogue : modèles anonymes, convertibles en persona gouvernée', () => {
  assert.ok(files.length >= 5);
  for (const file of files) {
    const tpl = parse(readFileSync(new URL(file, dir), 'utf8'));
    assert.ok(tpl.id && tpl.template_title, file);
    assert.equal(tpl.name, undefined, `${file} ne doit désigner personne`);
    assert.equal(tpl.source, undefined, file);
    const { template_title, description, department, ...rest } = tpl;
    // Sans source ni consentement, un modèle seul n'est pas une persona valide.
    assert.throws(() => personaAgentDefinition({ ...rest, name: 'X' }), /consentement/);
    const d = personaAgentDefinition({ ...rest, name: 'Persona test', source: 'public', public_sources: ['https://example.com/p'] });
    assert.equal(impersonatorGuardrails(d.metadata.impersonator).length, 5);
    assert.equal(d.veto_power, tpl.veto_power !== false);
  }
});
