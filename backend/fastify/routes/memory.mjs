/**
 * Phase 3 — Memory continuity API
 * GET  /v1/memory/l3
 * POST /v1/memory/l3
 * GET  /v1/memory/ideas/:ideaId
 * POST /v1/memory/promote
 * POST /v1/memory/save
 */
import { z } from 'zod';

const l3PostSchema = z.object({
  scope: z.enum(['user', 'team', 'organization', 'tenant']).default('tenant'),
  scopeId: z.string().min(1).max(128).optional(),
  kind: z.enum(['persona', 'preference', 'norm', 'skill', 'ontology_core', 'decision_style']).default('norm'),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(8000),
  tenantId: z.string().max(128).optional(),
  trigger: z.string().max(500).optional(),
  steps: z.array(z.string()).optional(),
  successCriteria: z.string().max(1000).optional(),
});

const promoteSchema = z.object({
  l2Id: z.string().min(1),
  scope: z.enum(['user', 'team', 'organization', 'tenant']).optional().default('tenant'),
  scopeId: z.string().min(1).max(128).optional(),
  kind: z.enum(['persona', 'preference', 'norm', 'skill', 'ontology_core', 'decision_style']).optional().default('norm'),
  title: z.string().max(200).optional(),
  content: z.string().max(8000).optional(),
  tenantId: z.string().max(128).optional(),
});

async function tryAuthSession(app, req) {
  const { auth } = app.kayrosContext || {};
  if (!auth) return null;
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  try {
    return await auth.verify(token);
  } catch {
    return null;
  }
}

function resolveTenant(session, bodyTenant) {
  return session?.tenantId || bodyTenant || null;
}

export default async function memoryRoute(app) {
  /** List L3 cores (filtered by tenant / kind). */
  app.get('/v1/memory/l3', async (req, reply) => {
    const { engine } = app.kayrosContext;
    if (!engine?.layered) return reply.code(503).send({ error: 'engine non disponible' });

    const session = await tryAuthSession(app, req);
    const tenantId = resolveTenant(session, req.query?.tenantId || null);
    const kind = req.query?.kind || null;
    const scope = req.query?.scope || null;
    const scopeId = req.query?.scopeId || tenantId || null;

    const list = engine.layered.getCore({
      scope: scope || (tenantId ? 'tenant' : null),
      scopeId: scope ? scopeId : (tenantId || null),
      kind,
      tenantId,
    });

    return {
      count: list.length,
      tenantId,
      items: list.map((c) => ({
        id: c.id,
        scope: c.scope,
        scopeId: c.scopeId,
        kind: c.kind,
        title: c.title,
        content: c.content,
        version: c.version,
        updatedAt: c.updatedAt,
        relatedL2Ids: c.relatedL2Ids || [],
      })),
    };
  });

  /** Create / upsert L3 core. */
  app.post('/v1/memory/l3', async (req, reply) => {
    const parsed = l3PostSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'payload invalide', issues: parsed.error.issues });
    }
    const { engine } = app.kayrosContext;
    if (!engine?.layered) return reply.code(503).send({ error: 'engine non disponible' });

    const session = await tryAuthSession(app, req);
    const tenantId = resolveTenant(session, parsed.data.tenantId);
    const scope = parsed.data.scope;
    let scopeId = parsed.data.scopeId;
    if (!scopeId) {
      if (scope === 'tenant') scopeId = tenantId || 'default';
      else if (scope === 'user') scopeId = session?.sub || parsed.data.scopeId;
      else scopeId = tenantId || 'default';
    }
    if (!scopeId) {
      return reply.code(400).send({ error: 'scopeId ou tenantId requis' });
    }

    try {
      const core = await engine.layered.updateCore({
        scope,
        scopeId,
        kind: parsed.data.kind,
        title: parsed.data.title,
        content: parsed.data.content,
        trigger: parsed.data.trigger,
        steps: parsed.data.steps,
        successCriteria: parsed.data.successCriteria,
      });
      await engine.layered.save({ tenantId: tenantId || (scope === 'tenant' ? scopeId : null) }).catch(() => {});
      return { ok: true, core };
    } catch (e) {
      app.log.error(e);
      return reply.code(400).send({ error: String(e.message || e) });
    }
  });

  /** Idea inspector: L0/L1/L2 (+ tenant L3). */
  app.get('/v1/memory/ideas/:ideaId', async (req, reply) => {
    const { engine } = app.kayrosContext;
    if (!engine?.layered) return reply.code(503).send({ error: 'engine non disponible' });
    const ideaId = req.params.ideaId;
    if (!ideaId) return reply.code(400).send({ error: 'ideaId requis' });

    const session = await tryAuthSession(app, req);
    const tenantId = resolveTenant(session, req.query?.tenantId || null);

    try {
      return engine.layered.inspectIdea(ideaId, { tenantId });
    } catch (e) {
      return reply.code(400).send({ error: String(e.message || e) });
    }
  });

  /** Promote L2 scenario → L3 core. */
  app.post('/v1/memory/promote', async (req, reply) => {
    const parsed = promoteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'l2Id requis', issues: parsed.error.issues });
    }
    const { engine } = app.kayrosContext;
    if (!engine?.layered) return reply.code(503).send({ error: 'engine non disponible' });

    const session = await tryAuthSession(app, req);
    const tenantId = resolveTenant(session, parsed.data.tenantId);
    const scope = parsed.data.scope || 'tenant';
    const scopeId = parsed.data.scopeId
      || (scope === 'user' ? (session?.sub || null) : null)
      || tenantId
      || 'default';

    try {
      const result = await engine.layered.promoteL2ToL3(parsed.data.l2Id, {
        scope,
        scopeId,
        kind: parsed.data.kind,
        title: parsed.data.title,
        content: parsed.data.content,
      });
      await engine.layered.save({ tenantId: tenantId || scopeId }).catch(() => {});
      return { ok: true, ...result };
    } catch (e) {
      const code = e.code === 'L2_NOT_FOUND' ? 404 : 400;
      return reply.code(code).send({ error: String(e.message || e), code: e.code || null });
    }
  });

  /** Force persist snapshot. */
  app.post('/v1/memory/save', async (req, reply) => {
    const { engine } = app.kayrosContext;
    if (!engine?.layered) return reply.code(503).send({ error: 'engine non disponible' });
    const session = await tryAuthSession(app, req);
    const tenantId = resolveTenant(session, req.body?.tenantId || null);
    const ok = await engine.layered.save({ tenantId }).catch(() => false);
    return { ok, tenantId };
  });
}
