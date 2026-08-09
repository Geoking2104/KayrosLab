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

const AGENTS = AGENT_TYPES;

export { parsePlanSteps, extractFirstArray, salvageObjects, ensureSynthesizerLast };

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
    quantGuidance = null,
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
    if (ctx.llmPlan === false) {
      return { ideaId, goal, generatedBy: 'fallback', steps: this._fallbackSteps(), quant: this._quantSnapshot() };
    }
    const plannerAgent = this.agents?.Planner;
    const model = ctx.model ?? plannerAgent?.preferredModel ?? this.plannerModel ?? undefined;
    if (plannerAgent && typeof plannerAgent.createPlan === 'function') {
      try {
        const result = await plannerAgent.createPlan(goal, {
          provider: ctx.provider, sovereignty: ctx.sovereignty, model, llmPlan: ctx.llmPlan,
        });
        if (result?.steps?.length) {
          return {
            ideaId, goal, generatedBy: result.generatedBy || 'llm',
            steps: ensureSynthesizerLast(result.steps),
            quant: { modelUsed: model || null, agent: agentQuantInfo(plannerAgent), snapshot: this._quantSnapshot() },
            degraded: result.degraded || null,
          };
        }
      } catch { /* soft */ }
    }
    return { ideaId, goal, generatedBy: 'fallback', steps: this._fallbackSteps(), quant: this._quantSnapshot() };
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
    for (const p of payloads || []) {
      try {
        const fact = await this.layered.addAtomicFact(p);
        created.push({ id: fact.id, type: fact.type, content: fact.content.slice(0, 120) });
      } catch { /* soft */ }
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
      extraContext,
    };
  }

  async *run(plan, opts = {}) {
    const level = opts.governance ?? 'supervise';
    const maxSteps = opts.maxSteps ?? 20;
    const doRecall = opts.recall !== false;
    const doRemember = opts.remember !== false;
    const doOffload = opts.offload !== false;
    const doAutoDistill = opts.autoDistill === true;
    const waitGate = opts.waitGate !== false;
    const scopeResolved = this._resolveRunScope(opts);

    yield {
      type: 'start', ideaId: plan.ideaId, goal: plan.goal,
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
            } catch { /* soft */ }
          }
        }
      }
    } catch { /* soft */ }

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
            } catch { /* soft */ }
            yield {
              type: 'recall', ideaId: plan.ideaId, source: 'layered',
              stats: snap.stats, preview: contextBlock.slice(0, 400),
              items, scope: scopeResolved, ts: new Date().toISOString(),
            };
          }
        } catch { /* soft */ }
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
      const pos = await this._injectPositionning(plan, opts, scopeResolved);
      this._lastPositionning = pos;
      opts._lastPositionning = pos;
      if (pos) {
        if (pos.extraContext) contextBlock = (contextBlock || '') + pos.extraContext;
        yield {
          type: 'positionning', ideaId: plan.ideaId, mode: pos.mode,
          kayrosIndex: pos.kayrosIndex, competitors: pos.competitors,
          facts: pos.facts, preview: pos.preview, ts: new Date().toISOString(),
        };
      }
    } catch { /* soft */ }

    let count = 0;
    const agentOutputs = [];
    for (const s of plan.steps || []) {
      if (count++ >= maxSteps) { yield { type: 'halt', reason: 'maxSteps', ts: new Date().toISOString() }; break; }
      const specialist = this.agents?.[s.agent];
      let observation, actionType = 'llm', actionName = 'complete';
      let usage = { tokensIn: 0, tokensOut: 0 };
      let modelUsed = null, degraded = null;

      if (s.tool && this.tools && !specialist) {
        try {
          observation = await this.tools.call(s.tool, s.toolInput ?? {}, { ideaId: plan.ideaId });
          actionType = 'tool'; actionName = s.tool;
        } catch (e) {
          observation = { error: String(e?.message || e) };
          degraded = { reason: 'tool_error' };
        }
      } else if (specialist && typeof specialist.execute === 'function') {
        try {
          const res = await specialist.execute(s.input || s.description, {
            goal: plan.goal, context: contextBlock,
            provider: opts.provider, sovereignty: opts.sovereignty,
            model: opts.model,
          });
          observation = res.output || res.text || res;
          actionType = 'specialized_agent'; actionName = s.agent;
          modelUsed = res.model || specialist.preferredModel || null;
          degraded = res.degraded || null;
        } catch (e) {
          observation = `Agent ${s.agent} error: ${e?.message || e}`;
          degraded = { reason: 'agent_error' };
        }
      } else {
        try {
          const messages = [];
          if (contextBlock) messages.push({ role: 'system', content: contextBlock });
          messages.push({ role: 'user', content: `${s.input || plan.goal}\n\nTache : ${s.description || ''}` });
          const res = await this.llm.complete({
            role: s.agent || 'Planner',
            messages,
            model: opts.model || specialist?.preferredModel || undefined,
          }, { provider: opts.provider, sovereignty: opts.sovereignty });
          observation = res.text || res.output || '';
          usage = res.usage || usage;
          modelUsed = opts.model || specialist?.preferredModel || null;
          degraded = res.degraded || null;
        } catch (e) {
          observation = `LLM error: ${e?.message || e}`;
          degraded = { reason: 'llm_error' };
        }
      }

      const obsText = typeof observation === 'string' ? observation : JSON.stringify(observation);
      agentOutputs.push({ agent: s.agent || 'agent', output: observation, degraded, model: modelUsed });

      this.memory?.addContribution?.({ actor: s.agent, content: obsText });
      if (doRemember && this._hasVectorMemory() && !this._hasLayered()) {
        try {
          await this.memory.remember({ id: `${plan.ideaId}:${s.id}:${count}`, ideaId: plan.ideaId, text: `[${s.agent}] ${obsText}` });
        } catch { /* soft */ }
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
        } catch { /* soft */ }
      }

      if (degraded) {
        yield {
          type: 'degraded', stepId: s.id, agent: s.agent,
          ...degraded, ts: new Date().toISOString(),
        };
      }

      yield {
        type: 'trace', stepId: s.id, agent: s.agent,
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
      } catch { /* soft */ }
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
      } catch { /* soft */ }
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
      } catch { /* soft */ }
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
    } catch { /* soft */ }

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
    } catch { /* soft */ }

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
