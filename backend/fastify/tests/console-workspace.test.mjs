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
