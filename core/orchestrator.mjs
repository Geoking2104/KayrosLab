// KayrosLab — Orchestrateur (Plan-and-Solve + ReAct), memory-aware, Planner LLM.
// Unified plan via PlannerAgent; quant events; autoDistill uses this.llm by default.
// L3 scope: merges engine defaults (tenantId, userId, …) with run opts.

import { classifySensitive, policyFor } from './governance.mjs';
import { evaluateKpis, alertsToSignals } from './loop.mjs';
import { createAllAgents, AGENT_TYPES } from './agents/index.mjs';
import { defaultFallbackSteps } from './agents/planner-agent.mjs';
import { parsePlanSteps, ensureSynthesizerLast, extractFirstArray, salvageObjects } from './plan-parse.mjs';
import { resolveMemoryScope } from './memory-scope.mjs';

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
    // A: engine-level L3 defaults
    tenantId = null,
    defaultScope = null,
    defaultScopeId = null,
    userId = null,
    teamId = null,
    organizationId = null,
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

  /** Merge run opts over engine scope defaults. */
  _resolveRunScope(opts = {}) {
    return resolveMemoryScope(opts, this.scopeDefaults);
  }

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

  _fallbackSteps() {
    return defaultFallbackSteps();
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
          provider: ctx.provider,
          sovereignty: ctx.sovereignty,
          model,
          llmPlan: ctx.llmPlan,
        });
        if (result?.steps?.length) {
          return {
            ideaId,
            goal,
            generatedBy: result.generatedBy || 'llm',
            steps: ensureSynthesizerLast(result.steps),
            quant: {
              modelUsed: model || null,
              agent: agentQuantInfo(plannerAgent),
              snapshot: this._quantSnapshot(),
            },
            degraded: result.degraded || null,
          };
        }
      } catch { /* soft → fallback */ }
    } else {
      try {
        const opts = {};
        if (ctx.provider) opts.provider = ctx.provider;
        if (ctx.sovereignty) opts.sovereignty = ctx.sovereignty;
        const res = await this.llm.complete(
          {
            role: 'Planner', model, temperature: 0.2, think: false,
            messages: [
              { role: 'system', content: 'Tu es le Planner. Reponds UNIQUEMENT par un tableau JSON d\'etapes.' },
              { role: 'user', content: `Objectif : ${goal}` },
            ],
          },
          opts,
        );
        const steps = parsePlanSteps(res.text);
        if (steps) {
          return {
            ideaId, goal, generatedBy: 'llm', steps: ensureSynthesizerLast(steps),
            quant: { modelUsed: model || null, agent: null, snapshot: this._quantSnapshot() },
            degraded: res.degraded || null,
          };
        }
      } catch { /* soft */ }
    }

    return { ideaId, goal, generatedBy: 'fallback', steps: this._fallbackSteps(), quant: this._quantSnapshot() };
  }

  async *run(plan, opts = {}) {
    const level = opts.governance ?? 'supervise';
    const maxSteps = opts.maxSteps ?? 20;
    const doRecall = opts.recall !== false;
    const doRemember = opts.remember !== false;
    const doOffload = opts.offload !== false;
    const doAutoDistill = opts.autoDistill === true;

    const scopeResolved = this._resolveRunScope(opts);

    yield {
      type: 'start',
      ideaId: plan.ideaId,
      goal: plan.goal,
      quant: this._quantSnapshot(),
      degraded: plan.degraded || null,
      scope: scopeResolved,
      ts: new Date().toISOString(),
    };

    let contextBlock = '';
    if (doRecall) {
      if (this._hasLayered()) {
        try {
          contextBlock = await this.layered.buildContextBlock(plan.goal, {
            ideaId: plan.ideaId,
            k: this.recallK,
            scopes: scopeResolved.scopes,
            tenantId: scopeResolved.tenantId,
            scope: scopeResolved.scope,
            scopeId: scopeResolved.scopeId,
            userId: opts.userId ?? this.scopeDefaults.userId,
            teamId: opts.teamId ?? this.scopeDefaults.teamId,
            organizationId: opts.organizationId ?? this.scopeDefaults.organizationId,
          });
          if (contextBlock) {
            const snap = this.layered.snapshot(plan.ideaId);
            yield {
              type: 'recall', ideaId: plan.ideaId, source: 'layered',
              stats: snap.stats, preview: contextBlock.slice(0, 400),
              scope: scopeResolved,
              ts: new Date().toISOString(),
            };
          }
        } catch { /* soft */ }
      } else if (this._hasVectorMemory()) {
        let recalled = [];
        try { recalled = await this.memory.recall(plan.ideaId, plan.goal, this.recallK); } catch { recalled = []; }
        if (recalled.length) {
          contextBlock = 'Contexte pertinent (memoire de l\'idee) :\n' + recalled.map((r) => `- ${r.text}`).join('\n');
          yield { type: 'recall', ideaId: plan.ideaId, source: 'vector', items: recalled.map((r) => ({ id: r.id, score: r.score, text: r.text })), ts: new Date().toISOString() };
        }
      }
    }

    let count = 0;
    const agentOutputs = [];
    for (const s of plan.steps) {
      if (count++ >= maxSteps) { yield { type: 'halt', reason: 'maxSteps', ts: new Date().toISOString() }; break; }

      const specialist = this.agents?.[s.agent];
      let observation, actionType = 'llm', actionName = 'complete', usage = { tokensIn: 0, tokensOut: 0 };
      let modelUsed = null;
      let degraded = null;

      if (s.tool && this.tools && !specialist) {
        observation = await this.tools.call(s.tool, s.toolInput ?? {}, { ideaId: plan.ideaId });
        actionType = 'tool';
        actionName = s.tool;
      } else if (specialist && specialist.execute) {
        const res = await specialist.execute(s.description, {
          goal: plan.goal, context: contextBlock,
          provider: opts.provider, sovereignty: opts.sovereignty,
          model: opts.model,
        });
        observation = res.output;
        actionType = 'specialized_agent';
        actionName = s.agent;
        modelUsed = res.model || specialist.preferredModel || null;
        degraded = res.degraded || null;
        agentOutputs.push(res);
      } else {
        const messages = [];
        if (contextBlock) messages.push({ role: 'system', content: contextBlock });
        messages.push({ role: 'user', content: `${plan.goal}\n\nTache : ${s.description}` });
        const model = opts.model || specialist?.preferredModel || undefined;
        const llmRes = await this.llm.complete({ role: s.agent, messages, model }, opts);
        observation = llmRes.text;
        usage = llmRes.usage;
        modelUsed = model || null;
        degraded = llmRes.degraded || null;
      }

      const obsText = typeof observation === 'string' ? observation : JSON.stringify(observation);

      this.memory?.addContribution?.({ actor: s.agent, content: obsText });
      if (doRemember && this._hasVectorMemory() && !this._hasLayered()) {
        try { await this.memory.remember({ id: `${plan.ideaId}:${s.id}:${count}`, ideaId: plan.ideaId, text: `[${s.agent}] ${obsText}` }); } catch { /* soft */ }
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
          type: 'degraded',
          stepId: s.id,
          agent: s.agent,
          ...degraded,
          ts: new Date().toISOString(),
        };
      }

      yield {
        type: 'trace', stepId: s.id, agent: s.agent,
        thought: `[${s.agent}] ${s.description}`,
        action: { type: actionType, name: actionName },
        observation, usedContext: !!contextBlock,
        tokens: { in: usage.tokensIn, out: usage.tokensOut },
        quant: { modelUsed, agent: agentQuantInfo(specialist) },
        degraded,
        ts: new Date().toISOString(),
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
          llmOpts: {
            provider: opts.provider,
            sovereignty: opts.sovereignty,
          },
        });
        if (created.length) {
          yield {
            type: 'distill',
            ideaId: plan.ideaId,
            count: created.length,
            titles: created.map((s) => s.title),
            ts: new Date().toISOString(),
          };
        }
      } catch { /* soft */ }
    }

    const synthAgent = this.agents?.Synthesizer;
    if (synthAgent && synthAgent.synthesize && agentOutputs.length > 0) {
      const synthesis = await synthAgent.synthesize(agentOutputs, opts);
      if (synthesis.degraded) {
        yield { type: 'degraded', agent: 'Synthesizer', ...synthesis.degraded, ts: new Date().toISOString() };
      }
      yield {
        type: 'synthesis', agent: 'Synthesizer',
        output: synthesis.output, decision: synthesis.structured,
        quant: { modelUsed: synthesis.model || synthAgent.preferredModel || null, agent: agentQuantInfo(synthAgent) },
        degraded: synthesis.degraded || null,
        ts: new Date().toISOString(),
      };
    }

    const answer = agentOutputs.length > 0
      ? `Synthese gouvernee pour: ${plan.goal}\n${agentOutputs.map((o) => `[${o.agent}] ${o.output?.substring(0, 200)}`).join('\n')}`
      : `Synthese gouvernee pour: ${plan.goal}`;
    const sens = await classifySensitive(answer, { classifier: this.classifier });
    const gateType = policyFor({ sensitive: sens.sensitive }, level);

    if (gateType && this.governance) {
      const { gateId, promise } = this.governance.open({ ideaId: plan.ideaId, type: gateType, requiredRole: 'comex', payload: answer });
      yield { type: 'gate', gateId, gateType, status: 'pending_review', ts: new Date().toISOString() };
      const res = await promise;
      if (res.decision === 'reject') { yield { type: 'final', status: 'blocked_veto', message: `Bloque (veto) : ${res.reason}`, ts: new Date().toISOString() }; return; }
      if (res.decision === 'revise') { yield { type: 'final', status: 'revise', message: res.reason, ts: new Date().toISOString() }; return; }
      yield { type: 'final', status: 'validated_human', answer, quant: this._quantSnapshot(), ts: new Date().toISOString() };
      return;
    }
    yield { type: 'final', status: 'auto', answer, quant: this._quantSnapshot(), ts: new Date().toISOString() };
  }

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

    const milestones = decision.milestones ?? [];
    let ressources = null, projections = null;
    if (hasTool('estimate_resources')) {
      try { ressources = await this.tools.call('estimate_resources', { milestones, costHypotheses: decision.costHypotheses ?? {} }, { ideaId }); } catch { ressources = null; }
    }
    if (hasTool('simulate_trajectory') && Array.isArray(decision.scenarios) && decision.scenarios.length) {
      try { projections = await this.tools.call('simulate_trajectory', { scenarios: decision.scenarios, variables: decision.variables ?? [], iterations: ctx.iterations, seed: ctx.seed }, { ideaId }); } catch { projections = null; }
    }
    const roadmap = {
      jalons: milestones, raci: decision.raci ?? [], ressources,
      kpis: decision.kpis ?? [], risques: decision.risques ?? [], gatesFuturs: decision.gatesFuturs ?? [],
    };
    this.memory?.addContribution?.({ actor: 'Projeter', content: `roadmap Go (${milestones.length} jalons)` });
    return { ...base, status: 'Go', roadmap, projections };
  }

  async monitorProjection({ kpis = [], readings = [] } = {}, ctx = {}) {
    const ideaId = ctx.ideaId ?? 'idea';
    const { alerts } = evaluateKpis(kpis, readings);
    const signals = alertsToSignals(alerts, { ideaId });
    if (this._hasVectorMemory() && !this._hasLayered()) {
      for (const s of signals) { try { await this.memory.remember({ id: s.id, ideaId, text: s.contenu }); } catch { /* soft */ } }
    } else {
      for (const s of signals) this.memory?.addContribution?.({ actor: 'Ecouter', content: s.contenu });
    }
    if (this._hasLayered()) {
      for (const s of signals) {
        try {
          await this.layered.addAtomicFact({
            ideaId, content: s.contenu, type: 'metric', actors: ['monitor'], confidence: 0.8, tags: ['kpi-alert'],
          });
        } catch { /* soft */ }
      }
    }
    const reArbitrage = alerts.length
      ? { type: 're-arbitrage', ideaId, reasons: alerts.map((a) => a.kpiId), ts: new Date().toISOString() }
      : null;
    return { alerts, signals, reArbitrage };
  }
}

export async function collect(gen) {
  const out = [];
  for await (const ev of gen) out.push(ev);
  return out;
}
