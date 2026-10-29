import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import consoleRoute from '../routes/console.mjs';
import consoleWorkspaceRoute from '../routes/console-workspace.mjs';
import authRoutes from '../routes/auth-routes.mjs';
import publicApiRoutes from '../routes/public-api.mjs';
import { HybridAgentGateway, SwarmService } from '../../../core/index.mjs';
import { AuthService, InMemoryUserStore } from '../../../core/auth.mjs';
import { WorkspaceStore } from '../lib/workspace-store.mjs';
import { agentNodesFor, gatesAfter, pipelineSteps } from '../lib/project-pipeline.mjs';
import { startChatMission } from '../lib/chat-handlers.mjs';
import { ChatReplyService } from '../../../core/chat-replies.mjs';
import { linkedChatRole, memberRole } from '../lib/workspace-roles.mjs';

async function buildApp(user = { email: 'owner@kayros.test', role: 'comex' }, extra = {}) {
  const swarm = new SwarmService();
  const hybridGateway = new HybridAgentGateway({ swarm });
  const app = Fastify();
  app.decorate('kayrosContext', { hybridGateway, engine: { swarm }, workspaceStore: new WorkspaceStore({ file: 'memory' }), ...extra });
  const current = { sub: 'u1', tenantId: 'tenant-a', ...user };
  app.decorate('requireAuth', async () => current);
  await app.register(consoleRoute);
  await app.register(consoleWorkspaceRoute);
  return { app, current };
}
const session = async (app, name, agents) => (await app.inject({ method: 'POST', url: '/v1/console/sessions', payload: { name, active_agents: agents } })).json().session.session_id;
async function waitPipeline(app, id, done = (p) => p.status !== 'running') {
  for (let i = 0; i < 200; i += 1) {
    const p = (await app.inject({ url: `/v1/console/pipelines/${id}` })).json().pipeline;
    if (done(p)) return p;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('enchaînement non terminé');
}

test('graphe : étapes, agents rattachés et portes de sortie', () => {
  const g = {
    nodes: [{ id: 'q', type: 'question' }, { id: 'c2', type: 'collectif', config: { session_id: 's2' } }, { id: 'c1', type: 'collectif', config: { session_id: 's1' } },
      { id: 'a', type: 'agent', config: { agent_id: 'planner' } }, { id: 'x', type: 'agent', config: { agent_id: 'cto', exclude: true } },
      { id: 'p1', type: 'porte' }, { id: 'p2', type: 'porte' }],
    edges: [{ from: 'q', to: 'c1' }, { from: 'a', to: 'c1' }, { from: 'c1', to: 'x' }, { from: 'c1', to: 'p1' }, { from: 'p1', to: 'c2' }, { from: 'c2', to: 'p2' }],
  };
  assert.deepEqual(pipelineSteps(g).map((n) => n.id), ['c1', 'c2']);
  assert.deepEqual(agentNodesFor(g, 'c1'), { add: ['planner'], remove: ['cto'] });
  assert.deepEqual(gatesAfter(g, 'c1').map((n) => n.id), ['p1'], 'la porte de c2 ne bloque pas c1');
});

test('enchaînement : deux collectifs en séquence, agents du graphe appliqués, verdict transmis', async (t) => {
  const { app } = await buildApp();
  t.after(() => app.close());
  const s1 = await session(app, 'Finance', ['cfo', 'cto']);
  const s2 = await session(app, 'Juridique', ['legal_counsel']);
  const co = (await app.inject({ method: 'POST', url: '/v1/console/companies', payload: { name: 'Atelier' } })).json().item;
  const graph = {
    nodes: [{ id: 'q', type: 'question' }, { id: 'c1', type: 'collectif', label: 'Finance', config: { session_id: s1 } },
      { id: 'ag', type: 'agent', config: { agent_id: 'planner' } }, { id: 'ex', type: 'agent', config: { agent_id: 'cto', exclude: true } },
      { id: 'p', type: 'porte', config: { threshold: 'majority' } }, { id: 'c2', type: 'collectif', label: 'Juridique', config: { session_id: s2 } }, { id: 'd', type: 'decision' }],
    edges: [{ from: 'q', to: 'c1' }, { from: 'ag', to: 'c1' }, { from: 'ex', to: 'c1' }, { from: 'c1', to: 'p' }, { from: 'p', to: 'c2' }, { from: 'c2', to: 'd' }],
  };
  const project = (await app.inject({ method: 'POST', url: '/v1/console/projects', payload: { company_id: co.id, name: 'Helia', session_ids: [s1, s2], graph } })).json().item;
  const res = await app.inject({ method: 'POST', url: `/v1/console/projects/${project.id}/pipelines`, payload: { question: 'Faut-il signer le contrat Helia ?', profile: 'demo' } });
  assert.equal(res.statusCode, 202, res.body);
  const started = res.json().pipeline;
  assert.deepEqual(started.steps[0].agents, { added: ['planner'], removed: ['cto'], error: null });
  const done = await waitPipeline(app, started.id);
  assert.equal(done.status, 'completed', JSON.stringify(done));
  assert.deepEqual(done.steps.map((s) => s.status), ['completed', 'completed']);
  assert.ok(done.steps[1].thread_id && done.steps[1].thread_id !== done.steps[0].thread_id);
  const s1view = (await app.inject({ url: `/v1/console/sessions/${s1}` })).json().session;
  const agents = JSON.stringify(s1view);
  assert.match(agents, /planner/); 
  const t2 = await app.kayrosContext.hybridGateway.getThread(done.steps[1].thread_id, { tenantId: 'tenant-a' });
  assert.equal(t2.room_id, s2);
  assert.match(JSON.stringify(t2), /Étape 1 « Finance » : verdict/, 'le verdict de l’étape 1 est dans le contexte de l’étape 2');
  const list = (await app.inject({ url: `/v1/console/projects/${project.id}/pipelines` })).json().pipelines;
  assert.equal(list.length, 1);
});

test('enchaînement : une porte bloque, un comex la lève avec un motif', async (t) => {
  const { app, current } = await buildApp();
  t.after(() => app.close());
  const s1 = await session(app, 'Finance', ['cfo', 'cto', 'legal_counsel']);
  const s2 = await session(app, 'Juridique', ['legal_counsel']);
  const co = (await app.inject({ method: 'POST', url: '/v1/console/companies', payload: { name: 'Atelier' } })).json().item;
  const graph = { nodes: [{ id: 'c1', type: 'collectif', config: { session_id: s1 } }, { id: 'p', type: 'porte', config: { min_go: 50, strict: true } }, { id: 'c2', type: 'collectif', config: { session_id: s2 } }],
    edges: [{ from: 'c1', to: 'p' }, { from: 'p', to: 'c2' }] };
  const project = (await app.inject({ method: 'POST', url: '/v1/console/projects', payload: { company_id: co.id, name: 'Helia', session_ids: [s1, s2], graph } })).json().item;
  const started = (await app.inject({ method: 'POST', url: `/v1/console/projects/${project.id}/pipelines`, payload: { question: 'Remise de 18 % ?', profile: 'demo' } })).json().pipeline;
  const blocked = await waitPipeline(app, started.id);
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.steps[1].status, 'pending');
  assert.equal(blocked.steps[0].gates[0].status, 'blocked');
  assert.equal((await app.inject({ method: 'POST', url: `/v1/console/projects/${project.id}/pipelines`, payload: { question: 'x?' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `/v1/console/pipelines/${started.id}/resume`, payload: {} })).statusCode, 400);
  current.role = 'contributeur';
  assert.equal((await app.inject({ method: 'POST', url: `/v1/console/pipelines/${started.id}/resume`, payload: { justification: 'Risque accepté' } })).statusCode, 403);
  current.role = 'comex';
  const resumed = await app.inject({ method: 'POST', url: `/v1/console/pipelines/${started.id}/resume`, payload: { justification: 'Risque accepté' } });
  assert.equal(resumed.statusCode, 200, resumed.body);
  const done = await waitPipeline(app, started.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.steps[0].status, 'overridden');
  assert.equal(done.steps[0].override.by, 'owner@kayros.test');
});

test('rôle lecteur : enchaînement, chat et API publique refusés', async (t) => {
  const users = new InMemoryUserStore();
  const links = new Map();
  const linkService = { get: async (id) => links.get(id) || null };
  const { app, current } = await buildApp({ email: 'owner@kayros.test', role: 'comex' }, { userStore: users, linkService });
  t.after(() => app.close());
  const ctx = app.kayrosContext;
  await ctx.workspaceStore.create('tenant-a', 'members', { email: 'lea@kayros.test', role: 'lecteur', status: 'active' });
  const lea = await users.create({ id: 'u-lea', email: 'lea@kayros.test', role: 'comex', tenantId: 'tenant-a', passwordHash: 'x' });
  links.set('slack:ULEA', { kayrosUserId: lea.id, tenantId: 'tenant-a', role: 'comex' });
  links.set('slack:UBOB', { tenantId: 'tenant-a', email: 'bob@kayros.test', role: 'contributeur' });
  // Le compte est comex mais la fiche membre lecteur prime.
  assert.equal((await linkedChatRole(ctx, 'slack:ULEA')).role, 'lecteur');
  assert.equal(await linkedChatRole(ctx, 'slack:UNKNOWN'), null);
  await assert.rejects(startChatMission(ctx, { platform: 'slack', channelId: 'C1', userId: 'slack:ULEA', text: 'question ?' }), /rôle lecteur/);
  // Arbitrage depuis le chat : la fiche membre s'applique aussi.
  const replies = new ChatReplyService({ gateway: ctx.hybridGateway, linkService, users, resolveRole: async ({ tenantId, email, role }) => (await memberRole(ctx, { tenantId, email, accountRole: role })).role });
  ctx.hybridGateway.getThread = async () => ({ thread_id: 't1', room_id: 'r1', status: 'awaiting_human_arbitration', messages: [] });
  ctx.hybridGateway.getRoom = async () => ({ room_id: 'r1', platform: 'slack' });
  const denied = await replies.arbitrate({ platform: 'slack', platformUserId: 'slack:ULEA', threadId: 't1', action: 'accept_consensus' });
  assert.equal(denied.code, 'forbidden');
  // Pipeline : 403 pour un lecteur.
  current.email = 'lea@kayros.test';
  assert.equal((await app.inject({ method: 'POST', url: '/v1/console/projects/prj_x/pipelines', payload: { question: 'Signer ?' } })).statusCode, 403);
});

test('API publique : une clé créée par un membre devenu lecteur ne lance plus de mission', async (t) => {
  const app = Fastify();
  const workspaceStore = new WorkspaceStore({ file: 'memory' });
  const principal = { kind: 'api_key', sub: 'svc:tenant-a:crm', email: 'crm@service.kayroslab.local', role: 'service', tenantId: 'tenant-a', keyId: 'k1', serviceAccount: 'crm', scopes: ['missions:write', 'missions:read'], collectiveIds: [], createdBy: 'lea@kayros.test' };
  app.decorate('kayrosContext', { workspaceStore, apiKeys: { authenticate: async () => principal }, publicMissions: {}, hybridGateway: {}, engine: { swarm: {} } });
  await app.register(publicApiRoutes);
  t.after(() => app.close());
  await workspaceStore.create('tenant-a', 'members', { email: 'lea@kayros.test', role: 'lecteur', status: 'active' });
  const res = await app.inject({ method: 'POST', url: '/v1/public/missions', headers: { authorization: 'Bearer kl_x', 'idempotency-key': 'k-1' }, payload: { collective_id: 'r1', question: 'Signer ?' } });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().code, 'creator_read_only');
});

test('invitation : lien à jeton, création du compte dans l’espace de l’invitant, activation', async (t) => {
  const users = new InMemoryUserStore();
  const auth = new AuthService({ users, secret: 'test-secret-for-invite-flow-1234567890' });
  const sent = [];
  const { app } = await buildApp({ email: 'admin@kayros.test', role: 'comex' }, { userStore: users, auth, consoleUrl: 'https://kayros.test/console', contactMailer: { sendMail: async (m) => { sent.push(m); } } });
  await app.register(authRoutes);
  t.after(() => app.close());
  await app.kayrosContext.workspaceStore.create('tenant-a', 'members', { email: 'admin@kayros.test', role: 'admin', status: 'active' });
  const inv = await app.inject({ method: 'POST', url: '/v1/console/members/invite', payload: { email: 'nina@kayros.test', name: 'Nina', role: 'lecteur' } });
  assert.equal(inv.statusCode, 201, inv.body);
  assert.equal(inv.json().item.invite_token_sha256, undefined, 'empreinte jamais exposée');
  const url = inv.json().invite_url;
  assert.match(url, /^https:\/\/kayros\.test\/console\/\?invite=/);
  assert.ok(sent[0].text.includes(url));
  const token = new URL(url).searchParams.get('invite');
  const info = await app.inject({ url: `/v1/auth/invite/${token}` });
  assert.deepEqual({ ...info.json() }, { email: 'nina@kayros.test', name: 'Nina', role: 'lecteur', invited_by: 'admin@kayros.test', account_exists: false });
  assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/invite/accept', payload: { token, password: 'court' } })).statusCode, 400);
  const accepted = await app.inject({ method: 'POST', url: '/v1/auth/invite/accept', payload: { token, password: 'motdepasse-solide' } });
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.ok(accepted.json().token);
  assert.equal(accepted.json().account_created, true);
  const user = await users.findByEmail('nina@kayros.test');
  assert.equal(user.tenantId, 'tenant-a', 'compte créé dans l’espace de l’invitant');
  assert.equal(user.role, 'contributeur');
  const member = (await app.inject({ url: '/v1/console/members' })).json().members.find((m) => m.email === 'nina@kayros.test');
  assert.equal(member.status, 'active');
  assert.equal(member.invite_token_sha256, undefined);
  // Jeton à usage unique.
  assert.equal((await app.inject({ url: `/v1/auth/invite/${token}` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: '/v1/auth/invite/accept', payload: { token, password: 'motdepasse-solide' } })).statusCode, 404);
});
