/**
 * Phase 1 — Live governed cycle
 * POST /v1/cycle/run  — SSE stream of orchestrator events (default)
 *                      or JSON aggregate when stream=false
 */
import { z } from 'zod';
import { orchestratorForRequest } from '../lib/context.mjs';

const cycleRunSchema = z.object({
  query: z.string().min(1).max(8000),
  ideaId: z.string().max(128).optional(),
  governance: z.enum(['auto', 'supervise', 'off']).optional().default('auto'),
  sovereignty: z.string().optional(),
  provider: z.string().optional(),
  autoDistill: z.boolean().optional().default(true),
  distillMinFacts: z.number().int().min(1).max(20).optional().default(3),
  offload: z.boolean().optional().default(true),
  stream: z.boolean().optional().default(true),
  llmPlan: z.boolean().optional().default(true),
  tenantId: z.string().optional(),
  userId: z.string().optional(),
  teamId: z.string().optional(),
  organizationId: z.string().optional(),
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

function writeSse(raw, event) {
  try {
    raw.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch { /* closed */ }
}

export default async function cycleRoute(app) {
  app.post('/v1/cycle/run', async (req, reply) => {
    const parsed = cycleRunSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'query requis', issues: parsed.error.issues });
    }

    const body = parsed.data;
    const session = await tryAuthSession(app, req);
    const tenantId = session?.tenantId || body.tenantId || null;
    const userId = session?.sub || body.userId || null;
    const teamId = body.teamId || null;
    const organizationId = body.organizationId || null;
    const ideaId = body.ideaId || `idea_${Date.now().toString(36)}`;

    const { engine, journal } = app.kayrosContext;
    if (!engine?.orchestrator) {
      return reply.code(503).send({ error: 'engine non disponible' });
    }

    const orch = orchestratorForRequest(engine, {
      tenantId, userId, teamId, organizationId,
    });
    if (!orch) {
      return reply.code(503).send({ error: 'orchestrator non disponible' });
    }

    const planCtx = {
      ideaId,
      llmPlan: body.llmPlan,
      provider: body.provider,
      sovereignty: body.sovereignty,
    };

    let plan;
    try {
      plan = await orch.plan(body.query, planCtx);
    } catch (e) {
      app.log.error(e);
      return reply.code(502).send({ error: String(e.message || e) });
    }

    // SSE never blocks on human gate; JSON aggregate same unless waitGate true
    const runOpts = {
      governance: body.governance,
      sovereignty: body.sovereignty,
      provider: body.provider,
      autoDistill: body.autoDistill,
      distillMinFacts: body.distillMinFacts,
      offload: body.offload,
      tenantId,
      userId,
      teamId,
      organizationId,
      waitGate: false,
    };

    try {
      journal?.({
        type: 'cycle.start',
        ideaId,
        tenantId,
        userId,
        query: body.query.slice(0, 200),
      });
    } catch { /* soft */ }

    if (body.stream !== false) {
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
        ideaId,
        scope: { tenantId, userId, teamId, organizationId },
        stream: true,
        ts: new Date().toISOString(),
      });

      let aborted = false;
      req.raw.on('close', () => { aborted = true; });

      try {
        for await (const ev of orch.run(plan, runOpts)) {
          if (aborted) break;
          writeSse(reply.raw, ev);
        }
        if (!aborted) {
          writeSse(reply.raw, { type: 'done', ideaId, ts: new Date().toISOString() });
        }
      } catch (e) {
        app.log.error(e);
        writeSse(reply.raw, {
          type: 'error',
          error: String(e.message || e),
          ts: new Date().toISOString(),
        });
      }

      try {
        await engine.layered?.save?.({ tenantId });
      } catch { /* soft */ }

      try { reply.raw.end(); } catch { /* */ }
      return;
    }

    const events = [];
    let final = null;
    let gate = null;
    try {
      for await (const ev of orch.run(plan, runOpts)) {
        events.push(ev);
        if (ev.type === 'gate') gate = ev;
        if (ev.type === 'final') final = ev;
      }
      try {
        await engine.layered?.save?.({ tenantId });
      } catch { /* soft */ }
    } catch (e) {
      app.log.error(e);
      return reply.code(502).send({ error: String(e.message || e), events });
    }

    if (gate && final?.status === 'pending_review') {
      return reply.code(202).send({
        status: 'pending_review',
        gateId: gate.gateId,
        gateType: gate.gateType,
        ideaId,
        scope: { tenantId, userId },
        events,
      });
    }

    return {
      status: final?.status ?? 'ok',
      answer: final?.answer ?? final?.message ?? null,
      ideaId,
      scope: { tenantId, userId },
      quant: final?.quant ?? null,
      events,
    };
  });

  app.get('/v1/cycle/status', async () => {
    const { engine, OLLAMA_ENDPOINT, OLLAMA_MODEL } = app.kayrosContext;
    let snap = null;
    try {
      snap = engine?.layered?.snapshot?.() || null;
    } catch { snap = null; }
    return {
      engine: !!engine,
      layered: !!engine?.layered,
      quant: engine?.quantGuidance?.resolvedDefaultModel || null,
      ollama: { endpoint: OLLAMA_ENDPOINT, model: OLLAMA_MODEL },
      memory: snap
        ? { stats: snap.stats, dirty: snap.dirty }
        : null,
    };
  });
}
