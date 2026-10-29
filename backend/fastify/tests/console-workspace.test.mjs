import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import consoleRoute from '../routes/console.mjs';
import consoleWorkspaceRoute from '../routes/console-workspace.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { compileEffectiveAgentContext } from '../../../core/swarm.mjs';
import { ConnectorConfigurationService, InMemoryConnectorConfigStore } from '../../../core/connector-config.mjs';
import { WorkspaceStore } from '../lib/workspace-store.mjs';

async function buildApp(role = 'comex') {
  const swarm = new SwarmService();
  const hybridGateway = new HybridAgentGateway({ swarm });
  const connectorConfig = new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore() });
  const app = Fastify();
  app.decorate('kayrosContext', {
    hybridGateway, connectorConfig, engine: { swarm }, workspaceStore: new WorkspaceStore({ file: 'memory' }),
    crystalKnowsConfigured: false, connectorEncryptionConfigured: false,
  });
  app.decorate('requireAuth', async () => ({ sub: 'u1', email: 'owner@kayros.test', role, tenantId: 'tenant-a' }));
  await app.register(consoleRoute);
  await app.register(consoleWorkspaceRoute);
  return { app, swarm };
}

test('société, projet et tableau de bord', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const co = await app.inject({ method: 'POST', url: '/v1/console/companies', payload: { name: 'Atelier Renaud', sector: 'Industrie' } });
  assert.equal(co.statusCode, 201);
  const companyId = co.json().item.id;
  const bad = await app.inject({ method: 'POST', url: '/v1/console/projects', payload: { company_id: 'nope', name: 'X' } });
  assert.equal(bad.statusCode, 400);
  const session = await app.inject({ method: 'POST', url: '/v1/console/sessions', payload: { name: 'COMEX', active_agents: ['cfo', 'cto'] } });
  const sessionId = session.json().session.session_id;
  const prj = await app.inject({ method: 'POST', url: '/v1/console/projects', payload: { company_id: companyId, name: 'Renouvellement contrat', session_ids: [sessionId] } });
  assert.equal(prj.statusCode, 201);
  const run = await app.inject({ method: 'POST', url: `/v1/console/sessions/${sessionId}/run?wait=1`, payload: { question: 'Faut-il accepter une remise de 18 % contre 24 mois de volume ?', profile: 'demo' } });
  assert.equal(run.statusCode, 200);
  const dash = (await app.inject({ method: 'GET', url: `/v1/console/dashboard?company_id=${companyId}` })).json();
  assert.equal(dash.company.name, 'Atelier Renaud');
  assert.equal(dash.projects.length, 1);
  assert.equal(dash.projects[0].threads.length, 1);
  assert.equal(dash.widgets.projects_active, 1);
  const blocked = await app.inject({ method: 'DELETE', url: `/v1/console/companies/${companyId}` });
  assert.equal(blocked.statusCode, 409);
  const list = (await app.inject({ method: 'GET', url: `/v1/console/projects?company_id=${companyId}` })).json();
  assert.equal(list.projects.length, 1);
});

test('skill et contexte rattachés à un agent entrent dans son contexte effectif', async (t) => {
  const { app, swarm } = await buildApp();
  t.after(() => app.close());
  await swarm.createAgent({ agent_id: 'achats', role_name: 'Acheteur', department: 'Achats', seniority: 'senior', primary_focus: 'Négocier.', enabled: true }, { tenantId: 'tenant-a' });
  const skill = await app.inject({ method: 'POST', url: '/v1/console/skills', payload: { name: 'Analyse TCO', instructions: 'Calculer le coût total sur 3 ans.', agent_ids: ['achats'] } });
  assert.equal(skill.statusCode, 201);
  const ctx = await app.inject({ method: 'POST', url: '/v1/console/contexts', payload: { name: 'Politique achats', kind: 'policy', content: 'Plafond de remise 12 %.', agent_ids: ['achats'] } });
  assert.equal(ctx.statusCode, 201);
  const agent = swarm.registry.get('achats', { tenantId: 'tenant-a' });
  const compiled = compileEffectiveAgentContext(agent);
  assert.match(compiled, /Analyse TCO/);
  assert.match(compiled, /Plafond de remise 12 %/);
  const detached = await app.inject({ method: 'PATCH', url: `/v1/console/skills/${skill.json().item.id}`, payload: { agent_ids: [] } });
  assert.equal(detached.statusCode, 200);
  assert.doesNotMatch(compileEffectiveAgentContext(swarm.registry.get('achats', { tenantId: 'tenant-a' })), /Analyse TCO/);
  assert.equal(detached.json().item.name, 'Analyse TCO');
});

test('un membre ne peut pas créer de société', async (t) => {
  const { app } = await buildApp('member');
  t.after(() => app.close());
  const res = await app.inject({ method: 'POST', url: '/v1/console/companies', payload: { name: 'X' } });
  assert.equal(res.statusCode, 403);
});

test('parties prenantes humaines d’un projet', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const co = (await app.inject({ method: 'POST', url: '/v1/console/companies', payload: { name: 'Atelier' } })).json().item;
  const prj = await app.inject({ method: 'POST', url: '/v1/console/projects', payload: { company_id: co.id, name: 'P', stakeholders: ['Ancien format', { name: 'Camille Renaud', role: 'decideur', title: 'DG' }] } });
  assert.equal(prj.statusCode, 201);
  assert.deepEqual(prj.json().item.stakeholders.map((s) => [s.name, s.role]), [['Ancien format', 'consulte'], ['Camille Renaud', 'decideur']]);
  const bad = await app.inject({ method: 'PATCH', url: `/v1/console/projects/${prj.json().item.id}`, payload: { stakeholders: [{ name: 'X', role: 'roi' }] } });
  assert.equal(bad.statusCode, 400);
  const ok = await app.inject({ method: 'PATCH', url: `/v1/console/projects/${prj.json().item.id}`, payload: { stakeholders: [{ name: 'Léa', role: 'sponsor' }] } });
  assert.equal(ok.json().item.stakeholders[0].role, 'sponsor');
  assert.equal(ok.json().item.name, 'P');
});

test('graphe de projet éditable : validation des liens et des portes', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const co = (await app.inject({ method: 'POST', url: '/v1/console/companies', payload: { name: 'Atelier' } })).json().item;
  const prj = (await app.inject({ method: 'POST', url: '/v1/console/projects', payload: { company_id: co.id, name: 'P' } })).json().item;
  assert.equal(prj.graph, null);
  const nodes = [{ id: 'q', type: 'question' }, { id: 'g', type: 'porte', config: { threshold: 'unanimous', min_go: 70, veto: true } }, { id: 'a', type: 'arbitrage', config: { role: 'decideur' } }];
  const ok = await app.inject({ method: 'PATCH', url: `/v1/console/projects/${prj.id}`, payload: { graph: { nodes, edges: [{ from: 'q', to: 'g' }, { from: 'g', to: 'a' }] } } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().item.graph.nodes[1].config.min_go, 70);
  for (const edges of [[{ from: 'q', to: 'zz' }], [{ from: 'q', to: 'q' }], [{ from: 'q', to: 'g' }, { from: 'g', to: 'q' }]]) {
    const bad = await app.inject({ method: 'PATCH', url: `/v1/console/projects/${prj.id}`, payload: { graph: { nodes, edges } } });
    assert.equal(bad.statusCode, 400, JSON.stringify(edges));
  }
  const badGate = await app.inject({ method: 'PATCH', url: `/v1/console/projects/${prj.id}`, payload: { graph: { nodes: [{ id: 'g', type: 'porte', config: { threshold: 'tirage' } }], edges: [] } } });
  assert.equal(badGate.statusCode, 400);
});

test('contexte en cascade société → projet → nœud', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const co = (await app.inject({ method: 'POST', url: '/v1/console/companies', payload: { name: 'Atelier' } })).json().item;
  const session = (await app.inject({ method: 'POST', url: '/v1/console/sessions', payload: { name: 'COMEX', active_agents: ['cfo'] } })).json().session;
  const prj = (await app.inject({ method: 'POST', url: '/v1/console/projects', payload: { company_id: co.id, name: 'P', session_ids: [session.session_id] } })).json().item;
  const add = (payload) => app.inject({ method: 'POST', url: '/v1/console/contexts', payload });
  await add({ name: 'Charte achats', content: 'Toujours 3 devis', company_id: co.id });
  await add({ name: 'Brief projet', content: 'Budget 2 M€', project_id: prj.id });
  await add({ name: 'Note porte', content: 'Seuil 70 %', project_id: prj.id, node_id: 'g' });
  const plain = (await app.inject({ url: `/v1/console/projects/${prj.id}/context` })).json();
  assert.deepEqual(plain.layers.map((l) => [l.level, l.items.map((i) => i.name)]), [['societe', ['Charte achats']], ['projet', ['Brief projet']]]);
  const node = (await app.inject({ url: `/v1/console/projects/${prj.id}/context?node_id=g` })).json();
  assert.equal(node.layers[2].items[0].name, 'Note porte');
  assert.match(node.text, /Contexte Société:[\s\S]*Contexte Projet:[\s\S]*Contexte Nœud:/);
  const { collectiveAttachmentsContext } = await import('../routes/console-workspace.mjs');
  const injected = await collectiveAttachmentsContext(app, 'tenant-a', session.session_id);
  assert.match(injected, /Toujours 3 devis[\s\S]*Budget 2 M€/);
});

test('skills versionnés et restauration', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const skill = (await app.inject({ method: 'POST', url: '/v1/console/skills', payload: { name: 'TCO', instructions: 'v1' } })).json().item;
  assert.equal(skill.version, 1);
  const v2 = (await app.inject({ method: 'PATCH', url: `/v1/console/skills/${skill.id}`, payload: { instructions: 'v2' } })).json().item;
  assert.equal(v2.version, 2);
  const same = (await app.inject({ method: 'PATCH', url: `/v1/console/skills/${skill.id}`, payload: { agent_ids: [] } })).json().item;
  assert.equal(same.version, 2, 'un rattachement ne crée pas de version');
  const hist = (await app.inject({ url: `/v1/console/skills/${skill.id}/versions` })).json();
  assert.deepEqual(hist.versions.map((v) => [v.version, v.instructions]), [[1, 'v1']]);
  const restored = (await app.inject({ method: 'POST', url: `/v1/console/skills/${skill.id}/restore`, payload: { version: 1 } })).json().item;
  assert.equal(restored.instructions, 'v1');
  assert.equal(restored.version, 3);
  assert.equal((await app.inject({ method: 'POST', url: `/v1/console/skills/${skill.id}/restore`, payload: { version: 9 } })).statusCode, 404);
});

test('membres et rôles effectifs', async (t) => {
  const { app } = await buildApp('admin');
  t.after(() => app.close());
  const me = (await app.inject({ url: '/v1/console/members/me' })).json();
  assert.equal(me.role, 'admin');
  assert.ok(me.permissions.includes('members'));
  const add = await app.inject({ method: 'POST', url: '/v1/console/members', payload: { email: 'OWNER@kayros.test', name: 'Moi', role: 'admin' } });
  assert.equal(add.statusCode, 201);
  assert.equal(add.json().item.email, 'owner@kayros.test');
  assert.equal((await app.inject({ method: 'POST', url: '/v1/console/members', payload: { email: 'owner@kayros.test' } })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/console/members', payload: { email: 'pas-un-mail' } })).statusCode, 400);
  // Dernier admin : on ne peut pas le rétrograder.
  assert.equal((await app.inject({ method: 'PATCH', url: `/v1/console/members/${add.json().item.id}`, payload: { role: 'lecteur' } })).statusCode, 409);
  const other = (await app.inject({ method: 'POST', url: '/v1/console/members', payload: { email: 'b@kayros.test', role: 'admin' } })).json().item;
  assert.equal((await app.inject({ method: 'PATCH', url: `/v1/console/members/${add.json().item.id}`, payload: { role: 'lecteur' } })).statusCode, 200);
  // La fiche membre prime sur le rôle du jeton : le lecteur ne gère plus rien.
  assert.equal((await app.inject({ url: '/v1/console/members/me' })).json().role, 'lecteur');
  assert.equal((await app.inject({ method: 'POST', url: '/v1/console/companies', payload: { name: 'X' } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'DELETE', url: `/v1/console/members/${other.id}` })).statusCode, 403);
});

test('contributeur : pas de gestion des membres', async (t) => {
  const { app } = await buildApp('contributeur');
  t.after(() => app.close());
  assert.equal((await app.inject({ method: 'POST', url: '/v1/console/members', payload: { email: 'x@y.fr' } })).statusCode, 403);
});

test('notification e-mail des parties prenantes « informé »', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const mails = [];
  app.kayrosContext.contactMailer = { sendMail: async (m) => { mails.push(m); } };
  app.kayrosContext.smtp = { from: 'kayros@test' };
  const co = (await app.inject({ method: 'POST', url: '/v1/console/companies', payload: { name: 'Atelier' } })).json().item;
  const prj = (await app.inject({ method: 'POST', url: '/v1/console/projects', payload: { company_id: co.id, name: 'Helia', thread_ids: ['th_1'], stakeholders: [
    { name: 'Léa', role: 'informe', email: 'lea@atelier.fr' }, { name: 'Sans mail', role: 'informe' }, { name: 'Camille', role: 'decideur', email: 'c@atelier.fr' },
  ] } })).json().item;
  const { notifyInformed } = await import('../routes/console-workspace.mjs');
  const sent = await notifyInformed(app, 'tenant-a', { thread_id: 'th_1', question: 'Signer ?', human_decision: { decision: 'GO', justification: 'Marge OK' } });
  assert.deepEqual(sent.map((n) => [n.to, n.status]), [['lea@atelier.fr', 'sent']]);
  assert.equal(mails[0].to, 'lea@atelier.fr');
  assert.match(mails[0].text, /Décision : GO[\s\S]*Marge OK/);
  app.kayrosContext.contactMailer = null;
  const manual = await app.inject({ method: 'POST', url: `/v1/console/projects/${prj.id}/notify`, payload: {} });
  assert.equal(manual.json().notifications[0].status, 'queued', 'sans SMTP, la notification reste en file');
  const log = (await app.inject({ url: `/v1/console/projects/${prj.id}/notifications` })).json().notifications;
  assert.equal(log.length, 2);
});
