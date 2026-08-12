/**
 * Reprise d'un run suspendu sur un gate humain.
 *
 * GET  /v1/runs/suspended        liste les runs en attente de decision
 * GET  /v1/runs/:runId           detail d'un run suspendu
 * POST /v1/runs/:runId/resume    reprend le run sur decision humaine (SSE)
 *
 * Le moteur savait deja reprendre (Orchestrator.resume) et persister
 * (RunStore), mais rien ne l'exposait : un run suspendu en production restait
 * suspendu. Ces routes ferment la boucle decision humaine -> run qui repart.
 */
import { z } from 'zod';
import { orchestratorForRequest } from '../lib/context.mjs';

// Les resolveurs de condition sont des fonctions : ils vivent dans le
// registre de l'orchestrateur, jamais dans un corps HTTP. Le client decide,
// il ne fournit pas le code du routage.
const resumeSchema = z.object({
  decision: z.enum(['approve', 'validate', 'revise', 'reject', 'veto']),
  reason: z.string().max(2000).optional(),
  stream: z.boolean().optional().default(true),
});

function writeSse(raw, event) {
  try {
    raw.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch { /* flux ferme */ }
}

/** L'etat complet ne transite pas : il est volumineux et deja cote serveur. */
function eventForTransport(event) {
  if (!event?.workflowState) return event;
  const { workflowState: _drop, ...rest } = event;
  return { ...rest, status: event.status ?? undefined };
}

export default async function resumeRoute(app) {
  const ctxOf = () => app.kayrosContext || {};

  /** Scope de la requete : le tenant vient du jeton, jamais du corps. */
  async function scopeFor(req, reply) {
    const me = await app.requireAuth(req, reply);
    if (!me) return null;
    return { me, tenantId: me.tenantId ?? 'default' };
  }

  function storeOf() {
    const ctx = ctxOf();
    const store = ctx.runStore || ctx.engine?.orchestrator?.runStore || null;
    return store && typeof store.get === 'function' ? store : null;
  }

  app.get('/v1/runs/suspended', async (req, reply) => {
    const scope = await scopeFor(req, reply);
    if (!scope) return;
    const store = storeOf();
    if (!store) return reply.code(503).send({ error: 'run store indisponible' });
    const ideaId = typeof req.query?.ideaId === 'string' ? req.query.ideaId : undefined;
    const runs = await store.list({ tenantId: scope.tenantId, ideaId });
    return { runs, total: runs.length };
  });

  app.get('/v1/runs/:runId', async (req, reply) => {
    const scope = await scopeFor(req, reply);
    if (!scope) return;
    const store = storeOf();
    if (!store) return reply.code(503).send({ error: 'run store indisponible' });
    // Le store filtre lui-meme sur le tenant : un run d'un autre tenant est
    // introuvable, pas interdit.
    const state = await store.get(req.params.runId, { tenantId: scope.tenantId });
    if (!state) return reply.code(404).send({ error: 'introuvable' });
    return {
      runId: state.runId,
      traceId: state.traceId,
      ideaId: state.ideaId,
      status: state.status,
      gate: state.gate,
      node: state.node,
      review: state.review,
      draft: state.draft ? { format: state.draft.format, bytes: state.draft.content.length } : null,
      nodeAttempts: state.nodeAttempts,
      updatedAt: state.updatedAt,
    };
  });

  app.post('/v1/runs/:runId/resume', async (req, reply) => {
    const scope = await scopeFor(req, reply);
    if (!scope) return;
    const parsed = resumeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'schema invalide', issues: parsed.error.issues });
    }
    const body = parsed.data;
    const ctx = ctxOf();
    const store = storeOf();
    if (!store) return reply.code(503).send({ error: 'run store indisponible' });

    const state = await store.get(req.params.runId, { tenantId: scope.tenantId });
    if (!state) return reply.code(404).send({ error: 'introuvable' });
    if (state.status !== 'pending_review') {
      return reply.code(409).send({ error: `run non suspendu (statut ${state.status})` });
    }

    const gate = state.gate;
    // Le gate porte le role habilite : le verifier ici evite qu'un simple
    // porteur de jeton resolve une escalade comex.
    if (gate?.requiredRole && ctx.governance?.canResolve
      && !ctx.governance.canResolve(scope.me.role, gate.type)) {
      return reply.code(403).send({ error: `role ${scope.me.role} non habilite pour ${gate.type}` });
    }

    // La decision est aussi enregistree cote gouvernance pour l'audit, meme
    // si la promesse d'origine n'est plus attendue par personne.
    try {
      if (gate?.id) {
        ctx.governance?.resolve?.(gate.id, {
          decision: body.decision, by: scope.me.email, role: scope.me.role, reason: body.reason ?? '',
        });
      }
    } catch { /* le gate a pu expirer : la reprise reste licite */ }

    const orch = orchestratorForRequest(ctx.engine, { tenantId: scope.tenantId, userId: scope.me.email });
    if (!orch) return reply.code(503).send({ error: 'moteur indisponible' });

    const resumeOpts = {
      decision: { decision: body.decision, by: scope.me.email, reason: body.reason ?? '' },
      runStore: store,
      tenantId: scope.tenantId,
      userId: scope.me.email,
      waitGate: false,
      recall: false,
      positionning: false,
      frameControl: false,
    };

    ctx.journal?.({
      type: 'run.resume',
      by: scope.me.email,
      ideaId: state.ideaId,
      runId: state.runId,
      gateId: gate?.id ?? null,
      decision: body.decision,
    });

    if (body.stream === false) {
      const events = [];
      try {
        for await (const ev of orch.resume(state, resumeOpts)) events.push(eventForTransport(ev));
      } catch (e) {
        return reply.code(502).send({ error: String(e?.message || e), runId: state.runId });
      }
      const final = events.filter((e) => e.type === 'final').at(-1) ?? null;
      return { runId: state.runId, events, final };
    }

    reply.hijack();
    try {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
    } catch (e) {
      app.log.error(e);
      try { reply.raw.end(); } catch { /* */ }
      return;
    }

    writeSse(reply.raw, {
      type: 'meta',
      runId: state.runId,
      traceId: state.traceId,
      ideaId: state.ideaId,
      gateId: gate?.id ?? null,
      decision: body.decision,
      resumedFrom: gate?.nodeId ?? null,
      ts: new Date().toISOString(),
    });

    let aborted = false;
    req.raw.on('close', () => { aborted = true; });
    try {
      for await (const ev of orch.resume(state, resumeOpts)) {
        if (aborted) break;
        writeSse(reply.raw, eventForTransport(ev));
      }
    } catch (e) {
      writeSse(reply.raw, { type: 'error', error: String(e?.message || e), ts: new Date().toISOString() });
    } finally {
      try { reply.raw.end(); } catch { /* */ }
    }
  });
}
