import { z } from 'zod';
import { WorkspaceStore } from '../lib/workspace-store.mjs';
import { scopedThreads, accessibleRooms } from './console.mjs';

// Espace de travail de la console : Société → Projets, et Bibliothèque
// (Skills, Sources de contexte) rattachable aux agents et aux collectifs.

const ids = z.array(z.string().min(1).max(120)).max(200);
const companySchema = z.object({
  name: z.string().min(1).max(160), sector: z.string().max(160).optional().default(''),
  description: z.string().max(4000).optional().default(''),
});
// Partie prenante humaine d'un projet (matrice décideur / sponsor / consulté / informé).
export const STAKEHOLDER_ROLES = ['decideur', 'sponsor', 'consulte', 'informe'];
const stakeholderSchema = z.union([
  z.string().min(1).max(200).transform((name) => ({ name, role: 'consulte', title: '', email: '' })),
  z.object({
    name: z.string().min(1).max(200), role: z.enum(STAKEHOLDER_ROLES).optional().default('consulte'),
    title: z.string().max(200).optional().default(''), email: z.string().max(320).optional().default(''),
  }),
]);
// Graphe de projet éditable : nœuds typés, liens orientés, portes configurables.
export const NODE_TYPES = ['question', 'collectif', 'agent', 'porte', 'arbitrage', 'notification', 'decision'];
const nodeSchema = z.object({
  id: z.string().min(1).max(60), type: z.enum(NODE_TYPES), label: z.string().max(200).optional().default(''),
  config: z.object({
    session_id: z.string().max(120).optional(), agent_id: z.string().max(120).optional(),
    threshold: z.enum(['majority', 'unanimous', 'veto_csuite']).optional(), min_go: z.number().min(0).max(100).optional(),
    veto: z.boolean().optional(), role: z.enum(STAKEHOLDER_ROLES).optional(),
  }).optional().default({}),
});
const graphSchema = z.object({
  nodes: z.array(nodeSchema).max(80), edges: z.array(z.object({ from: z.string().max(60), to: z.string().max(60) })).max(200),
}).superRefine((g, ctx) => {
  const ids = new Set();
  for (const n of g.nodes) { if (ids.has(n.id)) ctx.addIssue({ code: 'custom', message: `nœud en double : ${n.id}` }); ids.add(n.id); }
  const seen = new Set();
  for (const e of g.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) ctx.addIssue({ code: 'custom', message: `lien vers un nœud inconnu : ${e.from} → ${e.to}` });
    if (e.from === e.to) ctx.addIssue({ code: 'custom', message: `lien sur lui-même : ${e.from}` });
    const k = `${e.from}>${e.to}`; if (seen.has(k)) ctx.addIssue({ code: 'custom', message: `lien en double : ${k}` }); seen.add(k);
  }
  // Pas de cycle : le graphe se lit de gauche à droite.
  const out = new Map(g.nodes.map((n) => [n.id, g.edges.filter((e) => e.from === n.id).map((e) => e.to)]));
  const state = new Map();
  const visit = (id) => { if (state.get(id) === 1) return true; if (state.get(id) === 2) return false; state.set(id, 1); for (const n of out.get(id) || []) if (visit(n)) return true; state.set(id, 2); return false; };
  if (g.nodes.some((n) => visit(n.id))) ctx.addIssue({ code: 'custom', message: 'le graphe contient une boucle' });
});
const projectSchema = z.object({
  company_id: z.string().min(1).max(120), name: z.string().min(1).max(200),
  goal: z.string().max(4000).optional().default(''), owner: z.string().max(200).optional().default(''),
  status: z.enum(['draft', 'active', 'paused', 'closed']).optional().default('active'),
  due_date: z.string().max(40).optional().default(''),
  session_ids: ids.optional().default([]), thread_ids: ids.optional().default([]),
  stakeholders: z.array(stakeholderSchema).max(50).optional().default([]),
  graph: graphSchema.nullable().optional().default(null),
});
const attachSchema = { agent_ids: ids.optional().default([]), session_ids: ids.optional().default([]) };
const skillSchema = z.object({
  name: z.string().min(1).max(160), description: z.string().max(2000).optional().default(''),
  instructions: z.string().max(8000).optional().default(''),
  tools: z.array(z.string().min(1).max(120)).max(50).optional().default([]), ...attachSchema,
});
const contextSchema = z.object({
  name: z.string().min(1).max(200), kind: z.enum(['note', 'document', 'url', 'policy']).optional().default('note'),
  content: z.string().max(20000).optional().default(''), url: z.string().max(2000).optional().default(''),
  // Cascade société → projet → nœud : la source s'applique au niveau le plus précis renseigné.
  company_id: z.string().max(120).optional().default(''), project_id: z.string().max(120).optional().default(''),
  node_id: z.string().max(60).optional().default(''),
  ...attachSchema,
});
// Membres de l'espace et leurs rôles (remplace le bouton Contributeur / COMEX).
export const MEMBER_ROLES = ['admin', 'comex', 'contributeur', 'lecteur'];
const memberSchema = z.object({
  email: z.string().email().max(320).transform((v) => v.toLowerCase()), name: z.string().max(200).optional().default(''),
  role: z.enum(MEMBER_ROLES).optional().default('contributeur'),
});
const SCHEMAS = { companies: companySchema, projects: projectSchema, skills: skillSchema, contexts: contextSchema, members: memberSchema };
const LABEL = { companies: 'société', projects: 'projet', skills: 'skill', contexts: 'source de contexte', members: 'membre' };
const SKILL_VERSIONED = ['name', 'description', 'instructions', 'tools'];
const PERMISSIONS = {
  admin: ['read', 'run', 'arbitrate', 'manage', 'members'],
  comex: ['read', 'run', 'arbitrate', 'manage'],
  contributeur: ['read', 'run'],
  lecteur: ['read'],
};

/** Rôle effectif : la fiche membre de l'espace prime sur le rôle du jeton. */
export async function effectiveRole(app, me) {
  const members = await store(app).list(me.tenantId, 'members');
  const member = members.find((m) => m.email === String(me.email || '').toLowerCase());
  return { member: member || null, role: member?.role || me.role || 'contributeur' };
}

function store(app) {
  const ctx = app.kayrosContext;
  if (!ctx.workspaceStore) {
    const file = process.env.KAYROS_WORKSPACE_FILE ?? './.kayros-workspace.json';
    ctx.workspaceStore = new WorkspaceStore({ file });
  }
  return ctx.workspaceStore;
}
async function allowed(app, me, reply, permission = 'manage') {
  const { role } = await effectiveRole(app, me);
  if ((PERMISSIONS[role] || []).includes(permission)) return true;
  reply.code(403).send({ error: permission === 'members' ? 'rôle admin requis' : 'rôle comex ou admin requis' });
  return false;
}

/** Sources de contexte en cascade pour un projet (et un nœud de son graphe). */
export async function cascadeContext(app, tenantId, project, nodeId = '') {
  const contexts = await store(app).list(tenantId, 'contexts');
  const layers = [
    { level: 'societe', items: contexts.filter((c) => c.company_id && c.company_id === project.company_id && !c.project_id) },
    { level: 'projet', items: contexts.filter((c) => c.project_id === project.id && !c.node_id) },
  ];
  if (nodeId) layers.push({ level: 'noeud', items: contexts.filter((c) => c.project_id === project.id && c.node_id === nodeId) });
  const label = { societe: 'Société', projet: 'Projet', noeud: 'Nœud' };
  const text = layers.filter((l) => l.items.length)
    .map((l) => `Contexte ${label[l.level]}:\n${l.items.map((c) => `- ${c.name} [${c.kind}]${c.content ? ` : ${c.content.slice(0, 4000)}` : ''}${c.url ? ` (${c.url})` : ''}`).join('\n')}`).join('\n\n');
  return { layers, text };
}

/** E-mail aux parties prenantes « informé » des projets qui contiennent ce fil. */
export async function notifyInformed(app, tenantId, thread, { by = null, reason = 'arbitrage', projectId = null } = {}) {
  const ws = store(app);
  const projects = (await ws.list(tenantId, 'projects')).filter((p) => (projectId ? p.id === projectId
    : (p.session_ids || []).includes(thread?.room_id) || (p.thread_ids || []).includes(thread?.thread_id)));
  const mailer = app.kayrosContext.contactMailer;
  const from = app.kayrosContext.smtp?.from;
  const sent = [];
  for (const project of projects) {
    const recipients = (project.stakeholders || []).filter((s) => s.role === 'informe' && s.email);
    if (!recipients.length) continue;
    const decision = thread?.human_decision?.decision || lastVerdict(thread || {}) || '—';
    const subject = `[KayrosLab] ${project.name} : décision ${reason === 'arbitrage' ? 'arbitrée' : 'à suivre'}`;
    const text = `Bonjour,\n\nVous êtes informé(e) du projet « ${project.name} ».\nQuestion : ${thread?.question || '—'}\nDécision : ${decision}${thread?.human_decision?.justification ? `\nJustification : ${thread.human_decision.justification}` : ''}\n\nCe message est envoyé automatiquement par KayrosLab.`;
    for (const r of recipients) {
      let status = 'queued', error = '';
      if (mailer?.sendMail) {
        try { await mailer.sendMail({ to: r.email, from, subject, text }); status = 'sent'; }
        catch (e) { status = 'failed'; error = String(e.message || e).slice(0, 300); }
      }
      sent.push(await ws.create(tenantId, 'notifications', { project_id: project.id, thread_id: thread?.thread_id || '', to: r.email, name: r.name, subject, status, error, reason }, { by }));
    }
  }
  return sent;
}

/** Texte injecté dans le contexte d'une mission lancée sur un collectif. */
export async function collectiveAttachmentsContext(app, tenantId, sessionId) {
  const ws = store(app);
  const skills = (await ws.list(tenantId, 'skills')).filter((s) => (s.session_ids || []).includes(sessionId));
  const contexts = (await ws.list(tenantId, 'contexts')).filter((c) => (c.session_ids || []).includes(sessionId));
  const parts = [];
  for (const project of (await ws.list(tenantId, 'projects')).filter((p) => (p.session_ids || []).includes(sessionId))) {
    const { text } = await cascadeContext(app, tenantId, project);
    if (text) parts.push(`Projet « ${project.name} »\n${text}`);
  }
  if (skills.length) parts.push(`Skills du collectif:\n${skills.map((s) => `- ${s.name}${s.instructions ? ` : ${s.instructions.slice(0, 2000)}` : ''}`).join('\n')}`);
  if (contexts.length) parts.push(`Sources de contexte du collectif:\n${contexts.map((c) => `- ${c.name} [${c.kind}]${c.content ? ` : ${c.content.slice(0, 4000)}` : ''}${c.url ? ` (${c.url})` : ''}`).join('\n')}`);
  return parts.join('\n\n');
}

/** Recopie dans metadata de chaque agent les skills et sources qui lui sont rattachés. */
async function syncAgents(app, tenantId, agentIds, by) {
  const swarm = app.kayrosContext.engine.swarm;
  await swarm.hydrateTenant?.(tenantId);
  const ws = store(app);
  const skills = await ws.list(tenantId, 'skills');
  const contexts = await ws.list(tenantId, 'contexts');
  for (const agentId of new Set(agentIds)) {
    const agent = swarm.registry.get(agentId, { tenantId });
    if (!agent) continue;
    const metadata = {
      ...(agent.metadata || {}),
      skills: skills.filter((s) => (s.agent_ids || []).includes(agentId)).map((s) => ({ skill_id: s.id, name: s.name, instructions: s.instructions, tools: s.tools })),
      context_sources: contexts.filter((c) => (c.agent_ids || []).includes(agentId)).map((c) => ({ context_id: c.id, name: c.name, kind: c.kind, content: (c.content || c.url || '').slice(0, 4000) })),
    };
    try { swarm.updateAgent(agentId, { metadata }, { tenantId, by }); } catch { /* agent système non modifiable : ignoré */ }
  }
  await swarm.flush?.();
}

function threadCounts(threads) {
  const counts = { running: 0, awaiting_arbitration: 0, needs_clarification: 0, resolved: 0, failed: 0 };
  for (const t of threads) if (t.status in counts) counts[t.status] += 1;
  return counts;
}
function lastVerdict(thread) {
  const runs = (thread.messages || []).filter((m) => m.run?.consensus);
  return runs.length ? runs[runs.length - 1].run.consensus.verdict : null;
}

export default async function consoleWorkspaceRoutes(app) {
  for (const kind of Object.keys(SCHEMAS)) {
    const base = `/v1/console/${kind}`;
    app.get(base, async (req, reply) => {
      const me = await app.requireAuth(req, reply); if (!me) return;
      const filter = kind === 'projects' ? { company_id: req.query?.company_id || null } : {};
      return { [kind]: await store(app).list(me.tenantId, kind, filter) };
    });
    app.get(`${base}/:id`, async (req, reply) => {
      const me = await app.requireAuth(req, reply); if (!me) return;
      const item = await store(app).get(me.tenantId, kind, req.params.id);
      return item ? { item } : reply.code(404).send({ error: `${LABEL[kind]} introuvable` });
    });
    app.post(base, async (req, reply) => {
      const me = await app.requireAuth(req, reply); if (!me || !await allowed(app, me, reply, kind === 'members' ? 'members' : 'manage')) return;
      const parsed = SCHEMAS[kind].safeParse(req.body || {});
      if (!parsed.success) return reply.code(400).send({ error: `${LABEL[kind]} invalide`, issues: parsed.error.issues });
      if (kind === 'projects' && !await store(app).get(me.tenantId, 'companies', parsed.data.company_id)) return reply.code(400).send({ error: 'société introuvable' });
      if (kind === 'members' && (await store(app).list(me.tenantId, 'members')).some((m) => m.email === parsed.data.email)) return reply.code(409).send({ error: 'membre déjà présent' });
      const fields = kind === 'skills' ? { ...parsed.data, version: 1, versions: [] } : parsed.data;
      const item = await store(app).create(me.tenantId, kind, fields, { by: me.email });
      if (item.agent_ids?.length) await syncAgents(app, me.tenantId, item.agent_ids, me.email);
      return reply.code(201).send({ item });
    });
    app.patch(`${base}/:id`, async (req, reply) => {
      const me = await app.requireAuth(req, reply); if (!me || !await allowed(app, me, reply, kind === 'members' ? 'members' : 'manage')) return;
      const parsed = SCHEMAS[kind].partial().safeParse(req.body || {});
      if (!parsed.success) return reply.code(400).send({ error: `${LABEL[kind]} invalide`, issues: parsed.error.issues });
      // .partial() garde les valeurs par défaut : on ne retient que les champs envoyés.
      const patch = Object.fromEntries(Object.entries(parsed.data).filter(([k]) => k in (req.body || {})));
      const before = await store(app).get(me.tenantId, kind, req.params.id);
      if (!before) return reply.code(404).send({ error: `${LABEL[kind]} introuvable` });
      if (kind === 'members' && before.role === 'admin' && patch.role && patch.role !== 'admin' && (await store(app).list(me.tenantId, 'members')).filter((m) => m.role === 'admin').length < 2) {
        return reply.code(409).send({ error: 'il faut garder au moins un admin' });
      }
      if (kind === 'skills' && SKILL_VERSIONED.some((k) => k in patch && JSON.stringify(patch[k]) !== JSON.stringify(before[k]))) {
        const { versions = [], version = 1, ...snapshot } = before;
        patch.versions = [...versions, { version, at: before.updated_at, by: before.updated_by || before.created_by, ...Object.fromEntries(SKILL_VERSIONED.map((k) => [k, snapshot[k]])) }].slice(-50);
        patch.version = version + 1;
        patch.updated_by = me.email;
      }
      const item = await store(app).update(me.tenantId, kind, req.params.id, patch);
      const touched = [...(before.agent_ids || []), ...(item.agent_ids || [])];
      if (touched.length) await syncAgents(app, me.tenantId, touched, me.email);
      return { item };
    });
    app.delete(`${base}/:id`, async (req, reply) => {
      const me = await app.requireAuth(req, reply); if (!me || !await allowed(app, me, reply, kind === 'members' ? 'members' : 'manage')) return;
      const before = await store(app).get(me.tenantId, kind, req.params.id);
      if (!before) return reply.code(404).send({ error: `${LABEL[kind]} introuvable` });
      if (kind === 'members' && before.role === 'admin' && (await store(app).list(me.tenantId, 'members')).filter((m) => m.role === 'admin').length < 2) {
        return reply.code(409).send({ error: 'il faut garder au moins un admin' });
      }
      if (kind === 'companies' && (await store(app).list(me.tenantId, 'projects', { company_id: before.id })).length) {
        return reply.code(409).send({ error: 'la société a encore des projets' });
      }
      await store(app).remove(me.tenantId, kind, req.params.id);
      if (before.agent_ids?.length) await syncAgents(app, me.tenantId, before.agent_ids, me.email);
      return { ok: true };
    });
  }

  // Rôle et permissions de l'utilisateur courant.
  app.get('/v1/console/members/me', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const { member, role } = await effectiveRole(app, me);
    return { email: me.email, member, role, permissions: PERMISSIONS[role] || [] };
  });

  // Versions d'un skill et restauration.
  app.get('/v1/console/skills/:id/versions', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const skill = await store(app).get(me.tenantId, 'skills', req.params.id);
    if (!skill) return reply.code(404).send({ error: 'skill introuvable' });
    return { version: skill.version || 1, versions: skill.versions || [] };
  });
  app.post('/v1/console/skills/:id/restore', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await allowed(app, me, reply)) return;
    const ws = store(app);
    const skill = await ws.get(me.tenantId, 'skills', req.params.id);
    if (!skill) return reply.code(404).send({ error: 'skill introuvable' });
    const target = (skill.versions || []).find((v) => v.version === Number(req.body?.version));
    if (!target) return reply.code(404).send({ error: 'version introuvable' });
    const { versions = [], version = 1 } = skill;
    const item = await ws.update(me.tenantId, 'skills', skill.id, {
      ...Object.fromEntries(SKILL_VERSIONED.map((k) => [k, target[k]])),
      versions: [...versions, { version, at: skill.updated_at, by: skill.updated_by || skill.created_by, ...Object.fromEntries(SKILL_VERSIONED.map((k) => [k, skill[k]])) }].slice(-50),
      version: version + 1, updated_by: me.email, restored_from: target.version,
    });
    if (item.agent_ids?.length) await syncAgents(app, me.tenantId, item.agent_ids, me.email);
    return { item };
  });

  // Contexte en cascade d'un projet, éventuellement pour un nœud de son graphe.
  app.get('/v1/console/projects/:id/context', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const project = await store(app).get(me.tenantId, 'projects', req.params.id);
    if (!project) return reply.code(404).send({ error: 'projet introuvable' });
    return cascadeContext(app, me.tenantId, project, String(req.query?.node_id || ''));
  });

  // Journal des notifications et envoi manuel aux « informés ».
  app.get('/v1/console/projects/:id/notifications', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const items = await store(app).list(me.tenantId, 'notifications', { project_id: req.params.id });
    return { notifications: items.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100) };
  });
  app.post('/v1/console/projects/:id/notify', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await allowed(app, me, reply)) return;
    const project = await store(app).get(me.tenantId, 'projects', req.params.id);
    if (!project) return reply.code(404).send({ error: 'projet introuvable' });
    const threads = (await scopedThreads(app, me, { limit: 500 })) || [];
    const thread = threads.find((t) => t.thread_id === req.body?.thread_id) || null;
    const sent = await notifyInformed(app, me.tenantId, thread, { by: me.email, reason: 'manuel', projectId: project.id });
    return { notifications: sent };
  });

  // Tableau de bord société : projets en cours et widgets de synthèse.
  app.get('/v1/console/dashboard', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    const ws = store(app);
    const companies = await ws.list(me.tenantId, 'companies');
    const company = companies.find((c) => c.id === req.query?.company_id) || companies[0] || null;
    const projects = company ? await ws.list(me.tenantId, 'projects', { company_id: company.id }) : [];
    // Même périmètre que /threads et /sessions : un membre ne voit que ses sessions.
    const allThreads = (await scopedThreads(app, me, { limit: 500 })) || [];
    const rooms = await accessibleRooms(app, me);
    const projectViews = projects.map((p) => {
      const threads = allThreads.filter((t) => (p.session_ids || []).includes(t.room_id) || (p.thread_ids || []).includes(t.thread_id));
      return {
        ...p, counts: threadCounts(threads),
        threads: threads.slice(0, 20).map((t) => ({ thread_id: t.thread_id, session_id: t.room_id, question: t.question, status: t.status, verdict: lastVerdict(t), updated_at: t.updated_at })),
      };
    });
    const scoped = company ? allThreads.filter((t) => projectViews.some((p) => p.threads.some((x) => x.thread_id === t.thread_id))) : allThreads;
    return {
      companies, company, projects: projectViews,
      widgets: {
        projects_active: projectViews.filter((p) => p.status === 'active').length,
        decisions: threadCounts(scoped),
        pending_arbitrations: scoped.filter((t) => t.status === 'awaiting_arbitration').slice(0, 10)
          .map((t) => ({ thread_id: t.thread_id, session_id: t.room_id, question: t.question, verdict: lastVerdict(t) })),
        sessions: Array.isArray(rooms) ? rooms.length : 0,
        skills: (await ws.list(me.tenantId, 'skills')).length,
        contexts: (await ws.list(me.tenantId, 'contexts')).length,
      },
    };
  });
}
