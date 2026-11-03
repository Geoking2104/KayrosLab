import test from 'node:test';
import assert from 'node:assert/strict';
import { designPersonaTurn, parseDesignerOutput, validateDraft, DESIGNER_ROLE } from './persona-designer.mjs';

test('parseDesignerOutput tolère les blocs ```json et le texte autour', () => {
  assert.deepEqual(parseDesignerOutput('Voici :\n```json\n{"reply":"ok","draft":{"name":"A"}}\n```'), { reply: 'ok', draft: { name: 'A' } });
  assert.equal(parseDesignerOutput('pas de json'), null);
});

test('tour via KayrosLLM.complete (role persona_designer), brouillon validé à blanc, aucune création', async () => {
  const calls = [];
  const llm = { complete: async (req) => { calls.push(req); return { provider: 'nvidia', text: '{"reply":"Quel est son rôle ?","draft":{"name":"Alex Martin","role":"CFO","source":"public","public_sources":["https://example.com/alex"]}}' }; } };
  const out = await designPersonaTurn({ llm, messages: [{ role: 'user', content: 'Simule Alex Martin' }] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].role, DESIGNER_ROLE);
  assert.equal(out.source, 'model');
  assert.equal(out.valid, true);
  assert.equal(out.requires_approval, true);
  assert.equal(out.guardrails.length, 5);
  assert.equal(out.draft.source, 'public');
});

test('repli déterministe (modèle simulé) : URL et nom repérés', async () => {
  const llm = { complete: async () => ({ provider: 'mock', text: 'Simulation' }) };
  const out = await designPersonaTurn({ llm, messages: [{ role: 'user', content: 'Persona : Alex Martin, CFO. https://example.com/alex' }] });
  assert.equal(out.source, 'deterministic');
  assert.equal(out.draft.name, 'Alex Martin');
  assert.deepEqual(out.draft.public_sources, ['https://example.com/alex']);
  assert.equal(out.valid, true);
});

test('brouillon invalide : SSRF et nom manquant signalés', () => {
  assert.equal(validateDraft({ name: 'A', source: 'public', public_sources: ['http://127.0.0.1/'] }).valid, false);
  assert.match(validateDraft({}).issues[0], /persona_name/);
});

test('sans message utilisateur : erreur', async () => {
  await assert.rejects(designPersonaTurn({ messages: [] }), /message utilisateur/);
});
