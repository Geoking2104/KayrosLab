/**
 * Phase 1 + 4 + 5 — Live cycle, idea lifecycle, positionning → L1
 * P2–P4 governed intelligence flags (frame / world / adaptive / novelty / dialectic)
 * POST /v1/cycle/run
 * POST /v1/cycle/reactivate
 * GET  /v1/cycle/status
 */
import { z } from 'zod';
import { orchestratorForRequest } from '../lib/context.mjs';
import {
  applyCycleEvent,
  reactivate as reactivateIdea,
} from '../../../core/cycle-lifecycle.mjs';
import { createIdea } from '../../../core/model.mjs';
import {
  applyWorkflowEvent, createWorkflowState, validateWorkflowState,
} from '../../../core/workflow-state.mjs';

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
  /**
   * Graphe prereegle. Absent = comportement historique (plan genere par le
   * Planner). Un preset court-circuite le planner : sa topologie, ses budgets,
   * ses permissions et ses gates sont deja decides.
   * `unified` suspend sur un arbitrage humain : le run repart via
   * POST /v1/runs/:runId/resume.
   */
  preset: z.enum(['unified', 'reference', 'kayros']).optional(),
  presetOptions: z.object({
    reviseRounds: z.number().int().min(0).max(10).optional(),
    writerAttempts: z.number().int().min(1).max(10).optional(),
    simulatorAttempts: z.number().int().min(1).max(10).optional(),
    arbitrageRole: z.string().max(64).optional(),
    escalationRole: z.string().max(64).optional(),
  }).optional(),
  tenantId: z.string().optional(),
  userId: z.string().optional(),
  teamId: z.string().optional(),
  organizationId: z.string().optional(),
  syncIdea: z.boolean().optional().default(true),
  title: z.string().max(300).optional(),
  /** Phase 5 — inject competitor L1 facts (default true) */
  positionning: z.boolean().optional().default(true),
  /** P2 — cheap frame control */
  frameControl: z.union([z.boolean(), z.enum(['llm', 'always'])]).optional().default(true),
  autoPickFrame: z.boolean().optional().default(true),
  forceFrameGate: z.boolean().optional().default(false),
  /** P1 — novelty + dialectic */
  noveltyControl: z.boolean().optional().default(false),
  dialectic: z.union([z.boolean(), z.enum(['agents'])]).optional().default(false),
  /** P3 — world model */
  worldModel: z.union([z.boolean(), z.enum(['llm'])]).optional().default(true),
  /** P4 — adaptive residual portfolio */
  adaptive: z.boolean().optional().default(true),
});

const reactivateSchema = z.object({
  ideaId: z.string().min(1),
  motif: z.string().max(500).optional(),
  stage: z.string().optional(),
  run: z.boolean().optional().default(false),
  query: z.string().max(8000).optional(),
  governance: z.enum(['auto', 'supervise', 'off']).optional().default('auto'),
  stream: z.boolean().optional().default(true),
  tenantId: z.string().optional(),
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

function correlateEvent(event, plan) {
  return {
    ...event,
    runId: plan.runId,
    traceId: plan.traceId,
    run_id: plan.run_id,
    trace_id: plan.trace_id,
  };
}

function eventForTransport(event) {
  if (!event?.workflowState) return event;
  const { workflowState: _workflowState, ...transportEvent } = event;
  return transportEvent;
}

function reduceWorkflowState(state, event) {
  const candidate = event?.workflowState;
  if (candidate
    && candidate.runId === state.runId
    && candidate.run_id === state.run_id
    && candidate.traceId === state.traceId
    && candidate.trace_id === state.trace_id) {
    try {
      validateWorkflowState(candidate);
      return candidate;
    } catch { /* reduce the trusted event over the canonical state instead */ }
  }
  return applyWorkflowEvent(state, event);
}

async function journalCycleError(journal, correlation, ideaId, error) {
  try {
    await journal?.({
      type: 'cycle.error',
      runId: correlation.runId,
      traceId: correlation.traceId,
      run_id: correlation.run_id,
      trace_id: correlation.trace_id,
      ideaId,
      error: String(error?.message || error),
      ts: new Date().toISOString(),
    });
  } catch { /* best-effort */ }
}

async function ensureIdea(app, {
  ideaId, title, query, tenantId, userId, syncIdea,
}) {
  if (!syncIdea) return null;
  const repo = app.kayrosContext?.ideas;
  if (!repo || typeof repo.get !== 'function') return null;

  let idea = await repo.get(ideaId).catch(() => null);
  if (idea) {
    if (tenantId && (idea.tenantId ?? 'default') !== tenantId) {
      return { error: 'idea tenant mismatch', status: 403 };
    }
    return { idea };
  }

  idea = createIdea({
    id: ideaId,
    title: title || String(query || '').slice(0, 80) || ideaId,
    author: userId || null,
    tenantId: tenantId || 'default',
    stage: 'recueillir',
    status: 'nouveau',
  });
  await repo.save(idea);
  return { idea, created: true };
}

async function persistIdeaEvent(app, ideaRef, ev, { by, journal }) {
  if (!ideaRef?.idea) return ideaRef;
  const { idea, changed } = applyCycleEvent(ideaRef.idea, ev, { by });
  if (!changed) return ideaRef;
  const repo = app.kayrosContext?.ideas;
  if (repo?.save) await repo.save(idea);
  try {
    journal?.({
      type: 'cycle.idea',
      runId: ev.runId,
      traceId: ev.traceId,
      run_id: ev.run_id,
      trace_id: ev.trace_id,
      ideaId: idea.id,
      stage: idea.stage,
      status: idea.status,
      event: ev.type,
      agent: ev.agent || null,
    });
  } catch { /* soft */ }
  return { idea };
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

    const ctx = app.kayrosContext;
    const { engine, journal } = ctx;
    if (!engine?.orchestrator) {
      return reply.code(503).send({ error: 'engine non disponible' });
    }

    let ideaRef = await ensureIdea(app, {
      ideaId,
      title: body.title,
      query: body.query,
      tenantId,
      userId,
      syncIdea: body.syncIdea,
    });
    if (ideaRef?.error) {
      return reply.code(ideaRef.status || 400).send({ error: ideaRef.error });
    }

    const orch = orchestratorForRequest(engine, {
      tenantId, userId, teamId, organizationId,
    });
    if (!orch) {
      return reply.code(503).send({ error: 'orchestrator non disponible' });
    }

    const requestCorrelation = createWorkflowState({
      ideaId,
      input: { request: body.query },
    });
    const planCtx = {
      ideaId,
      llmPlan: body.llmPlan,
      preset: body.preset,
      presetOptions: body.presetOptions,
      provider: body.provider,
      sovereignty: body.sovereignty,
      runId: requestCorrelation.runId,
      traceId: requestCorrelation.traceId,
      run_id: requestCorrelation.run_id,
      trace_id: requestCorrelation.trace_id,
    };

    let plan;
    try {
      plan = await orch.plan(body.query, planCtx);
    } catch (e) {
      app.log.error(e);
      await journalCycleError(journal, requestCorrelation, ideaId, e);
      const workflowState = applyWorkflowEvent(requestCorrelation, {
        type: 'error', error: String(e.message || e),
      });
      return reply.code(502).send({
        error: String(e.message || e),
        runId: requestCorrelation.runId,
        traceId: requestCorrelation.traceId,
        run_id: requestCorrelation.run_id,
        trace_id: requestCorrelation.trace_id,
        workflowState,
      });
    }
    // Accept older/custom orchestrators while exposing one canonical pair in both conventions.
    const correlation = createWorkflowState({
      runId: plan.runId || plan.run_id || requestCorrelation.runId,
      traceId: plan.traceId || plan.trace_id || requestCorrelation.traceId,
      ideaId,
      input: { request: body.query },
    });
    plan = {
      ...plan,
      runId: correlation.runId,
      traceId: correlation.traceId,
      run_id: correlation.run_id,
      trace_id: correlation.trace_id,
    };

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
      positionning: body.positionning,
      positionningKeys: {
        googleApiKey: ctx.GOOGLE_API_KEY || '',
        googleCx: ctx.GOOGLE_CX || '',
        githubToken: ctx.GITHUB_TOKEN || '',
        gitlabToken: ctx.GITLAB_TOKEN || '',
        gitlabBaseUrl: ctx.GITLAB_BASE_URL || '',
      },
      // P2–P4 governed intelligence
      frameControl: body.frameControl,
      autoPickFrame: body.autoPickFrame,
      forceFrameGate: body.forceFrameGate,
      waitFrameGate: false,
      noveltyControl: body.noveltyControl,
      dialectic: body.dialectic,
      worldModel: body.worldModel,
      adaptive: body.adaptive,
    };

    try {
      journal?.({
        type: 'cycle.start',
        runId: plan.runId,
        traceId: plan.traceId,
        run_id: plan.run_id,
        trace_id: plan.trace_id,
        ideaId,
        tenantId,
        userId,
        query: body.query.slice(0, 200),
        ideaStage: ideaRef?.idea?.stage,
        ideaStatus: ideaRef?.idea?.status,
      });
    } catch { /* soft */ }

    const by = userId || 'cycle';

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
        runId: plan.runId,
        traceId: plan.traceId,
        run_id: plan.run_id,
        trace_id: plan.trace_id,
        ideaId,
        idea: ideaRef?.idea
          ? { id: ideaRef.idea.id, stage: ideaRef.idea.stage, status: ideaRef.idea.status }
          : null,
        scope: { tenantId, userId, teamId, organizationId },
        stream: true,
        ts: new Date().toISOString(),
      });

      let aborted = false;
      let workflowState = correlation;
      req.raw.on('close', () => { aborted = true; });

      try {
        for await (const rawEvent of orch.run(plan, runOpts)) {
          if (aborted) break;
          const ev = correlateEvent(rawEvent, plan);
          workflowState = reduceWorkflowState(workflowState, ev);
          ideaRef = await persistIdeaEvent(app, ideaRef, ev, { by, journal });
          const enriched = ideaRef?.idea
            ? { ...ev, idea: { stage: ideaRef.idea.stage, status: ideaRef.idea.status } }
            : ev;
          writeSse(reply.raw, eventForTransport(enriched));
        }
        if (!aborted) {
          writeSse(reply.raw, {
            type: 'done',
            runId: plan.runId,
            traceId: plan.traceId,
            run_id: plan.run_id,
            trace_id: plan.trace_id,
            workflowState,
            ideaId,
            idea: ideaRef?.idea
              ? { stage: ideaRef.idea.stage, status: ideaRef.idea.status }
              : null,
            ts: new Date().toISOString(),
          });
        }
      } catch (e) {
        app.log.error(e);
        await journalCycleError(journal, correlation, ideaId, e);
        workflowState = applyWorkflowEvent(workflowState, {
          type: 'error', error: String(e.message || e),
        });
        writeSse(reply.raw, {
          type: 'error',
          runId: plan.runId,
          traceId: plan.traceId,
          run_id: plan.run_id,
          trace_id: plan.trace_id,
          workflowState,
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
    let workflowState = correlation;
    try {
      for await (const rawEvent of orch.run(plan, runOpts)) {
        const ev = correlateEvent(rawEvent, plan);
        workflowState = reduceWorkflowState(workflowState, ev);
        ideaRef = await persistIdeaEvent(app, ideaRef, ev, { by, journal });
        const enriched = ideaRef?.idea
          ? { ...ev, idea: { stage: ideaRef.idea.stage, status: ideaRef.idea.status } }
          : ev;
        events.push(eventForTransport(enriched));
        if (ev.type === 'gate') gate = ev;
        if (ev.type === 'final') final = ev;
      }
      try {
        await engine.layered?.save?.({ tenantId });
      } catch { /* soft */ }
    } catch (e) {
      app.log.error(e);
      await journalCycleError(journal, correlation, ideaId, e);
      workflowState = applyWorkflowEvent(workflowState, {
        type: 'error', error: String(e.message || e),
      });
      return reply.code(502).send({
        error: String(e.message || e),
        runId: plan.runId,
        traceId: plan.traceId,
        run_id: plan.run_id,
        trace_id: plan.trace_id,
        workflowState,
        events,
      });
    }

    if (gate && final?.status === 'pending_review') {
      return reply.code(202).send({
        status: 'pending_review',
        gateId: gate.gateId,
        gateType: gate.gateType,
        runId: plan.runId,
        traceId: plan.traceId,
        run_id: plan.run_id,
        trace_id: plan.trace_id,
        workflowState,
        ideaId,
        idea: ideaRef?.idea
          ? { stage: ideaRef.idea.stage, status: ideaRef.idea.status }
          : null,
        scope: { tenantId, userId },
        events,
      });
    }

    return {
      status: final?.status ?? 'ok',
      answer: final?.answer ?? final?.message ?? null,
      runId: plan.runId,
      traceId: plan.traceId,
      run_id: plan.run_id,
      trace_id: plan.trace_id,
      workflowState,
      ideaId,
      idea: ideaRef?.idea
        ? { stage: ideaRef.idea.stage, status: ideaRef.idea.status, history: ideaRef.idea.history?.slice(-5) }
        : null,
      scope: { tenantId, userId },
      quant: final?.quant ?? null,
      events,
    };
  });

  app.post('/v1/cycle/reactivate', async (req, reply) => {
    const parsed = reactivateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'ideaId requis', issues: parsed.error.issues });
    }
    const body = parsed.data;
    const session = await tryAuthSession(app, req);
    const tenantId = session?.tenantId || body.tenantId || null;
    const userId = session?.sub || null;
    const repo = app.kayrosContext?.ideas;

    if (!repo) {
      return reply.code(503).send({ error: 'repository idées non disponible' });
    }

    let idea = await repo.get(body.ideaId);
    if (!idea) return reply.code(404).send({ error: 'idée introuvable' });
    if (tenantId && (idea.tenantId ?? 'default') !== tenantId) {
      return reply.code(404).send({ error: 'idée introuvable' });
    }

    try {
      idea = reactivateIdea(idea, {
        by: userId || 'cycle',
        motif: body.motif || 'reactivation',
        stage: body.stage || null,
      });
      await repo.save(idea);
      app.kayrosContext.journal?.({
        type: 'cycle.reactivate',
        ideaId: idea.id,
        stage: idea.stage,
        status: idea.status,
        by: userId,
      });
    } catch (e) {
      return reply.code(409).send({ error: String(e.message || e) });
    }

    if (!body.run) {
      return { ok: true, idea };
    }

    const query = body.query || idea.title || idea.intake?.summary || idea.id;
    const { engine } = app.kayrosContext;
    if (!engine?.orchestrator) {
      return { ok: true, idea, run: false, hint: 'POST /v1/cycle/run with ideaId' };
    }

    if (body.stream !== false) {
      return {
        ok: true,
        idea,
        next: {
          method: 'POST',
          path: '/v1/cycle/run',
          body: {
            query,
            ideaId: idea.id,
            governance: body.governance,
            stream: true,
            frameControl: true,
            worldModel: true,
            adaptive: true,
          },
        },
      };
    }

    return { ok: true, idea, query };
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
