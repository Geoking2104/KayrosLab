import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import consoleRoute from '../routes/console.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { ConnectorConfigurationService, InMemoryConnectorConfigStore } from '../../../core/connector-config.mjs';

const html = readFileSync(new URL('../../../core/fixtures/crystal-public-geoffroy2104.html', import.meta.url), 'utf8');

async function buildApp() {
  const swarm = new SwarmService();
  const hybridGateway = new HybridAgentGateway({ swarm });
  const app = Fastify();
  app.decorate('kayrosContext', {
    hybridGateway, connectorConfig: new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore() }), engine: { swarm },
    crystalKnowsConfigured: false, connectorEncryptionConfigured: false,
    crystalPublicFetch: async () => ({ ok: true, status: 200, text: async () => html }),
  });
  app.decorate('requireAuth', async () => ({ sub: 'u1', email: 'owner@kayros.test', role: 'comex', tenantId: 'tenant-a' }));
  await app.register(consoleRoute);
  return { app, swarm, hybridGateway };
}

test('e2e : enrichir → aperçu → créer → mission → message caractéristique', async (t) => {
  const { app, swarm, hybridGateway } = await buildApp();
  t.after(() => app.close());
  const enriched = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { consent_confirmed: true, crystal_public_url: 'geoffroy2104' } });
  assert.equal(enriched.statusCode, 200, enriched.body);
  assert.equal(enriched.json().confidence.kind, 'crystalknows');

  const preview = await app.inject({ method: 'POST', url: '/v1/console/personality/speak', payload: { idea: 'Offre premium', human_profile: enriched.json().profile } });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.match(preview.json().message, /^Simulation — Sur « Offre premium » : quel gain/);

  const created = await app.inject({ method: 'POST', url: '/v1/console/impersonators', payload: { name: 'Geoffroy', agent_id: 'imp_geoffroy', source: 'enriched', consent_confirmed: true, human_profile: enriched.json().profile } });
  assert.equal(created.statusCode, 201, created.body);
  const agentId = created.json().agent.agent_id;
  assert.match(created.json().agent.effective_context, /VOIX DE LA PERSONA/);

  const session = await app.inject({ method: 'POST', url: '/v1/console/sessions', payload: { name: 'Test idée', active_agents: ['cfo', agentId], personality_simulation_enabled: true } });
  assert.equal(session.statusCode, 201, session.body);
  const mission = await app.inject({ method: 'POST', url: `/v1/console/sessions/${session.json().session.session_id}/run`, payload: { question: 'Lancer une offre premium à 99 €' } });
  assert.equal(mission.statusCode, 202, mission.body);
  const thread = await hybridGateway.waitForThread(mission.json().thread_id);
  const run = swarm.getRun(thread.current_run_id, { tenantId: 'tenant-a' });
  const persona = run.analyses.find((a) => a.agent_id === agentId);
  assert.ok(persona, 'la persona a participé');
  assert.equal(persona.disc_type, 'D');
  assert.equal(persona.persona_confidence.kind, 'crystalknows');
  assert.match(persona.simulated_stakeholder_feedback, /^Simulation — .*quel gain, et pour quand \?/);
  assert.equal(run.analyses.find((a) => a.agent_id === 'cfo').persona_confidence, undefined);

  // Ré-enrichissement de l'agent existant avec des e-mails : la fiche Crystal reste la référence.
  const again = await app.inject({ method: 'POST', url: `/v1/console/agents/${agentId}/enrich`, payload: { consent_confirmed: true, crystal_public_html: html, emails: ['Go.', 'On tranche.', 'Fais court.'] } });
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(again.json().confidence.kind, 'crystalknows');
  assert.ok(again.json().agent.human_profile.profile_sources.some((s) => s.source === 'email'));
  assert.equal((await app.inject({ method: 'POST', url: '/v1/console/agents/inconnu/enrich', payload: { consent_confirmed: true, emails: ['a'] } })).statusCode, 404);
});

test('équipe : plusieurs profils enrichis dans un collectif ; estimation jamais présentée comme CrystalKnows', async (t) => {
  const { app, swarm, hybridGateway } = await buildApp();
  t.after(() => app.close());
  const est = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { consent_confirmed: true, assigned_name: 'Camille', emails: ['Bonjour, je pense que peut-être nous pourrions attendre.', 'Bonjour à tous, merci pour votre patience.', 'Bonjour, il me semble que l’équipe a besoin de temps.'] } });
  assert.equal(est.statusCode, 200, est.body);
  assert.equal(est.json().confidence.kind, 'estimate');
  assert.ok(est.json().confidence.confidence <= 0.6);
  const crystal = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { consent_confirmed: true, crystal_public_html: html } });
  const team = await app.inject({ method: 'POST', url: '/v1/console/impersonator-teams', payload: { name: 'Panel', consent_confirmed: true, members: [
    { name: 'Camille', source: 'enriched', human_profile: est.json().profile },
    { name: 'Geoffroy', source: 'enriched', human_profile: crystal.json().profile },
  ] } });
  assert.equal(team.statusCode, 201, team.body);
  assert.equal(team.json().agents.length, 2);
  const mission = await app.inject({ method: 'POST', url: `/v1/console/sessions/${team.json().session.session_id}/run`, payload: { question: 'Changer d’outil CRM' } });
  const thread = await hybridGateway.waitForThread(mission.json().thread_id);
  const run = swarm.getRun(thread.current_run_id, { tenantId: 'tenant-a' });
  const kinds = run.analyses.map((a) => a.persona_confidence.kind).sort();
  assert.deepEqual(kinds, ['crystalknows', 'estimate']);
  const camille = run.analyses.find((a) => a.persona_confidence.kind === 'estimate');
  assert.match(camille.persona_confidence.label, /pas une fiche CrystalKnows/);
});

test('chemin privé CrystalKnows : export JSON accepté, API sans jeton refusée', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const exp = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { consent_confirmed: true, crystal_export: { data: { first_name: 'Paul', last_name: 'Jones', personalities: { disc_type: 'Cs' } } } } });
  assert.equal(exp.statusCode, 200, exp.body);
  assert.equal(exp.json().confidence.kind, 'crystalknows');
  const api = await app.inject({ method: 'POST', url: '/v1/console/personality/enrich', payload: { consent_confirmed: true, crystal_api: { email: 'p@x.com' } } });
  assert.equal(api.statusCode, 503);
  assert.match(api.json().error, /CRYSTALKNOWS_API_TOKEN/);
});
