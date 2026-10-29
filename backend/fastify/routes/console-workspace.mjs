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
const projectSchema = z.object({
  company_id: z.string().min(1).max(120), name: z.string().min(1).max(200),
  goal: z.string().max(4000).optional().default(''), owner: z.string().max(200).optional().default(''),
  status: z.enum(['draft', 'active', 'paused', 'closed']).optional().default('active'),
  due_date: z.string().max(40).optional().default(''),
  session_ids: ids.optional().default([]), thread_ids: ids.optional().default([]),
  stakeholders: z.array(z.string().min(1).max(200)).max(50).optional().default([]),
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
  ...attachSchema,
});
const SCHEMAS = { companies: companySchema, projects: projectSchema, skills: skillSchema, contexts: contextSchema };
const LABEL = { companies: 'société', projects: 'projet', skills: 'skill', contexts: 'source de contexte' };

function store(app) {
  const ctx = app.kayrosContext;
  if (!ctx.workspaceStore) {
    const file = process.env.KAYROS_WORKSPACE_FILE ?? './.kayros-workspace.json';
    ctx.workspaceStore = new WorkspaceStore({ file });
  }
  return ctx.workspaceStore;
}
function manager(me, reply) { if (['comex', 'admin'].includes(me.role)) return true; reply.code(403).send({ error: 'rôle comex ou admin requis' }); return false; }

/** Texte injecté dans le contexte d'une mission lancée sur un collectif. */
export async function collectiveAttachmentsContext(app, tenantId, sessionId) {
  const ws = store(app);
  const skills = (await ws.list(tenantId, 'skills')).filter((s) => (s.session_ids || []).includes(sessionId));
  const contexts = (await ws.list(tenantId, 'contexts')).filter((c) => (c.session_ids || []).includes(sessionId));
  const parts = [];
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
      const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
      const parsed = SCHEMAS[kind].safeParse(req.body || {});
      if (!parsed.success) return reply.code(400).send({ error: `${LABEL[kind]} invalide`, issues: parsed.error.issues });
      if (kind === 'projects' && !await store(app).get(me.tenantId, 'companies', parsed.data.company_id)) return reply.code(400).send({ error: 'société introuvable' });
      const item = await store(app).create(me.tenantId, kind, parsed.data, { by: me.email });
      if (item.agent_ids?.length) await syncAgents(app, me.tenantId, item.agent_ids, me.email);
      return reply.code(201).send({ item });
    });
    app.patch(`${base}/:id`, async (req, reply) => {
      const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
      const parsed = SCHEMAS[kind].partial().safeParse(req.body || {});
      if (!parsed.success) return reply.code(400).send({ error: `${LABEL[kind]} invalide`, issues: parsed.error.issues });
      // .partial() garde les valeurs par défaut : on ne retient que les champs envoyés.
      const patch = Object.fromEntries(Object.entries(parsed.data).filter(([k]) => k in (req.body || {})));
      const before = await store(app).get(me.tenantId, kind, req.params.id);
      if (!before) return reply.code(404).send({ error: `${LABEL[kind]} introuvable` });
      const item = await store(app).update(me.tenantId, kind, req.params.id, patch);
      const touched = [...(before.agent_ids || []), ...(item.agent_ids || [])];
      if (touched.length) await syncAgents(app, me.tenantId, touched, me.email);
      return { item };
    });
    app.delete(`${base}/:id`, async (req, reply) => {
      const me = await app.requireAuth(req, reply); if (!me || !manager(me, reply)) return;
      const before = await store(app).get(me.tenantId, kind, req.params.id);
      if (!before) return reply.code(404).send({ error: `${LABEL[kind]} introuvable` });
      if (kind === 'companies' && (await store(app).list(me.tenantId, 'projects', { company_id: before.id })).length) {
        return reply.code(409).send({ error: 'la société a encore des projets' });
      }
      await store(app).remove(me.tenantId, kind, req.params.id);
      if (before.agent_ids?.length) await syncAgents(app, me.tenantId, before.agent_ids, me.email);
      return { ok: true };
    });
  }

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
