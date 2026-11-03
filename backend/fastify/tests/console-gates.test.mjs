import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import consoleRoute from '../routes/console.mjs';
import consoleWorkspaceRoute from '../routes/console-workspace.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { WorkspaceStore } from '../lib/workspace-store.mjs';
import { evaluateGate, gatesForSession } from '../lib/project-gates.mjs';

// Utilisateur courant modifiable pendant le test (changement de membre).
async function buildApp(user = { email: 'owner@kayros.test', role: 'comex' }) {
  const swarm = new SwarmService();
  const hybridGateway = new HybridAgentGateway({ swarm });
  const app = Fastify();
  app.decorate('kayrosContext', { hybridGateway, engine: { swarm }, workspaceStore: new WorkspaceStore({ file: 'memory' }) });
  const current = { sub: 'u1', tenantId: 'tenant-a', ...user };
  app.decorate('requireAuth', async () => current);
  await app.register(consoleRoute);
  await app.register(consoleWorkspaceRoute);
  return { app, current };
}

const graph = (gate) => ({
  nodes: [
    { id: 'q', type: 'question' }, { id: 'c', type: 'collectif', config: {} },
    { id: 'p', type: 'porte', label: 'Porte finance', config: gate }, { id: 'a', type: 'arbitrage' },
  ],
  edges: [{ from: 'q', to: 'c' }, { from: 'c', to: 'p' }, { from: 'p', to: 'a' }],
});

async function projectWithMission(app, gate, stakeholders = []) {
  const co = (await app.inject({ method: 'POST', url: '/v1/console/companies', payload: { name: 'Atelier' } })).json().item;
  const sessionId = (await app.inject({ method: 'POST', url: '/v1/console/sessions', payload: { name: 'COMEX', active_agents: ['cfo', 'cto', 'legal_counsel'] } })).json().session.session_id;
  const project = (await app.inject({ method: 'POST', url: '/v1/console/projects', payload: { company_id: co.id, name: 'Helia', session_ids: [sessionId], graph: graph(gate), stakeholders } })).json().item;
  const run = await app.inject({ method: 'POST', url: `/v1/console/sessions/${sessionId}/run?wait=1`, payload: { question: 'Faut-il accepter une remise de 18 % contre 24 mois ?', profile: 'demo' } });
  assert.equal(run.statusCode, 200);
  return { project, sessionId, thread: run.json().thread };
}

test('évaluation d’une porte : seuil, unanimité, veto, mode strict', () => {
  const analyses = [
    { agent_id: 'cfo', verdict: 'GO' }, { agent_id: 'cto', verdict: 'CONDITIONAL_GO' },
    { agent_id: 'risk', verdict: 'NO_GO', veto_power: true, seniority: 'executive' },
  ];
  assert.equal(evaluateGate({ id: 'p', config: { threshold: 'majority' } }, analyses).status, 'passed');
  assert.equal(evaluateGate({ id: 'p', config: { threshold: 'unanimous' } }, analyses).status, 'blocked');
  assert.equal(evaluateGate({ id: 'p', config: { threshold: 'veto_csuite' } }, analyses).status, 'blocked');
  assert.equal(evaluateGate({ id: 'p', config: { min_go: 60 } }, analyses).status, 'passed');
  assert.equal(evaluateGate({ id: 'p', config: { min_go: 70 } }, analyses).status, 'blocked');
  const veto = evaluateGate({ id: 'p', config: { veto: true } }, analyses);
  assert.equal(veto.status, 'blocked');
  assert.match(veto.reasons.join(), /veto exercé \(risk\)/);
  assert.equal(evaluateGate({ id: 'p', config: { strict: true } }, analyses).status, 'blocked', 'strict : 1 GO franc sur 3');
  assert.equal(evaluateGate({ id: 'p', config: {} }, []).status, 'pending');
  // Seules les portes en aval du collectif de la session s'appliquent.
  const g = { nodes: [{ id: 'c1', type: 'collectif', config: { session_id: 's1' } }, { id: 'c2', type: 'collectif', config: { session_id: 's2' } }, { id: 'p1', type: 'porte' }, { id: 'p2', type: 'porte' }], edges: [{ from: 'c1', to: 'p1' }, { from: 'c2', to: 'p2' }] };
  assert.deepEqual(gatesForSession(g, 's1').map((n) => n.id), ['p1']);
});

test('une porte bloquante du graphe pilote l’arbitrage', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  // Le collectif de démonstration rend trois GO sous conditions : la porte stricte à 50 % bloque.
  const { thread } = await projectWithMission(app, { threshold: 'majority', min_go: 50, strict: true });
  assert.equal(thread.gate_evaluation.status, 'blocked');
  assert.equal(thread.gate_evaluation.verdict, 'NO_GO');
  assert.equal(thread.gate_evaluation.consensus_verdict, 'CONDITIONAL_GO');
  const read = (await app.inject({ url: `/v1/console/threads/${thread.thread_id}` })).json().thread;
  assert.equal(read.gate_evaluation.results[0].gate_id, 'p');
  const accept = await app.inject({ method: 'POST', url: `/v1/console/threads/${thread.thread_id}/arbitrate`, payload: { action: 'accept_consensus' } });
  assert.equal(accept.statusCode, 409);
  assert.equal(accept.json().code, 'gate_blocked');
  const override = await app.inject({ method: 'POST', url: `/v1/console/threads/${thread.thread_id}/arbitrate`, payload: { action: 'override_veto', decision: 'CONDITIONAL_GO', justification: 'Risque accepté par le COMEX' } });
  assert.equal(override.statusCode, 200);
});

test('une porte satisfaite laisse accepter le consensus', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const { thread } = await projectWithMission(app, { threshold: 'majority', min_go: 60 });
  assert.equal(thread.gate_evaluation.status, 'passed');
  const accept = await app.inject({ method: 'POST', url: `/v1/console/threads/${thread.thread_id}/arbitrate`, payload: { action: 'accept_consensus' } });
  assert.equal(accept.statusCode, 200);
});

test('bout en bout : l’arbitrage envoie la décision aux « informés »', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const mails = [];
  app.kayrosContext.contactMailer = { sendMail: async (m) => { mails.push(m); } };
  app.kayrosContext.smtp = { from: 'kayros@test' };
  const { project, thread } = await projectWithMission(app, { threshold: 'majority' }, [
    { name: 'Léa', role: 'informe', email: 'lea@atelier.fr' }, { name: 'Camille', role: 'decideur', email: 'c@atelier.fr' },
  ]);
  const arb = await app.inject({ method: 'POST', url: `/v1/console/threads/${thread.thread_id}/arbitrate`, payload: { action: 'accept_consensus', justification: 'Marge préservée' } });
  assert.equal(arb.statusCode, 200);
  assert.deepEqual(mails.map((m) => m.to), ['lea@atelier.fr'], 'seuls les informés reçoivent la décision');
  assert.match(mails[0].subject, /Helia/);
  assert.match(mails[0].text, /Faut-il accepter une remise[\s\S]*Justification : Marge préservée/);
  const log = (await app.inject({ url: `/v1/console/projects/${project.id}/notifications` })).json().notifications;
  assert.deepEqual(log.map((n) => [n.to, n.status, n.reason, n.thread_id]), [['lea@atelier.fr', 'sent', 'arbitrage', thread.thread_id]]);
});

test('sans SMTP : file explicite, puis relance une fois le SMTP configuré', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const { project, thread } = await projectWithMission(app, {}, [{ name: 'Léa', role: 'informe', email: 'lea@atelier.fr' }]);
  assert.equal((await app.inject({ url: '/v1/console/mail/status' })).json().smtp, false);
  await app.inject({ method: 'POST', url: `/v1/console/threads/${thread.thread_id}/arbitrate`, payload: { action: 'accept_consensus' } });
  assert.equal((await app.inject({ url: `/v1/console/projects/${project.id}/notifications` })).json().notifications[0].status, 'queued');
  const early = await app.inject({ method: 'POST', url: `/v1/console/projects/${project.id}/notifications/retry` });
  assert.equal(early.statusCode, 409);
  assert.equal(early.json().code, 'smtp_missing');
  const mails = [];
  app.kayrosContext.contactMailer = { sendMail: async (m) => { mails.push(m); } };
  const retry = (await app.inject({ method: 'POST', url: `/v1/console/projects/${project.id}/notifications/retry` })).json();
  assert.deepEqual(retry.notifications.map((n) => n.status), ['sent']);
  assert.match(mails[0].text, /Vous êtes informé/);
});

test('lecteur : aucune mission, aucune relance, aucun arbitrage', async (t) => {
  const { app, current } = await buildApp({ email: 'owner@kayros.test', role: 'admin' });
  t.after(() => app.close());
  const sessionId = (await app.inject({ method: 'POST', url: '/v1/console/sessions', payload: { name: 'COMEX', active_agents: ['cfo'] } })).json().session.session_id;
  const run = (await app.inject({ method: 'POST', url: `/v1/console/sessions/${sessionId}/run?wait=1`, payload: { question: 'Lancer la ligne B ?', profile: 'demo' } })).json();
  await app.inject({ method: 'POST', url: '/v1/console/members', payload: { email: 'owner@kayros.test', role: 'admin' } });
  await app.inject({ method: 'POST', url: '/v1/console/members', payload: { email: 'lecteur@kayros.test', role: 'lecteur' } });
  // Le compte « comex » du jeton est lecteur dans l'espace : la fiche membre prime.
  Object.assign(current, { email: 'lecteur@kayros.test', role: 'comex', sub: 'u1' });
  const denied = [
    await app.inject({ method: 'POST', url: `/v1/console/sessions/${sessionId}/run`, payload: { question: 'Encore ?' } }),
    await app.inject({ method: 'POST', url: '/v1/console/sessions', payload: { name: 'Autre' } }),
    await app.inject({ method: 'PATCH', url: `/v1/console/sessions/${sessionId}/collective`, payload: { add_agent_ids: ['cto'] } }),
    await app.inject({ method: 'POST', url: `/v1/console/threads/${run.thread.thread_id}/messages`, payload: { text: 'Précision' } }),
    await app.inject({ method: 'POST', url: `/v1/console/threads/${run.thread.thread_id}/arbitrate`, payload: { action: 'accept_consensus' } }),
  ];
  assert.deepEqual(denied.map((r) => r.statusCode), [403, 403, 403, 403, 403]);
  assert.match(denied[0].json().error, /contributeur/);
  // Il lit toujours.
  assert.equal((await app.inject({ url: `/v1/console/threads/${run.thread.thread_id}` })).statusCode, 200);
  // Un contributeur lance des missions mais n'arbitre pas.
  Object.assign(current, { email: 'autre@kayros.test', role: 'contributeur' });
  assert.equal((await app.inject({ method: 'POST', url: `/v1/console/threads/${run.thread.thread_id}/arbitrate`, payload: { action: 'accept_consensus' } })).statusCode, 403);
});

test('invitation d’un membre par e-mail, activée à sa première connexion', async (t) => {
  const { app, current } = await buildApp({ email: 'owner@kayros.test', role: 'admin' });
  t.after(() => app.close());
  const mails = [];
  app.kayrosContext.contactMailer = { sendMail: async (m) => { mails.push(m); } };
  app.kayrosContext.smtp = { from: 'kayros@test' };
  app.kayrosContext.consoleUrl = 'https://console.test';
  const inv = await app.inject({ method: 'POST', url: '/v1/console/members/invite', payload: { email: 'Nina@Atelier.fr', name: 'Nina', role: 'comex' } });
  assert.equal(inv.statusCode, 201);
  assert.equal(inv.json().item.status, 'invited');
  assert.equal(inv.json().delivery.status, 'sent');
  assert.equal(mails[0].to, 'nina@atelier.fr');
  assert.match(mails[0].text, /rôle « comex »[\s\S]*https:\/\/console\.test/);
  // Relance : même fiche, nouvel envoi.
  assert.equal((await app.inject({ method: 'POST', url: '/v1/console/members/invite', payload: { email: 'nina@atelier.fr', role: 'comex' } })).statusCode, 200);
  assert.equal(mails.length, 2);
  Object.assign(current, { email: 'nina@atelier.fr', role: 'contributeur' });
  const me = (await app.inject({ url: '/v1/console/members/me' })).json();
  assert.equal(me.role, 'comex');
  assert.equal(me.member.status, 'active');
  assert.ok(me.member.joined_at);
  // Membre actif : plus d'invitation, et Nina (comex) ne peut pas inviter.
  assert.equal((await app.inject({ method: 'POST', url: '/v1/console/members/invite', payload: { email: 'x@y.fr' } })).statusCode, 403);
  Object.assign(current, { email: 'owner@kayros.test', role: 'admin' });
  assert.equal((await app.inject({ method: 'POST', url: '/v1/console/members/invite', payload: { email: 'nina@atelier.fr' } })).statusCode, 409);
  // Sans SMTP : invitation en file.
  app.kayrosContext.contactMailer = null;
  assert.equal((await app.inject({ method: 'POST', url: '/v1/console/members/invite', payload: { email: 'z@y.fr' } })).json().delivery.status, 'queued');
});
