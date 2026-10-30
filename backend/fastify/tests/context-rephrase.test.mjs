import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import consoleWorkspaceRoute from '../routes/console-workspace.mjs';
import { SwarmService, KayrosLLM, RoutingPolicy } from '../../../core/index.mjs';
import { WorkspaceStore } from '../lib/workspace-store.mjs';
import { rephraseContext, draftFromInput } from '../../../core/context-rephrase.mjs';

function fakeLlm(text, seen = []) {
  const p = { id: 'nvidia', async complete(req) { seen.push(req); if (text instanceof Error) throw text; return { text, provider: 'nvidia' }; } };
  const policy = new RoutingPolicy(); policy.choose = () => 'nvidia'; policy.modelFor = () => null;
  return new KayrosLLM({ nvidia: p }, policy, { retry: { maxRetries: 0 } });
}
const GOOD = JSON.stringify({ structured: { demande_client: 'Refonte du portail fournisseurs', contexte_interne: 'Équipe de 4', contexte_client: 'Acheteur public', equipe_decision: 'DSI + achats' }, brief: 'Ma compréhension : le client veut refondre son portail fournisseurs ; la DSI et les achats décident.', missing: [], questions: ['Quel calendrier ?'] });

async function buildApp(llm) {
  const app = Fastify();
  app.decorate('kayrosContext', { llm, engine: { swarm: new SwarmService() }, workspaceStore: new WorkspaceStore({ file: 'memory' }) });
  app.decorate('requireAuth', async () => ({ sub: 'u1', email: 'owner@kayros.test', role: 'comex', tenantId: 'tenant-a' }));
  await app.register(consoleWorkspaceRoute);
  return app;
}

test('rephraseContext : JSON du modèle + harnais injecté en mode flag', async () => {
  const seen = [];
  const out = await rephraseContext(fakeLlm('```json\n' + GOOD + '\n```', seen), 'rfp', { raw: 'AO portail fournisseurs', fields: { equipe_decision: 'DSI + achats' } });
  assert.equal(out.source, 'model');
  assert.match(out.brief, /^Ma compréhension/);
  assert.equal(out.structured.equipe_decision, 'DSI + achats');
  assert.equal(seen[0].compliance, 'flag');
  assert.match(seen[0].messages[0].content, /\[KAYROS-HARNESS\]/);
});

test('rephraseContext : échec modèle ou JSON invalide → brouillon conservé', async () => {
  for (const llm of [fakeLlm(new Error('timeout')), fakeLlm('pas du json'), null]) {
    const out = await rephraseContext(llm, 'interne', { fields: { perimetre: 'Support N1' } });
    assert.equal(out.source, 'draft'); assert.ok(out.error);
    assert.equal(out.structured.perimetre, 'Support N1');
    assert.deepEqual(out.missing, ['contexte_societe', 'contexte_projet', 'competences']);
  }
  assert.equal(draftFromInput('skill', { raw: 'Chiffrer un AO' }).structured.objectif, 'Chiffrer un AO');
});

test('API : rephrase, brouillon non injecté, validation, retour en brouillon si la saisie change', async (t) => {
  const app = await buildApp(fakeLlm(GOOD)); t.after(() => app.close());
  assert.equal((await app.inject({ method: 'POST', url: '/v1/console/context/rephrase', payload: { type: 'rfp' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/console/context/rephrase', payload: { type: 'nope', raw: 'x' } })).statusCode, 400);
  const r = await app.inject({ method: 'POST', url: '/v1/console/context/rephrase', payload: { type: 'rfp', raw: 'AO portail fournisseurs' } });
  assert.equal(r.statusCode, 200); assert.equal(r.json().source, 'model');
  assert.ok((await app.inject({ method: 'GET', url: '/v1/console/context/modes' })).json().modes.rfp.fields.length === 4);

  const co = (await app.inject({ method: 'POST', url: '/v1/console/companies', payload: { name: 'ACME' } })).json().item;
  const prj = (await app.inject({ method: 'POST', url: '/v1/console/projects', payload: { company_id: co.id, name: 'AO portail' } })).json().item;
  const created = await app.inject({ method: 'POST', url: '/v1/console/contexts', payload: { name: 'Brief AO', kind: 'note', mode: 'rfp', status: 'draft', raw_input: 'AO portail fournisseurs', structured: r.json().structured, content: r.json().brief, project_id: prj.id } });
  assert.equal(created.statusCode, 201);
  const id = created.json().item.id;
  let ctx = (await app.inject({ method: 'GET', url: `/v1/console/projects/${prj.id}/context` })).json();
  assert.equal(ctx.layers.find((l) => l.level === 'projet').items.length, 0, 'brouillon non injecté');
  assert.equal(ctx.pending.length, 1);

  const v = (await app.inject({ method: 'PATCH', url: `/v1/console/contexts/${id}`, payload: { status: 'validated' } })).json().item;
  assert.equal(v.validated_by, 'owner@kayros.test');
  ctx = (await app.inject({ method: 'GET', url: `/v1/console/projects/${prj.id}/context` })).json();
  assert.equal(ctx.layers.find((l) => l.level === 'projet').items[0].id, id);
  assert.match(ctx.text, /Ma compréhension/);

  const stale = (await app.inject({ method: 'PATCH', url: `/v1/console/contexts/${id}`, payload: { raw_input: 'AO portail + extranet' } })).json().item;
  assert.equal(stale.status, 'draft');

  const legacy = await app.inject({ method: 'POST', url: '/v1/console/contexts', payload: { name: 'Note libre', content: 'Saisie manuelle directe', project_id: prj.id } });
  assert.equal(legacy.json().item.status, 'validated', 'saisie manuelle sans reformulation reste active');
});
