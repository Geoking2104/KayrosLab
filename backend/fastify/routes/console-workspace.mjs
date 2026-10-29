import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { PERMISSIONS, memberRole, workspaceStoreFor } from '../lib/workspace-roles.mjs';
import { scopedThreads, accessibleRooms } from './console.mjs';
import { evaluateThreadGates } from '../lib/project-gates.mjs';

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
    veto: z.boolean().optional(), strict: z.boolean().optional(), exclude: z.boolean().optional(), pause: z.boolean().optional(), role: z.enum(STAKEHOLDER_ROLES).optional(),
  }).optional().default({}),
  // Position libre choisie par glisser-déposer (sinon mise en page automatique).
  x: z.number().min(0).max(10000).optional(), y: z.number().min(0).max(10000).optional(),
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
  status: z.enum(['active', 'invited']).optional(),
});
const SCHEMAS = { companies: companySchema, projects: projectSchema, skills: skillSchema, contexts: contextSchema, members: memberSchema };
const LABEL = { companies: 'société', projects: 'projet', skills: 'skill', contexts: 'source de contexte', members: 'membre' };
const SKILL_VERSIONED = ['name', 'description', 'instructions', 'tools'];
export { PERMISSIONS };
/** Fiche membre sans l'empreinte du jeton d'invitation. */
export function publicMember(member) {
  if (!member) return member;
  const { invite_token_sha256: _hash, ...rest } = member;
  return rest;
}

/** Rôle effectif : la fiche membre de l'espace prime sur le rôle du jeton. */
export async function effectiveRole(app, me) {
  return memberRole(app.kayrosContext, { tenantId: me.tenantId, email: me.email, accountRole: me.role });
}
/** Vérifie une permission (read, run, arbitrate, manage, members) selon le rôle effectif. */
export async function can(app, me, permission) {
  const { role } = await effectiveRole(app, me);
  return (PERMISSIONS[role] || []).includes(permission);
}
export const PERMISSION_ERROR = {
  run: 'rôle contributeur, comex ou admin requis', arbitrate: 'rôle comex ou admin requis',
  manage: 'rôle comex ou admin requis', members: 'rôle admin requis',
};

/** Évalue les portes du graphe des projets du fil et l'inscrit sur le fil (idempotent). */
export async function applyGates(app, tenantId, thread) {
  if (!thread?.thread_id) return thread;
  const projects = (await store(app).list(tenantId, 'projects')).filter((p) => p.graph && ((p.session_ids || []).includes(thread.room_id) || (p.thread_ids || []).includes(thread.thread_id)));
  const evaluation = thread.status === 'running' ? (thread.gate_evaluation || null) : (projects.length ? evaluateThreadGates(projects, thread) : null);
  if (JSON.stringify(evaluation) === JSON.stringify(thread.gate_evaluation || null)) return thread;
  const gateway = app.kayrosContext.hybridGateway;
  try { await gateway?.store?.updateThread?.(thread.thread_id, { gate_evaluation: evaluation }, { tenantId }); } catch { /* lecture seule : l'évaluation reste calculée */ }
  return { ...thread, gate_evaluation: evaluation };
}

function store(app) { return workspaceStoreFor(app.kayrosContext); }
async function allowed(app, me, reply, permission = 'manage') {
  const { role } = await effectiveRole(app, me);
  if ((PERMISSIONS[role] || []).includes(permission)) return true;
  reply.code(403).send({ error: PERMISSION_ERROR[permission] || 'rôle comex ou admin requis' });
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
    // Décision humaine : inscrite dans le dernier message d'arbitrage du fil.
    const arbitration = [...(thread?.messages || [])].reverse().find((m) => m.kind === 'arbitration')?.decision || thread?.human_decision || null;
    const decision = arbitration?.verdict || arbitration?.decision || lastVerdict(thread || {}) || '—';
    const subject = `[KayrosLab] ${project.name} : décision ${reason === 'arbitrage' ? 'arbitrée' : 'à suivre'}`;
    const text = `Bonjour,\n\nVous êtes informé(e) du projet « ${project.name} ».\nQuestion : ${thread?.question || '—'}\nDécision : ${decision}${arbitration?.justification ? `\nJustification : ${arbitration.justification}` : ''}\n\nCe message est envoyé automatiquement par KayrosLab.`;
    for (const r of recipients) {
      let status = 'queued', error = '';
      if (mailer?.sendMail) {
        try { await mailer.sendMail({ to: r.email, from, subject, text }); status = 'sent'; }
        catch (e) { status = 'failed'; error = String(e.message || e).slice(0, 300); }
      }
      sent.push(await ws.create(tenantId, 'notifications', { project_id: project.id, thread_id: thread?.thread_id || '', to: r.email, name: r.name, subject, text, status, error, reason }, { by }));
    }
  }
  return sent;
}

/** Jeton d'activation d'invitation : seul son empreinte est conservée sur la fiche membre. */
export const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
export function inviteTokenHash(token) { return createHash('sha256').update(String(token || '')).digest('hex'); }
export function inviteUrl(app, token) {
  const base = String(app.kayrosContext.consoleUrl || process.env.KAYROS_CONSOLE_URL || 'https://www.kayroslab.com/console').replace(/\/+$/, '');
  return `${base}/?invite=${encodeURIComponent(token)}`;
}

/** E-mail d'invitation d'un membre (statut sent / failed / queued sans SMTP). */
async function sendInvite(app, { email, name, role, by, url }) {
  const mailer = app.kayrosContext.contactMailer;
  if (!mailer?.sendMail) return { status: 'queued', error: '' };
  const text = `Bonjour${name ? ` ${name}` : ''},\n\n${by || 'Un administrateur'} vous invite sur la console KayrosLab avec le rôle « ${role} ».\nActivez votre accès (création du mot de passe, ou connexion si vous avez déjà un compte avec ${email}) : ${url}\nCe lien est valable 7 jours.\n\nCe message est envoyé automatiquement par KayrosLab.`;
  try { await mailer.sendMail({ to: email, from: app.kayrosContext.smtp?.from, subject: '[KayrosLab] Invitation à rejoindre l’espace', text }); return { status: 'sent', error: '' }; }
  catch (e) { return { status: 'failed', error: String(e.message || e).slice(0, 300) }; }
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
      const items = await store(app).list(me.tenantId, kind, filter);
      return { [kind]: kind === 'members' ? items.map(publicMember) : items };
    });
    app.get(`${base}/:id`, async (req, reply) => {
      const me = await app.requireAuth(req, reply); if (!me) return;
      const item = await store(app).get(me.tenantId, kind, req.params.id);
      return item ? { item: kind === 'members' ? publicMember(item) : item } : reply.code(404).send({ error: `${LABEL[kind]} introuvable` });
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

  // Rôle et permissions de l'utilisateur courant ; une invitation devient active à la première connexion.
  app.get('/v1/console/members/me', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    let { member, role } = await effectiveRole(app, me);
    if (member?.status === 'invited') member = await store(app).update(me.tenantId, 'members', member.id, { status: 'active', joined_at: new Date().toISOString(), invite_token_sha256: null });
    return { email: me.email, member: publicMember(member), role, permissions: PERMISSIONS[role] || [] };
  });
  // Invitation par e-mail : crée (ou relance) la fiche membre et envoie le lien d'accès.
  app.post('/v1/console/members/invite', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await allowed(app, me, reply, 'members')) return;
    const parsed = memberSchema.safeParse(req.body || {});
    if (!parsed.success) return reply.code(400).send({ error: 'invitation invalide', issues: parsed.error.issues });
    const ws = store(app);
    const existing = (await ws.list(me.tenantId, 'members')).find((m) => m.email === parsed.data.email);
    if (existing && existing.status !== 'invited') return reply.code(409).send({ error: 'membre déjà actif' });
    const token = randomBytes(24).toString('base64url');
    const url = inviteUrl(app, token);
    const delivery = await sendInvite(app, { ...parsed.data, by: me.email, url });
    const fields = {
      ...parsed.data, status: 'invited', invited_by: me.email, invited_at: new Date().toISOString(), invite_status: delivery.status, invite_error: delivery.error,
      invite_token_sha256: inviteTokenHash(token), invite_expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
    };
    const item = existing ? await ws.update(me.tenantId, 'members', existing.id, { ...fields, updated_by: me.email }) : await ws.create(me.tenantId, 'members', fields, { by: me.email });
    return reply.code(existing ? 200 : 201).send({ item: publicMember(item), delivery, invite_url: url });
  });
  // État de l'envoi d'e-mails (SMTP configuré ou non) pour expliquer les notifications « en file ».
  app.get('/v1/console/mail/status', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me) return;
    return { smtp: !!app.kayrosContext.contactMailer?.sendMail, from: app.kayrosContext.smtp?.from || null };
  });
  // Relance des notifications restées en file ou en échec (après configuration du SMTP).
  app.post('/v1/console/projects/:id/notifications/retry', async (req, reply) => {
    const me = await app.requireAuth(req, reply); if (!me || !await allowed(app, me, reply)) return;
    const ws = store(app);
    const mailer = app.kayrosContext.contactMailer;
    if (!mailer?.sendMail) return reply.code(409).send({ error: 'SMTP non configuré : les notifications restent en file', code: 'smtp_missing' });
    const items = (await ws.list(me.tenantId, 'notifications', { project_id: req.params.id })).filter((n) => n.status !== 'sent');
    const out = [];
    for (const n of items) {
      let status = 'sent', error = '';
      try { await mailer.sendMail({ to: n.to, from: app.kayrosContext.smtp?.from, subject: n.subject, text: n.text || n.subject }); }
      catch (e) { status = 'failed'; error = String(e.message || e).slice(0, 300); }
      out.push(await ws.update(me.tenantId, 'notifications', n.id, { status, error, retried_at: new Date().toISOString() }));
    }
    return { notifications: out };
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
