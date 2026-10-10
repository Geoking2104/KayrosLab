import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import consoleRoute from '../routes/console.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { ConnectorConfigurationService, InMemoryConnectorConfigStore } from '../../../core/connector-config.mjs';

async function buildApp({ role = 'contributeur', crystal = false, profileImporter = null, tenantId = 'tenant-a', user = null } = {}) {
  const swarm = new SwarmService(profileImporter ? { profileImporter } : {});
  const hybridGateway = new HybridAgentGateway({ swarm });
  const connectorConfig = new ConnectorConfigurationService({ store: new InMemoryConnectorConfigStore() });
  const app = Fastify();
  app.decorate('kayrosContext', { hybridGateway, connectorConfig, engine: { swarm }, crystalKnowsConfigured: crystal, connectorEncryptionConfigured: false });
  app.decorate('requireAuth', async () => (user ? { ...user } : { sub: 'u1', email: 'user@kayros.test', role, tenantId }));
  await app.register(consoleRoute);
  return { app, swarm };
}

test('nouvelle session : un contributeur ajuste un agent proposé et compose son propre agent', async (t) => {
  const { app, swarm } = await buildApp();
  t.after(() => app.close());
  const created = await app.inject({ method: 'POST', url: '/v1/console/sessions', payload: {
    name: 'Comité produit', active_agents: ['cfo'], voting_threshold: 'unanimous',
    agent_overrides: { cfo: { display_name: 'DAF', veto_power: true, added_rules: ['Exiger un plan de financement.'], behavioral_profile: { risk_appetite: 'prudent' } } },
    custom_agents: [{ display_name: 'Léa Growth', role_name: 'Growth Lead', department: 'Marketing', mission: 'Tester la traction.', behavioral_profile: { disc_type: 'I', tone: 'enthousiaste' }, rules: ['Chiffrer le CAC.'] }],
  } });
  assert.equal(created.statusCode, 201, created.body);
  const collective = created.json().session.collective;
  assert.equal(collective.voting_threshold, 'unanimous');
  assert.equal(collective.agents.length, 2);
  const [cfo, own] = collective.agents;
  assert.equal(cfo.display_name, 'DAF');
  assert.equal(cfo.veto_power, true);
  assert.equal(cfo.session_override, true);
  assert.equal(own.session_scoped, true);
  assert.match(own.agent_id, /^lea_growth_[a-z0-9]{1,4}$/);
  // Le registre du tenant reste intact (aucune fuite vers d'autres utilisateurs).
  assert.equal(swarm.registry.get('cfo', { tenantId: 'tenant-a' }).display_name, 'Chief Financial Officer');
  assert.equal(swarm.registry.get(own.agent_id, { tenantId: 'tenant-a' }), null);
  const config = swarm.getConfiguration(collective.swarm_id, { tenantId: 'tenant-a' });
  assert.match(swarm.effectiveConfigurationAgent(config, own.agent_id, { tenantId: 'tenant-a' }).rule_configuration.user_added_rules[0].rule_text, /CAC/);
});

test('nouvelle session : collectif par défaut si aucun agent fourni, refus d’un collectif vide', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const defaults = await app.inject({ method: 'POST', url: '/v1/console/sessions', payload: { name: 'Défaut' } });
  assert.equal(defaults.statusCode, 201);
  assert.deepEqual(defaults.json().session.collective.active_agents, ['cfo', 'cto', 'legal_counsel']);
  const empty = await app.inject({ method: 'POST', url: '/v1/console/sessions', payload: { name: 'Vide', active_agents: [] } });
  assert.equal(empty.statusCode, 400);
});

test('import de profils réels : aperçu DISC / export puis ajout au comité existant', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const disc = await app.inject({ method: 'POST', url: '/v1/console/personality/preview', payload: { consent_confirmed: true, source: 'disc', disc_type: 'dc', assigned_name: 'Claire Martin' } });
  assert.equal(disc.statusCode, 200, disc.body);
  assert.equal(disc.json().profile.disc_type, 'Dc');
  assert.equal(disc.json().agent.display_name, 'Claire Martin');
  assert.equal(disc.json().agent.behavioral_profile.disc_type, 'Dc');

  const exported = await app.inject({ method: 'POST', url: '/v1/console/personality/preview', payload: { consent_confirmed: true, source: 'export', profile_data: {
    data: { id: 'p1', first_name: 'Paul', last_name: 'Jones', personalities: { disc_type: 'Di', behavioral_traits: { risk_aversion: 80, skepticism: 70, pace: 40 } } },
  } } });
  assert.equal(exported.statusCode, 200, exported.body);
  const { profile, agent } = exported.json();
  assert.equal(agent.behavioral_profile.risk_appetite, 'prudent');
  assert.equal(profile.profile_sources[0].source, 'crystalknows');

  // Sans consentement : refus.
  const refused = await app.inject({ method: 'POST', url: '/v1/console/personality/preview', payload: { source: 'disc', disc_type: 'D' } });
  assert.equal(refused.statusCode, 400);
  // L'API Crystal (crédits) est réservée à comex/admin.
  const api = await app.inject({ method: 'POST', url: '/v1/console/personality/preview', payload: { consent_confirmed: true, source: 'crystalknows', email: 'pjones@crystalknows.com' } });
  assert.equal(api.statusCode, 403);

  const session = await app.inject({ method: 'POST', url: '/v1/console/sessions', payload: { name: 'COMEX', active_agents: ['cfo', 'cto'] } });
  const sessionId = session.json().session.session_id;
  const added = await app.inject({ method: 'PATCH', url: `/v1/console/sessions/${sessionId}/collective`, payload: {
    add_custom_agents: [{ ...agent, human_profile: profile }],
  } });
  assert.equal(added.statusCode, 200, added.body);
  const agents = added.json().session.collective.agents;
  assert.equal(agents.length, 3);
  assert.equal(agents[2].hybrid, true);
  assert.equal(agents[2].disc_type, 'Di');

  const noConsent = await app.inject({ method: 'PATCH', url: `/v1/console/sessions/${sessionId}/collective`, payload: {
    add_custom_agents: [{ ...agent, human_profile: { ...profile, consent_confirmed: false, profile_sources: [] } }],
  } });
  assert.equal(noConsent.statusCode, 400);
});

test('import Crystal via l’API (comex) et comité construit avec plusieurs profils réels', async (t) => {
  const calls = [];
  const profileImporter = { importProfile: async (input) => { calls.push(input); return { assigned_name: input.full_name || 'Paul Jones', disc_type: 'C', consent_confirmed: true, profile_sources: [{ source: 'crystalknows', consent_confirmed: true }] }; } };
  const { app } = await buildApp({ role: 'comex', crystal: true, profileImporter });
  t.after(() => app.close());
  const one = await app.inject({ method: 'POST', url: '/v1/console/personality/preview', payload: { consent_confirmed: true, source: 'crystalknows', full_name: 'Ana Ruiz', company_name: 'Acme', job_title: 'VP Procurement' } });
  assert.equal(one.statusCode, 200, one.body);
  assert.equal(calls[0].company_name, 'Acme');
  assert.equal(one.json().agent.role_name, 'VP Procurement');
  assert.equal(one.json().agent.seniority, 'executive');
  const two = await app.inject({ method: 'POST', url: '/v1/console/personality/preview', payload: { consent_confirmed: true, source: 'crystalknows', email: 'pjones@crystalknows.com' } });
  const members = [one.json(), two.json()].map(({ agent, profile }) => ({ ...agent, human_profile: profile }));
  const committee = await app.inject({ method: 'POST', url: '/v1/console/sessions', payload: { name: 'Panel acheteurs', voting_threshold: 'majority', custom_agents: members } });
  assert.equal(committee.statusCode, 201, committee.body);
  const collective = committee.json().session.collective;
  assert.equal(collective.agents.length, 2);
  assert.equal(collective.personality_simulation_enabled, true);
});

const REAL_PROFILE = { consent_confirmed: true, assigned_name: 'Paul Jones', disc_type: 'C', behavioral_traits: { risk_aversion: 83 } };
async function sessionWithOwnAgents(app) {
  const created = await app.inject({ method: 'POST', url: '/v1/console/sessions', payload: {
    name: 'Comité', active_agents: ['cfo'],
    agent_overrides: { cfo: { display_name: 'DAF prudent', veto_power: true } },
    custom_agents: [
      { agent_id: 'growth_lead', display_name: 'Growth', role_name: 'Growth Lead', department: 'Marketing', mission: 'Tester la traction.', rules: ['Chiffrer le CAC.'] },
      { agent_id: 'paul_jones', display_name: 'Paul Jones', role_name: 'Analyste', department: 'Finance', mission: 'Réagir comme Paul Jones : vérifier les chiffres.', instructions: 'Parler comme paul jones.', behavioral_profile: { disc_type: 'C' }, human_profile: REAL_PROFILE },
    ],
  } });
  assert.equal(created.statusCode, 201, created.body);
  return created.json().session.session_id;
}

test('registre : un contributeur ne peut pas publier un agent de session', async (t) => {
  const { app, swarm } = await buildApp();
  t.after(() => app.close());
  const overview = await app.inject({ method: 'GET', url: '/v1/console/overview' });
  if (overview.statusCode === 200) assert.equal(overview.json().capabilities.registry_promotion.allowed, false);
  const sessionId = await sessionWithOwnAgents(app);
  const res = await app.inject({ method: 'POST', url: `/v1/console/sessions/${sessionId}/agents/growth_lead/promote`, payload: {} });
  assert.equal(res.statusCode, 403);
  assert.equal(swarm.registry.get('growth_lead', { tenantId: 'tenant-a' }), null);
});

test('registre : comex/admin publie un agent composé, un ajustement et un profil réel consenti', async (t) => {
  const { app, swarm } = await buildApp({ role: 'admin' });
  t.after(() => app.close());
  const sessionId = await sessionWithOwnAgents(app);
  const url = (id) => `/v1/console/sessions/${sessionId}/agents/${id}/promote`;

  const own = await app.inject({ method: 'POST', url: url('growth_lead'), payload: {} });
  assert.equal(own.statusCode, 201, own.body);
  const saved = swarm.registry.get('growth_lead', { tenantId: 'tenant-a' });
  assert.equal(saved.agent_type, 'user_defined');
  assert.equal(saved.metadata.session_scoped, undefined);
  assert.equal(saved.metadata.promoted_from_session.agent_id, 'growth_lead');
  assert.match(saved.rule_configuration.user_added_rules[0].rule_text, /CAC/);
  // La session référence désormais l'agent du registre (plus de copie locale).
  const growth = own.json().session.collective.agents.find((agent) => agent.agent_id === 'growth_lead');
  assert.equal(growth.session_scoped, false);
  assert.equal((await app.inject({ method: 'POST', url: url('growth_lead'), payload: {} })).statusCode, 409);

  const variant = await app.inject({ method: 'POST', url: url('cfo'), payload: {} });
  assert.equal(variant.statusCode, 201, variant.body);
  assert.equal(variant.json().agent.agent_id, 'cfo_variante');
  assert.equal(swarm.registry.get('cfo_variante', { tenantId: 'tenant-a' }).display_name, 'DAF prudent');
  assert.equal(swarm.registry.get('cfo', { tenantId: 'tenant-a' }).display_name, 'Chief Financial Officer');

  const noConsent = await app.inject({ method: 'POST', url: url('paul_jones'), payload: {} });
  assert.equal(noConsent.statusCode, 400);
  assert.equal(noConsent.json().code, 'share_consent_required');
  const real = await app.inject({ method: 'POST', url: url('paul_jones'), payload: { share_consent_confirmed: true } });
  assert.equal(real.statusCode, 201, real.body);
  assert.equal(swarm.registry.get('paul_jones', { tenantId: 'tenant-a' }).human_profile.disc_type, 'C');
});

test('registre : tenant partagé (libre-service) — profil réel refusé, attributs seuls acceptés', async (t) => {
  const { app, swarm } = await buildApp({ role: 'comex', tenantId: 'default' });
  t.after(() => app.close());
  const sessionId = await sessionWithOwnAgents(app);
  const url = `/v1/console/sessions/${sessionId}/agents/paul_jones/promote`;
  const refused = await app.inject({ method: 'POST', url, payload: { share_consent_confirmed: true } });
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().code, 'shared_tenant_real_profile');
  assert.equal(swarm.registry.get('paul_jones', { tenantId: 'default' }), null);
  const stripped = await app.inject({ method: 'POST', url, payload: { include_human_profile: false, agent_id: 'analyste_c', display_name: 'Analyste rigoureux' } });
  assert.equal(stripped.statusCode, 201, stripped.body);
  const saved = swarm.registry.get('analyste_c', { tenantId: 'default' });
  assert.equal(saved.human_profile ?? null, null);
  assert.equal(saved.display_name, 'Analyste rigoureux');
  assert.equal(saved.behavioral_profile.disc_type, 'C');
  // Aucune trace du nom de la personne importée.
  assert.doesNotMatch(JSON.stringify(saved), /paul jones/i);
  assert.match(saved.mission, /Réagir comme Analyste rigoureux/);
});
