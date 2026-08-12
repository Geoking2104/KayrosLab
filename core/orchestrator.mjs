// KayrosLab — Orchestrateur (Plan-and-Solve + ReAct), memory-aware, Planner LLM.
// P0: decision packets + epistemic policy before gates/final.
// P1: optional novelty control + dialectic via runP1Hooks.
// P2: cheap problem-frame assessment + reframes + optional frame gate.
// P3: world model + multi-resolution gates.
// P4: adaptive compute + residual portfolio + decision debt.

import { classifySensitive, policyFor } from './governance.mjs';
import { evaluateKpis, alertsToSignals } from './loop.mjs';
import { createAllAgents, AGENT_TYPES } from './agents/index.mjs';
import { defaultFallbackSteps } from './agents/planner-agent.mjs';
import { parsePlanSteps, ensureSynthesizerLast, extractFirstArray, salvageObjects } from './plan-parse.mjs';
import { resolveMemoryScope } from './memory-scope.mjs';
import {
  runPositionningAnalysis,
  factsFromPositionning,
  heuristicPositionning,
} from './positionning/index.mjs';
import { compilePacket, applyEpistemicPolicy, renderPacketForGate, policyForPacket } from './decision-packet.mjs';
import { runP1Hooks } from './run-hooks-p1.mjs';
import { runP2Hooks } from './run-hooks-p2.mjs';
import { runP3P4Hooks } from './run-hooks-p3p4.mjs';
import {
  applyWorkflowEvent, createWorkflowState, freezeWorkflowState, migrateWorkflowState,
} from './workflow-state.mjs';
import { compileWorkflowGraph, declareWorkflowGraph } from './workflow-graph.mjs';
import { assertToolAllowed, assertChannelWritable } from './workflow-permissions.mjs';
import { resolveLogSink } from './log-sink.mjs';
import { buildRoleContext } from './role-context.mjs';

const AGENTS = AGENT_TYPES;

export { parsePlanSteps, extractFirstArray, salvageObjects, ensureSynthesizerLast };

/**
 * R2: an optional phase that fails must be visible. Before this, twenty-one
 * `catch {}` blocks made a failed recall, positionning or distillation
 * indistinguishable from a successful one.
 */
function softErrorEvent(phase, error, extra = {}) {
  return {
    type: 'soft_error',
    phase,
    message: String(error?.message || error || 'soft failure'),
    ...extra,
    ts: new Date().toISOString(),
  };
}

/**
 * R3: bounds a step by a deadline and an abort signal. Without this a hanging
 * LLM call hung the whole run, with no timeout and no way to cancel.
 */
function withDeadline(promise, { ms = null, signal = null, label = 'step' } = {}) {
  if (!ms && !signal) return promise;
  return new Promise((resolve, reject) => {
    let timer = null;
    let settled = false;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const fail = (message, code) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(Object.assign(new Error(message), { code }));
    };
    function onAbort() { fail(`${label} aborted`, 'ABORTED'); }
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    if (ms) timer = setTimeout(() => fail(`${label} timed out after ${ms}ms`, 'TIMEOUT'), ms);
    Promise.resolve(promise).then(
      (value) => { if (settled) return; settled = true; cleanup(); resolve(value); },
      (error) => { if (settled) return; settled = true; cleanup(); reject(error); },
    );
  });
}

/** Maps a bounded-step rejection onto the orchestrator's degraded vocabulary. */
function degradedReasonFor(error, fallback) {
  if (error?.code === 'TIMEOUT') return 'timeout';
  if (error?.code === 'ABORTED') return 'aborted';
  return fallback;
}

function agentQuantInfo(agent) {
  if (!agent) return null;
  const rec = agent.quantRec || null;
  return {
    preferredModel: agent.preferredModel || null,
    quant: rec?.quant || null,
    tier: rec?.tier || null,
    quality: rec?.meta?.quality ?? null,
    label: rec?.meta?.label || null,
  };
}

export class Orchestrator {
  constructor({
    llm, tools = null, memory = null, layered = null, governance = null,
    classifier = null, recallK = 3, plannerModel = null, agents = null,
    quantGuidance = null, logSink = null,
    tenantId = null, defaultScope = null, defaultScopeId = null,
    userId = null, teamId = null, organizationId = null,
  } = {}) {
    if (!llm) throw new Error('Orchestrator: llm (KayrosLLM) requis');
    this.llm = llm;
    this.tools = tools;
    this.memory = memory;
    this.layered = layered;
    this.governance = governance;
    this.classifier = classifier;
    this.recallK = recallK;
    this.plannerModel = plannerModel;
    this.agents = agents || createAllAgents({ llm, tools, memory });
    this.quantGuidance = quantGuidance || null;
    this.logSink = logSink || null;
    this.scopeDefaults = {
      tenantId: tenantId || null,
      defaultScope: defaultScope || null,
      defaultScopeId: defaultScopeId || null,
      userId: userId || null,
      teamId: teamId || null,
      organizationId: organizationId || null,
    };
  }

  _hasVectorMemory() { return !!this.memory && typeof this.memory.recall === 'function' && typeof this.memory.remember === 'function'; }
  _hasLayered() { return !!this.layered && typeof this.layered.recall === 'function'; }
  _resolveRunScope(opts = {}) { return resolveMemoryScope(opts, this.scopeDefaults); }

  _quantSnapshot() {
    if (!this.quantGuidance && !this.agents) return null;
    const byAgent = {};
    for (const name of AGENTS) {
      const info = agentQuantInfo(this.agents?.[name]);
      if (info && (info.preferredModel || info.quant)) byAgent[name] = info;
    }
    return {
      global: this.quantGuidance?.global || null,
      resolvedDefaultModel: this.quantGuidance?.resolvedDefaultModel || null,
      availableQuants: this.quantGuidance?.availableQuants || null,
      byAgent,
    };
  }

  _fallbackSteps() { return defaultFallbackSteps(); }

  async project(decision = {}, ctx = {}) {
    const ideaId = ctx.ideaId ?? 'idea';
    const status = decision.status ?? 'Go';
    const base = { ideaId, generatedBy: 'projeter', ts: new Date().toISOString() };
    const hasTool = (n) => !!(this.tools && typeof this.tools.get === 'function' && this.tools.get(n));

    if (status === 'No-Go') {
      const capitalisation = {
        apprentissages: decision.apprentissages ?? [],
        reactivation: decision.reactivation ?? null,
        signaux: decision.signaux ?? [],
      };
      this.memory?.addContribution?.({ actor: 'Projeter', content: `capitalisation No-Go (${capitalisation.apprentissages.length} apprentissages)` });
      return { ...base, status: 'No-Go', capitalisation };
    }
    if (status === 'Revision' || status === 'Révision') {
      return { ...base, status: 'Révision', note: decision.motif ?? 'Révision demandée', renvoi: 'Éprouver' };
    }

    // Go : roadmap + ressources/budget + projections probabilistes (chiffres deterministes).
    const milestones = decision.milestones ?? [];
    let ressources = null, projections = null;
    if (hasTool('estimate_resources')) {
      try {
        ressources = await this.tools.call('estimate_resources', { milestones, costHypotheses: decision.costHypotheses ?? {} }, { ideaId });
      } catch { ressources = null; }
    }
    if (hasTool('simulate_trajectory') && Array.isArray(decision.scenarios) && decision.scenarios.length) {
      try {
        projections = await this.tools.call('simulate_trajectory', { scenarios: decision.scenarios, variables: decision.variables ?? [], iterations: ctx.iterations, seed: ctx.seed }, { ideaId });
      } catch { projections = null; }
    }
    const roadmap = {
      jalons: milestones,
      raci: decision.raci ?? [],
      ressources,
      kpis: decision.kpis ?? [],
      risques: decision.risques ?? [],
      gatesFuturs: decision.gatesFuturs ?? [],
    };
    this.memory?.addContribution?.({ actor: 'Projeter', content: `roadmap Go (${milestones.length} jalons)` });
    return { ...base, status: 'Go', roadmap, projections };
  }

  async monitorProjection({ kpis = [], readings = [] } = {}, ctx = {}) {
    const ideaId = ctx.ideaId ?? 'idea';
    const { alerts } = evaluateKpis(kpis, readings);
    const signals = alertsToSignals(alerts, { ideaId });
    // Re-injection dans le corpus d'Ecouter.
    if (this._hasLayered()) {
      for (const s of signals) {
        try {
          await this.layered.addAtomicFact({
            ideaId, content: s.contenu, type: 'metric', actors: ['monitor'], confidence: 0.8, tags: ['kpi-alert'],
          });
        } catch { /* best-effort */ }
      }
    } else if (this._hasVectorMemory()) {
      for (const s of signals) {
        try { await this.memory.remember({ id: s.id, ideaId, text: s.contenu }); } catch { /* best-effort */ }
      }
    } else {
      for (const s of signals) this.memory?.addContribution?.({ actor: 'Ecouter', content: s.contenu });
    }
    const reArbitrage = alerts.length
      ? { type: 're-arbitrage', ideaId, reasons: alerts.map((a) => a.kpiId), ts: new Date().toISOString() }
      : null;
    return { alerts, signals, reArbitrage };
  }

  async plan(goal, ctx = {}) {
    const ideaId = ctx.ideaId ?? 'idea';
    const correlation = createWorkflowState({
      runId: ctx.runId || ctx.run_id,
      traceId: ctx.traceId || ctx.trace_id,
      ideaId,
      input: { request: goal, context: ctx.context || {} },
    });
    const correlated = (value) => {
      const graph = value.graph || declareWorkflowGraph(value.steps || []);
      return {
        ...value,
        graph,
        runId: correlation.runId,
        traceId: correlation.traceId,
        run_id: correlation.runId,
        trace_id: correlation.traceId,
      };
    };
    if (ctx.llmPlan === false) {
      return correlated({ ideaId, goal, generatedBy: 'fallback', steps: this._fallbackSteps(), quant: this._quantSnapshot() });
    }
    const plannerAgent = this.agents?.Planner;
    const model = ctx.model ?? plannerAgent?.preferredModel ?? this.plannerModel ?? undefined;
    let lastPlannerError = null;
    if (plannerAgent && typeof plannerAgent.createPlan === 'function') {
      try {
        const result = await plannerAgent.createPlan(goal, {
          provider: ctx.provider, sovereignty: ctx.sovereignty, model, llmPlan: ctx.llmPlan,
          runId: correlation.runId, traceId: correlation.traceId,
          run_id: correlation.run_id, trace_id: correlation.trace_id,
        });
        if (result?.steps?.length) {
          return correlated({
            ideaId, goal, generatedBy: result.generatedBy || 'llm',
            steps: ensureSynthesizerLast(result.steps),
            quant: { modelUsed: model || null, agent: agentQuantInfo(plannerAgent), snapshot: this._quantSnapshot() },
            degraded: result.degraded || null,
          });
        }
      } catch (e) {
        // plan() is not a generator, so the failure is recorded on the plan
        // itself rather than emitted: the caller sees why it fell back.
        lastPlannerError = e;
      }
    }
    return correlated({
      ideaId, goal, generatedBy: 'fallback',
      steps: this._fallbackSteps(),
      quant: this._quantSnapshot(),
      degraded: lastPlannerError
        ? { reason: 'planner_error', message: String(lastPlannerError?.message || lastPlannerError) }
        : null,
    });
  }

  async _injectPositionning(plan, opts, scopeResolved) {
    if (opts.positionning === false) return null;
    if (!this._hasLayered()) return null;
    const tenantId = scopeResolved.tenantId || opts.tenantId || 'default';
    let analysis = null;
    let mode = 'heuristic';
    const keys = opts.positionningKeys || {};
    const hasScannerKeys = !!(keys.googleApiKey || keys.githubToken || keys.gitlabToken);
    try {
      if (opts.positionningAnalysis) { analysis = opts.positionningAnalysis; mode = 'provided'; }
      else if (hasScannerKeys) {
        analysis = await runPositionningAnalysis(plan.goal, {
          googleApiKey: keys.googleApiKey, googleCx: keys.googleCx,
          githubToken: keys.githubToken, gitlabToken: keys.gitlabToken,
          gitlabBaseUrl: keys.gitlabBaseUrl, limit: opts.positionningLimit ?? 5,
        });
        mode = 'scanners';
      } else { analysis = heuristicPositionning(plan.goal); mode = 'heuristic'; }
    } catch { analysis = heuristicPositionning(plan.goal); mode = 'heuristic-fallback'; }

    const payloads = factsFromPositionning(analysis, {
      ideaId: plan.ideaId, tenantId,
      maxCompetitors: opts.positionningMaxCompetitors ?? 8,
      maxGaps: opts.positionningMaxGaps ?? 5,
    });
    const created = [];
    const failures = [];
    for (const p of payloads || []) {
      try {
        const fact = await this.layered.addAtomicFact(p);
        created.push({ id: fact.id, type: fact.type, content: fact.content.slice(0, 120) });
      } catch (e) {
        // Not a generator: failures are counted and surfaced on the returned
        // summary, which _runInternal turns into a soft_error event.
        failures.push(String(e?.message || e));
      }
    }
    let extraContext = '';
    if (created.length) {
      extraContext = '\n### Positionnement concurrentiel (L1)\n' + created.map((f) => `- (${f.type}) ${f.content}`).join('\n');
    }
    return {
      mode,
      kayrosIndex: analysis?.kayrosIndex ?? null,
      competitors: analysis?.summary?.totalCompetitors ?? analysis?.competitors?.length ?? 0,
      competitorCount: analysis?.summary?.totalCompetitors ?? analysis?.competitors?.length ?? created.length,
      gapCount: analysis?.gaps?.length ?? 0,
      facts: created.length,
      preview: created.slice(0, 5),
      failures,
      extraContext,
    };
  }

  /**
   * Continues a run suspended on a human gate.
   *
   * A gate that suspends is only useful if the decision can put the run back
   * in motion. `resume` takes the snapshot the suspended run yielded plus the
   * human decision, and re-enters the guarded node -- which never executed --
   * without replaying anything upstream.
   *
   * @param {object} snapshot  workflowState from the suspended run
   * @param {object} opts      run options plus `decision`
   */
  async *resume(snapshot, opts = {}) {
    const state = migrateWorkflowState(snapshot);
    if (state.status !== 'pending_review') {
      throw new Error('Orchestrator.resume: state is not suspended on a gate');
    }
    const gate = state.gate;
    if (!gate?.nodeId) {
      throw new Error('Orchestrator.resume: state carries no gate node to resume from');
    }
    const decision = opts.decision;
    if (!decision || typeof decision !== 'object' || typeof decision.decision !== 'string') {
      throw new Error('Orchestrator.resume: a decision { decision } is required');
    }
    if (!state.plan?.graph) {
      throw new Error('Orchestrator.resume: state carries no graph to resume');
    }

    let workflowState = state;
    const emit = (event) => {
      workflowState = applyWorkflowEvent(workflowState, event);
      return {
        ...event,
        runId: workflowState.runId,
        traceId: workflowState.traceId,
        run_id: workflowState.run_id,
        trace_id: workflowState.trace_id,
        workflowState: freezeWorkflowState(workflowState),
      };
    };

    yield emit({
      type: 'gate_resolved', gateId: gate.id, nodeId: gate.nodeId, decision,
      ts: new Date().toISOString(),
    });

    if (decision.decision === 'reject' || decision.decision === 'veto') {
      yield emit({
        type: 'final', status: 'blocked_veto',
        message: `Bloque (veto) : ${decision.reason ?? 'veto humain'}`,
        ts: new Date().toISOString(),
      });
      return;
    }

    const compiledGraph = compileWorkflowGraph(state.plan.graph, {
      conditions: opts.graphConditions || {},
    });
    const executionPlan = {
      ideaId: state.ideaId,
      goal: state.input.request,
      steps: compiledGraph.definition.nodes.map(({ step }) => step),
      successCriteria: state.plan.successCriteria || [],
      graph: compiledGraph.definition,
      runId: state.runId,
      traceId: state.traceId,
    };
    // The gate has just been approved: re-entering the node must not open it
    // again, and the phases already executed before the suspension are not
    // replayed.
    const resumeOpts = {
      ...opts,
      runId: state.runId, traceId: state.traceId,
      run_id: state.run_id, trace_id: state.trace_id,
      recall: false, positionning: false, frameControl: false,
      _resumeFrom: gate.nodeId,
      _resumeGateApproved: true,
    };

    for await (const event of this._runInternal(
      executionPlan, resumeOpts, compiledGraph, () => workflowState,
    )) {
      if (event.type === 'start') continue; // the run already started
      yield emit(event);
    }
  }

  async *run(plan, opts = {}) {
    const compiledGraph = compileWorkflowGraph(
      plan.graph || declareWorkflowGraph(plan.steps || []),
      { conditions: opts.graphConditions || {} },
    );
    const graph = compiledGraph.definition;
    const executionPlan = {
      ...plan,
      steps: graph.nodes.map(({ step }) => step),
      graph,
    };
    let workflowState = createWorkflowState({
      runId: plan.runId || plan.run_id || opts.runId || opts.run_id,
      traceId: plan.traceId || plan.trace_id || opts.traceId || opts.trace_id,
      ideaId: plan.ideaId,
      input: { request: plan.goal, context: opts.context || {} },
      plan: {
        steps: executionPlan.steps,
        successCriteria: plan.successCriteria || opts.successCriteria || [],
        graph,
      },
    });
    const correlatedOpts = {
      ...opts,
      runId: workflowState.runId,
      traceId: workflowState.traceId,
      run_id: workflowState.run_id,
      trace_id: workflowState.trace_id,
    };
    // The audit trail is streamed as it is produced: a crashed run still
    // leaves on disk everything it had time to emit.
    const sink = resolveLogSink(opts.logSink ?? this.logSink);
    let sinkFailed = false;

    for await (const event of this._runInternal(
      executionPlan,
      correlatedOpts,
      compiledGraph,
      () => workflowState,
    )) {
      const previousLogs = workflowState.logs.length;
      workflowState = applyWorkflowEvent(workflowState, event);

      let sinkError = null;
      if (sink && !sinkFailed) {
        // Only the entries this event actually appended, so a record is
        // never written twice.
        for (const entry of workflowState.logs.slice(previousLogs)) {
          try {
            await sink.append(entry);
          } catch (e) {
            // An audit sink must never take the run down with it.
            sinkFailed = true;
            sinkError = e;
            break;
          }
        }
      }

      // Expose only a detached deep-frozen snapshot: the live canonical
      // state used for conditional routing must stay private so consumers
      // cannot tamper with edge selection between events.
      yield {
        ...event,
        runId: workflowState.runId,
        traceId: workflowState.traceId,
        run_id: workflowState.run_id,
        trace_id: workflowState.trace_id,
        workflowState: freezeWorkflowState(workflowState),
      };

      if (sinkError) {
        const soft = softErrorEvent('log_sink', sinkError, { ideaId: plan.ideaId });
        workflowState = applyWorkflowEvent(workflowState, soft);
        yield {
          ...soft,
          runId: workflowState.runId,
          traceId: workflowState.traceId,
          run_id: workflowState.run_id,
          trace_id: workflowState.trace_id,
          workflowState: freezeWorkflowState(workflowState),
        };
      }
    }
    if (sink && !sinkFailed) {
      try { await sink.flush?.(); } catch { /* the trail is already written */ }
    }
  }

  async *_runInternal(plan, callerOpts = {}, compiledGraph = null, getWorkflowState = null) {
    // R1: every write below lands on this private copy. The caller's object
    // and the Orchestrator instance stay free of run-scoped state, so two
    // concurrent runs on a shared instance cannot corrupt each other.
    const opts = { ...callerOpts };
    const level = opts.governance ?? 'supervise';
    const maxSteps = opts.maxSteps ?? 20;
    const doRecall = opts.recall !== false;
    const doRemember = opts.remember !== false;
    const doOffload = opts.offload !== false;
    const doAutoDistill = opts.autoDistill === true;
    const waitGate = opts.waitGate !== false;
    // Node and tool gates never block unless the caller explicitly asks for
    // it. Opting in is only safe when the caller owns the run's lifetime.
    const waitNodeGate = opts.waitNodeGate === true;
    const scopeResolved = this._resolveRunScope(opts);
    const graph = compiledGraph || compileWorkflowGraph(plan.graph || declareWorkflowGraph(plan.steps || []));
    // R3: cooperative cancellation and a per-step deadline.
    const signal = opts.signal || null;
    const stepTimeoutMs = Number.isInteger(opts.stepTimeoutMs) && opts.stepTimeoutMs > 0
      ? opts.stepTimeoutMs
      : null;

    if (signal?.aborted) {
      yield { type: 'cancelled', reason: 'signal', ts: new Date().toISOString() };
      return;
    }

    yield {
      type: 'start', ideaId: plan.ideaId, goal: plan.goal,
      graph: graph.definition,
      quant: this._quantSnapshot(), degraded: plan.degraded || null,
      scope: scopeResolved, ts: new Date().toISOString(),
    };

    // --- P2: cheap frame control ---
    let frameAssessment = null;
    let frameGateSignal = null;
    try {
      const p2 = await runP2Hooks({
        plan, opts, llm: this.llm, agents: this.agents,
      });
      for (const ev of p2.events || []) yield ev;
      if (p2.effectiveFrame && p2.effectiveFrame !== (opts.frame || plan.goal)) {
        opts.frame = p2.effectiveFrame;
      }
      frameAssessment = p2.assessment || null;
      frameGateSignal = p2.gate || null;
      if (p2.gate?.open && opts.waitFrameGate !== false) {
        if (this.governance) {
          const { gateId, promise } = this.governance.open({
            ideaId: plan.ideaId,
            type: 'frame_review',
            requiredRole: opts.frameGateRole || 'analyst',
            payload: {
              original: p2.original,
              assessment: p2.assessment,
              reframes: p2.reframes,
              suggested: p2.chosen,
            },
            evaluation: { reason: p2.gate.reason, quality: p2.assessment?.quality },
          });
          yield {
            type: 'gate', gateId, gateType: 'frame_review', status: 'pending_review',
            recommendation: 'reframe', frame: true,
            ts: new Date().toISOString(),
          };
          if (opts.waitGate !== false) {
            try {
              const decision = await promise;
              if (decision?.frame) opts.frame = decision.frame;
              else if (decision?.status === 'accept_suggested' && p2.chosen) opts.frame = p2.chosen.frame;
            } catch (e) { yield softErrorEvent('recall_layered_items', e); }
          }
        }
      }
    } catch (e) { yield softErrorEvent('frame_control', e); }

    let contextBlock = '';
    if (doRecall) {
      if (this._hasLayered()) {
        try {
          contextBlock = await this.layered.buildContextBlock(plan.goal, {
            ideaId: plan.ideaId, k: this.recallK,
            scopes: scopeResolved.scopes, tenantId: scopeResolved.tenantId,
            scope: scopeResolved.scope, scopeId: scopeResolved.scopeId,
            userId: opts.userId ?? this.scopeDefaults.userId,
            teamId: opts.teamId ?? this.scopeDefaults.teamId,
            organizationId: opts.organizationId ?? this.scopeDefaults.organizationId,
          });
          if (contextBlock) {
            const snap = this.layered.snapshot(plan.ideaId);
            let items = [];
            try {
              const rec = await this.layered.recall(plan.goal, {
                ideaId: plan.ideaId, k: this.recallK * 2, layers: ['L1', 'L2'],
              });
              items = [...(rec.l1 || []), ...(rec.l2 || [])]
                .filter((f) => f && f.content)
                .slice(0, this.recallK * 2)
                .map((f) => ({ id: f.id, score: f.score ?? null, text: f.content }));
            } catch (e) { yield softErrorEvent('recall_layered', e); }
            yield {
              type: 'recall', ideaId: plan.ideaId, source: 'layered',
              stats: snap.stats, preview: contextBlock.slice(0, 400),
              items, scope: scopeResolved, ts: new Date().toISOString(),
            };
          }
        } catch (e) { yield softErrorEvent('recall_context', e); }
      } else if (this._hasVectorMemory()) {
        let recalled = [];
        try { recalled = await this.memory.recall(plan.ideaId, plan.goal, this.recallK); } catch { recalled = []; }
        if (recalled.length) {
          contextBlock = "Contexte pertinent (memoire de l'idee) :\n" + recalled.map((r) => `- ${r.text}`).join('\n');
          yield { type: 'recall', ideaId: plan.ideaId, source: 'vector', items: recalled.map((r) => ({ id: r.id, score: r.score, text: r.text })), ts: new Date().toISOString() };
        }
      }
    }

    try {
      // R1: the result stays on the private per-run copy. It used to be
      // stashed on `this`, which two concurrent runs would overwrite.
      const pos = await this._injectPositionning(plan, opts, scopeResolved);
      opts._lastPositionning = pos;
      for (const failure of pos?.failures || []) {
        yield softErrorEvent('positionning_fact', failure, { ideaId: plan.ideaId });
      }
      if (pos) {
        if (pos.extraContext) contextBlock = (contextBlock || '') + pos.extraContext;
        yield {
          type: 'positionning', ideaId: plan.ideaId, mode: pos.mode,
          kayrosIndex: pos.kayrosIndex, competitors: pos.competitors,
          facts: pos.facts, preview: pos.preview, ts: new Date().toISOString(),
        };
      }
    } catch (e) { yield softErrorEvent('positionning', e, { ideaId: plan.ideaId }); }

    let count = 0;
    const agentOutputs = [];
    // The walk budget is a backstop only: it must sit strictly above the
    // orchestrator's own guard so the graceful `halt` event fires first and
    // consumers never see a raw traversal exception.
    for (const { node } of graph.walk({
      state: getWorkflowState || {},
      maxSteps: maxSteps + 1,
      from: opts._resumeFrom || null,
    })) {
      const s = node.step;
      if (signal?.aborted) {
        yield { type: 'cancelled', reason: 'signal', ts: new Date().toISOString() };
        return;
      }
      if (count++ >= maxSteps) {
        yield { type: 'halt', reason: 'maxSteps', ts: new Date().toISOString() };
        return;
      }
      // --- Human gate declared on the node itself (spec section 5) ---
      // The checkpoint belongs to the topology: it is opened before the node
      // runs, not hard-wired after the walk.
      //
      // Default is SUSPEND, not BLOCK. Awaiting a human decision inside the
      // run only works for a caller that holds the run open; anything else --
      // an HTTP request, a scheduled job, the SSE route -- hangs forever.
      // So the run emits the gate, returns a resumable `pending_review`, and
      // hands control back. `waitNodeGate: true` opts into blocking.
      // A resumed node's gate was just approved by a human: reopening it here
      // would suspend the run again on the very decision that released it.
      const gateAlreadyApproved = opts._resumeGateApproved === true && node.id === opts._resumeFrom;
      if (node.gate && !gateAlreadyApproved) {
        if (!this.governance) {
          yield {
            type: 'degraded', stepId: s.id, nodeId: node.id, agent: s.agent,
            reason: 'gate_unavailable',
            message: `node ${node.id} declares gate ${node.gate.type} but no governance is wired`,
            ts: new Date().toISOString(),
          };
          yield {
            type: 'final', status: 'blocked_veto',
            message: `Bloque : gate ${node.gate.type} impossible a ouvrir`,
            ts: new Date().toISOString(),
          };
          return;
        }
        const live = typeof getWorkflowState === 'function' ? getWorkflowState() : null;
        const { gateId, promise } = this.governance.open({
          ideaId: plan.ideaId,
          type: node.gate.type,
          requiredRole: node.gate.requiredRole,
          payload: { nodeId: node.id, agent: s.agent, description: s.description || null },
          evaluation: { review: live?.review ?? null, attempts: live?.nodeAttempts ?? {} },
        });
        yield {
          type: 'gate', gateId, gateType: node.gate.type, nodeId: node.id,
          status: 'pending_review', requiredRole: node.gate.requiredRole,
          ts: new Date().toISOString(),
        };
        if (!waitNodeGate) {
          yield {
            type: 'final', status: 'pending_review', gateId, gateType: node.gate.type,
            nodeId: node.id, requiredRole: node.gate.requiredRole,
            ts: new Date().toISOString(),
          };
          return;
        }
        let decision = null;
        try {
          decision = await promise;
        } catch (e) {
          yield {
            type: 'final', status: 'blocked_veto',
            message: `Bloque : erreur de resolution du gate ${node.gate.type} (${e?.message || e})`,
            ts: new Date().toISOString(),
          };
          return;
        }
        yield { type: 'gate_resolved', gateId, nodeId: node.id, decision, ts: new Date().toISOString() };
        if (decision?.decision === 'reject' || decision?.decision === 'veto') {
          yield {
            type: 'final', status: 'blocked_veto',
            message: `Bloque (veto) : ${decision.reason ?? 'veto humain'}`,
            ts: new Date().toISOString(),
          };
          return;
        }
      }

      const specialist = this.agents?.[s.agent];
      const deadline = { ms: stepTimeoutMs, signal, label: `node ${node.id}` };
      let observation, actionType = 'llm', actionName = 'complete';
      let usage = { tokensIn: 0, tokensOut: 0 };
      let modelUsed = null, degraded = null, channelEvent = null;
      let toolGateApproved = false;

      // --- Risky tool: a gate is opened systematically (spec section 5) ---
      // `tool.gate` used to be inert metadata; then v2 refused the call
      // outright. Neither is right: the point of a gate is that a human can
      // authorise the action.
      if (s.tool && this.tools && !specialist) {
        const declaredTool = this.tools.get?.(s.tool) || null;
        if (declaredTool?.gate === true) {
          if (!this.governance) {
            yield {
              type: 'degraded', stepId: s.id, nodeId: node.id, agent: s.agent,
              reason: 'permission_denied',
              message: `tool ${s.tool} requires a human gate but no governance is wired`,
              ts: new Date().toISOString(),
            };
          } else {
            const { gateId, promise } = this.governance.open({
              ideaId: plan.ideaId,
              type: 'tool_execution',
              requiredRole: opts.toolGateRole || 'comex',
              payload: { tool: s.tool, nodeId: node.id, toolInput: s.toolInput ?? {} },
              evaluation: { sideEffect: declaredTool.sideEffect || 'none' },
            });
            yield {
              type: 'gate', gateId, gateType: 'tool_execution', nodeId: node.id,
              tool: s.tool, status: 'pending_review', ts: new Date().toISOString(),
            };
            if (!waitNodeGate) {
              // Same rule as node gates: suspend, never hang. The risky call
              // has not happened and the run is resumable from this gate.
              yield {
                type: 'final', status: 'pending_review', gateId, gateType: 'tool_execution',
                nodeId: node.id, tool: s.tool, ts: new Date().toISOString(),
              };
              return;
            }
            let decision = null;
            try { decision = await promise; } catch { decision = null; }
            yield { type: 'gate_resolved', gateId, nodeId: node.id, decision, ts: new Date().toISOString() };
            toolGateApproved = decision?.decision === 'approve' || decision?.decision === 'validate';
            if (!toolGateApproved) {
              yield {
                type: 'degraded', stepId: s.id, nodeId: node.id, agent: s.agent,
                reason: 'permission_denied',
                message: `tool ${s.tool} was not approved`,
                ts: new Date().toISOString(),
              };
            }
          }
        }
      }

      if (s.tool && this.tools && !specialist) {
        try {
          // v2: the node's declared permission boundary is enforced here.
          // ToolRegistry metadata (sideEffect / gate) was inert before.
          const toolDef = this.tools.get?.(s.tool) || { name: s.tool, sideEffect: 'write' };
          assertToolAllowed(node, toolDef, {
            gateApproved: toolGateApproved || opts.toolGateApproved === true,
          });
          observation = await withDeadline(this.tools.call(s.tool, s.toolInput ?? {}, {
            ideaId: plan.ideaId,
            nodeId: node.id,
            signal,
            runId: opts.runId, traceId: opts.traceId,
            run_id: opts.run_id, trace_id: opts.trace_id,
          }), deadline);
          actionType = 'tool'; actionName = s.tool;
        } catch (e) {
          const message = String(e?.message || e);
          observation = { error: message };
          degraded = {
            reason: degradedReasonFor(
              e,
              message.startsWith('Workflow permissions:') ? 'permission_denied' : 'tool_error',
            ),
          };
        }
      } else if (specialist && typeof specialist.execute === 'function') {
        try {
          // Minimum required context (spec section 6): the role policy masks
          // every channel this role may not read. A Researcher that saw the
          // draft would confirm it instead of researching; a Verifier that
          // saw the memory block would judge against recalled material
          // instead of the declared criteria.
          const live = typeof getWorkflowState === 'function' ? getWorkflowState() : null;
          const scoped = buildRoleContext(s.agent, {
            state: live,
            contextBlock,
            successCriteria: plan.successCriteria || opts.successCriteria || [],
          });
          const res = await withDeadline(specialist.execute(s.input || s.description, {
            goal: plan.goal,
            ideaId: plan.ideaId,
            ...scoped,
            provider: opts.provider, sovereignty: opts.sovereignty,
            model: opts.model, signal,
            runId: opts.runId, traceId: opts.traceId,
            run_id: opts.run_id, trace_id: opts.trace_id,
          }), deadline);
          observation = res.output || res.text || res;
          actionType = 'specialized_agent'; actionName = s.agent;
          modelUsed = res.model || specialist.preferredModel || null;
          degraded = res.degraded || null;
          channelEvent = res.channel || null;
        } catch (e) {
          observation = `Agent ${s.agent} error: ${e?.message || e}`;
          degraded = { reason: degradedReasonFor(e, 'agent_error') };
        }
      } else {
        try {
          const messages = [];
          if (contextBlock) messages.push({ role: 'system', content: contextBlock });
          messages.push({ role: 'user', content: `${s.input || plan.goal}\n\nTache : ${s.description || ''}` });
          const res = await withDeadline(this.llm.complete({
            role: s.agent || 'Planner',
            messages,
            model: opts.model || specialist?.preferredModel || undefined,
            runId: opts.runId, traceId: opts.traceId,
            run_id: opts.run_id, trace_id: opts.trace_id,
          }, {
            provider: opts.provider, sovereignty: opts.sovereignty,
            signal,
            runId: opts.runId, traceId: opts.traceId,
            run_id: opts.run_id, trace_id: opts.trace_id,
          }), deadline);
          observation = res.text || res.output || '';
          usage = res.usage || usage;
          modelUsed = opts.model || specialist?.preferredModel || null;
          degraded = res.degraded || null;
        } catch (e) {
          observation = `LLM error: ${e?.message || e}`;
          degraded = { reason: degradedReasonFor(e, 'llm_error') };
        }
      }

      const obsText = typeof observation === 'string' ? observation : JSON.stringify(observation);
      agentOutputs.push({ agent: s.agent || 'agent', output: observation, degraded, model: modelUsed });

      this.memory?.addContribution?.({ actor: s.agent, content: obsText });
      if (doRemember && this._hasVectorMemory() && !this._hasLayered()) {
        try {
          await this.memory.remember({ id: `${plan.ideaId}:${s.id}:${count}`, ideaId: plan.ideaId, text: `[${s.agent}] ${obsText}` });
        } catch (e) { yield softErrorEvent('memory_remember', e, { nodeId: node.id }); }
      }

      if (this._hasLayered()) {
        try {
          this.layered.rememberL0({
            ideaId: plan.ideaId, step: s.id, agentRole: s.agent,
            kind: 'agent_scratch', content: obsText, summary: obsText.slice(0, 200),
          });
          if (obsText.length < 400 && obsText.length > 30) {
            await this.layered.addAtomicFact({
              ideaId: plan.ideaId, content: obsText.slice(0, 300), type: 'observation',
              actors: [s.agent], confidence: 0.55,
              sourceRefs: [{ type: 'agent', id: s.agent }],
            });
          }
        } catch (e) { yield softErrorEvent('memory_layered', e, { nodeId: node.id }); }
      }

      // A node may write a state channel only if the graph granted it that
      // write. This is the enforcement point that turns the declared
      // permission boundary into a real one for state, as assertToolAllowed
      // does for tools.
      if (channelEvent && typeof channelEvent === 'object' && channelEvent.type) {
        try {
          assertChannelWritable(node, channelEvent.type);
          yield {
            ...channelEvent,
            nodeId: node.id,
            agent: s.agent,
            ideaId: plan.ideaId,
            ts: new Date().toISOString(),
          };
        } catch (e) {
          degraded = { reason: 'permission_denied', message: String(e?.message || e) };
        }
      }

      if (degraded) {
        yield {
          type: 'degraded', stepId: s.id, nodeId: node.id, agent: s.agent,
          ...degraded, ts: new Date().toISOString(),
        };
      }

      yield {
        type: 'trace', stepId: s.id, nodeId: node.id, agent: s.agent,
        thought: `[${s.agent}] ${s.description || s.input || ''}`,
        action: { type: actionType, name: actionName },
        observation, usedContext: !!contextBlock,
        tokens: { in: usage.tokensIn, out: usage.tokensOut },
        quant: { modelUsed, agent: agentQuantInfo(specialist) },
        degraded, ts: new Date().toISOString(),
      };
    }

    if (doOffload && this._hasLayered()) {
      try {
        const refs = await this.layered.offload(plan.ideaId, null, {
          minContentLength: opts.offloadMinLength ?? 600,
        });
        if (refs.length) {
          yield { type: 'offload', ideaId: plan.ideaId, count: refs.length, refs: refs.slice(0, 5), ts: new Date().toISOString() };
        }
      } catch (e) { yield softErrorEvent('offload', e, { ideaId: plan.ideaId }); }
    }

    if (doAutoDistill && this._hasLayered() && typeof this.layered.autoDistillL2 === 'function') {
      try {
        const created = await this.layered.autoDistillL2(plan.ideaId, {
          minFacts: opts.distillMinFacts ?? 3,
          llm: opts.distillLlm ?? this.llm,
          distillFn: opts.distillFn || null,
          force: !!opts.distillForce,
          llmOpts: { provider: opts.provider, sovereignty: opts.sovereignty },
        });
        if (created.length) {
          yield { type: 'distill', ideaId: plan.ideaId, count: created.length, titles: created.map((s) => s.title), ts: new Date().toISOString() };
        }
      } catch (e) { yield softErrorEvent('distill', e); }
    }

    // Synthesis
    const synthAgent = this.agents?.Synthesizer;
    let synthesis = null;
    if (synthAgent && synthAgent.synthesize && agentOutputs.length > 0) {
      try {
        synthesis = await synthAgent.synthesize(agentOutputs, opts);
        if (synthesis.degraded) yield { type: 'degraded', agent: 'Synthesizer', ...synthesis.degraded, ts: new Date().toISOString() };
        yield {
          type: 'synthesis', agent: 'Synthesizer',
          output: synthesis.output, decision: synthesis.structured,
          quant: { modelUsed: synthesis.model || synthAgent.preferredModel || null, agent: agentQuantInfo(synthAgent) },
          degraded: synthesis.degraded || null, ts: new Date().toISOString(),
        };
      } catch (e) { yield softErrorEvent('synthesis', e); }
    }

    // --- P1 hooks ---
    let survivingOptions = opts.survivingOptions || null;
    let killedOptions = opts.killedOptions || null;
    let residualRisks = opts.residualRisks || null;
    try {
      const p1 = await runP1Hooks({
        plan, opts, agentOutputs, contextBlock, agents: this.agents, memory: this.memory,
      });
      for (const ev of p1.events || []) yield ev;
      if (p1.survivingOptions) survivingOptions = p1.survivingOptions;
      if (p1.killedOptions) killedOptions = p1.killedOptions;
      if (p1.residualRisks) residualRisks = p1.residualRisks;
    } catch (e) { yield softErrorEvent('hooks_p1', e); }

    // --- P3 + P4 ---
    let p34 = null;
    try {
      p34 = await runP3P4Hooks({
        plan, opts, agentOutputs, contextBlock,
        survivingOptions, killedOptions, residualRisks,
        frameAssessment, synthesis,
      });
      for (const ev of p34.events || []) yield ev;
      if (p34.residualRisks) residualRisks = p34.residualRisks;
      if (p34.criticalAssumptions && !opts.criticalAssumptions) opts.criticalAssumptions = p34.criticalAssumptions;
      if (p34.falsifiers && !opts.falsifiers) opts.falsifiers = p34.falsifiers;
    } catch (e) { yield softErrorEvent('hooks_p3p4', e); }

    // --- P0 packet ---
    let packet = compilePacket({
      ideaId: plan.ideaId, goal: plan.goal, frame: opts.frame || plan.goal,
      agentOutputs, synthesis,
      positionning: opts._lastPositionning || null,
      quant: this._quantSnapshot(),
      residualRisks: residualRisks || opts.residualRisks, falsifiers: opts.falsifiers || p34?.falsifiers,
      survivingOptions: survivingOptions || opts.survivingOptions, killedOptions: killedOptions || opts.killedOptions,
      frameAssessment: frameAssessment || opts.frameAssessment || null,
      frameGate: frameGateSignal || null,
      criticalAssumptions: opts.criticalAssumptions || p34?.criticalAssumptions || null,
      worldModel: p34?.world || null,
      decisionDebt: p34?.decisionDebt ?? null,
      revisitTriggers: p34?.revisitTriggers || null,
      adaptiveBudget: p34?.adaptiveBudget || null,
      preferredGateLevel: p34?.preferredGateLevel || null,
    });
    const epistemic = applyEpistemicPolicy(packet, {
      level,
      requireFalsifiers: opts.requireFalsifiers !== false,
      minConfidence: opts.minEpistemicConfidence ?? 0.4,
      allowDegradedGo: !!opts.allowDegradedGo,
    });
    packet = epistemic.packet;
    const gateView = renderPacketForGate(packet, opts.gateAudience || 'comex');

    yield {
      type: 'packet', ideaId: plan.ideaId, recommendation: packet.recommendation,
      epistemic: packet.epistemicStatus, assertion: epistemic.assertion,
      uncertainty: packet.uncertainty, gateView, changed: epistemic.changed,
      ts: new Date().toISOString(),
    };

    const answer = packet.synthesis?.output
      || (agentOutputs.length > 0
        ? `Synthese gouvernee pour: ${plan.goal}\n${agentOutputs.map((o) => `[${o.agent}] ${String(o.output ?? '').substring(0, 200)}`).join('\n')}`
        : `Synthese gouvernee pour: ${plan.goal}`);

    const sens = await classifySensitive(answer, { classifier: this.classifier });
    let gateType = policyFor({ sensitive: sens.sensitive }, level);
    const epiGate = policyForPacket(packet, { level, sensitive: sens.sensitive });
    if (!gateType && epiGate) gateType = epiGate;
    if (gateType && epiGate === 'comex_arbitrage') gateType = epiGate;

    // P3 multi-resolution
    const preferred = p34?.preferredGateLevel || packet.preferredGateLevel;
    if (preferred === 'heavy' && gateType !== 'comex_arbitrage') {
      gateType = gateType || 'comex_arbitrage';
    }

    if (gateType && this.governance) {
      const requiredRole = preferred === 'heavy' ? 'comex'
        : preferred === 'light' ? (opts.frameGateRole || 'analyst')
        : 'comex';
      const { gateId, promise } = this.governance.open({
        ideaId: plan.ideaId, type: gateType, requiredRole,
        payload: answer, packet: gateView,
        evaluation: {
          recommendation: packet.recommendation,
          epistemic: packet.epistemicStatus,
          assertion: epistemic.assertion,
          gateResolution: preferred || null,
          decisionDebt: packet.decisionDebt ?? null,
        },
      });
      yield {
        type: 'gate', gateId, gateType, status: 'pending_review',
        recommendation: packet.recommendation, packet: gateView,
        ts: new Date().toISOString(),
      };
      if (!waitGate) {
        yield {
          type: 'final', status: 'pending_review', gateId, gateType,
          answer, recommendation: packet.recommendation,
          epistemic: packet.epistemicStatus, assertion: epistemic.assertion,
          quant: this._quantSnapshot(), ts: new Date().toISOString(),
        };
        return;
      }
      try {
        const decision = await promise;
        yield {
          type: 'gate_resolved', gateId, decision,
          ts: new Date().toISOString(),
        };
        if (decision?.decision === 'reject' || decision?.decision === 'veto') {
          yield {
            type: 'final', status: 'blocked_veto',
            message: `Bloque (veto) : ${decision.reason ?? 'veto humain'}`,
            ts: new Date().toISOString(),
          };
          return;
        }
        if (decision?.decision === 'revise') {
          yield {
            type: 'final', status: 'revise',
            message: decision.reason ?? 'Revoir avant validation',
            ts: new Date().toISOString(),
          };
          return;
        }
        yield {
          type: 'final', status: 'validated_human', answer,
          recommendation: packet.recommendation, epistemic: packet.epistemicStatus,
          assertion: epistemic.assertion, quant: this._quantSnapshot(),
          ts: new Date().toISOString(),
        };
        return;
      } catch {
        yield {
          type: 'final', status: 'blocked_veto',
          message: 'Bloque (veto) : erreur lors de la resolution du gate',
          ts: new Date().toISOString(),
        };
        return;
      }
    }

    yield {
      type: 'final', status: 'auto', answer,
      recommendation: packet.recommendation,
      epistemic: packet.epistemicStatus,
      assertion: epistemic.assertion,
      quant: this._quantSnapshot(),
      ts: new Date().toISOString(),
    };
  }
}

export async function collect(gen) {
  const out = [];
  for await (const ev of gen) out.push(ev);
  return out;
}
