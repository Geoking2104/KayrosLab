// KayrosLab — Orchestrateur (Plan-and-Solve + ReAct), memory-aware, Planner LLM.
// Ref. specs techniques §3 (EF-15/16) + §6 (EF-17/18). Emet des ReActTrace en flux.
// Étendu pour LayeredMemory (L0–L3) : recall multi-couches + offload + distillation.

import { classifySensitive, policyFor } from './governance.mjs';
import { evaluateKpis, alertsToSignals } from './loop.mjs';
import { createAllAgents, AGENT_TYPES } from './agents/index.mjs';

/** @typedef {'Planner'|'Critic'|'DevilsAdvocate'|'RedTeam'|'Bisociateur'|'Synthesizer'} AgentType */
const AGENTS = AGENT_TYPES;

const PLANNER_SYSTEM =
  "Tu es le Planner de KayrosLab. Decompose l'objectif en 3 a 6 etapes d'ideation strategique. " +
  'Agents disponibles : Planner, Critic, DevilsAdvocate, RedTeam, Bisociateur, Synthesizer. ' +
  'La derniere etape doit etre Synthesizer. ' +
  'Reponds UNIQUEMENT par un tableau JSON, sans texte autour : ' +
  '[{"agent":"Planner","description":"..."},{"agent":"RedTeam","description":"..."},{"agent":"Synthesizer","description":"..."}]';

/** Extrait le premier tableau JSON equilibre. Renvoie la sous-chaine (tronquee si non fermee) ou null. */
export function extractFirstArray(s) {
  const start = s.indexOf('[');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return s.slice(start);
}

/** Recupere les objets {...} complets d'un tableau JSON eventuellement tronque. */
export function salvageObjects(raw) {
  const objs = [];
  let depth = 0, inStr = false, esc = false, startObj = -1;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth === 0) startObj = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && startObj >= 0) { try { objs.push(JSON.parse(raw.slice(startObj, i + 1))); } catch { /* objet invalide ignore */ } startObj = -1; } }
  }
  return objs;
}

/**
 * Extrait et valide un tableau d'etapes depuis la reponse LLM. Renvoie null si invalide.
 */
export function parsePlanSteps(text) {
  try {
    let s = String(text ?? '');
    s = s.replace(/<think>[\s\S]*?<\/think>/gi, ' ').replace(/<think>[\s\S]*$/i, ' ');
    s = s.replace(/```(?:json)?/gi, ' ');
    const raw = extractFirstArray(s);
    if (!raw) return null;
    let arr;
    try { arr = JSON.parse(raw); }
    catch { arr = salvageObjects(raw); }
    if (!Array.isArray(arr) || !arr.length) return null;
    const allowed = new Set(AGENTS);
    const steps = arr
      .filter((x) => x && typeof x.description === 'string' && allowed.has(x.agent))
      .slice(0, 8)
      .map((x, i) => ({ id: `s${i + 1}`, agent: x.agent, description: x.description, ...(x.tool ? { tool: x.tool } : {}) }));
    return steps.length ? steps : null;
  } catch { return null; }
}

export class Orchestrator {
  /**
   * @param {Object} opts
   * @param {Object} opts.llm
   * @param {Object} [opts.tools]
   * @param {Object} [opts.memory]          // MemoryService classique
   * @param {Object} [opts.layered]         // LayeredMemory (L0–L3) — optionnel mais recommandé
   * @param {Object} [opts.governance]
   * @param {Object} [opts.classifier]
   * @param {number} [opts.recallK=3]
   * @param {string} [opts.plannerModel]
   * @param {Object} [opts.agents]
   */
  constructor({ llm, tools = null, memory = null, layered = null, governance = null, classifier = null, recallK = 3, plannerModel = null, agents = null } = {}) {
    if (!llm) throw new Error('Orchestrator: llm (KayrosLLM) requis');
    this.llm = llm;
    this.tools = tools;
    this.memory = memory;
    this.layered = layered;                 // NEW
    this.governance = governance;
    this.classifier = classifier;
    this.recallK = recallK;
    this.plannerModel = plannerModel;
    this.agents = agents || createAllAgents({ llm, tools, memory });
  }

  _hasVectorMemory() { return !!this.memory && typeof this.memory.recall === 'function' && typeof this.memory.remember === 'function'; }
  _hasLayered() { return !!this.layered && typeof this.layered.recall === 'function'; }

  _fallbackSteps() {
    return [
      { id: 's1', description: 'Cadrer et planifier la reponse', agent: 'Planner' },
      { id: 's2', description: 'Critiquer et detecter les angles morts', agent: 'Critic' },
      { id: 's3', description: 'Attaquer la robustesse (kill shots)', agent: 'RedTeam' },
      { id: 's4', description: 'Synthetiser une reponse arbitrable', agent: 'Synthesizer' },
    ];
  }

  async plan(goal, ctx = {}) {
    const ideaId = ctx.ideaId ?? 'idea';
    if (ctx.llmPlan === false) return { ideaId, goal, generatedBy: 'fallback', steps: this._fallbackSteps() };
    try {
      const opts = {};
      if (ctx.provider) opts.provider = ctx.provider;
      if (ctx.sovereignty) opts.sovereignty = ctx.sovereignty;
      const res = await this.llm.complete(
        { role: 'Planner', model: ctx.model ?? this.plannerModel, temperature: 0.2, think: false, messages: [
          { role: 'system', content: PLANNER_SYSTEM },
          { role: 'user', content: `Objectif : ${goal}` },
        ] },
        opts
      );
      const steps = parsePlanSteps(res.text);
      if (steps) return { ideaId, goal, generatedBy: 'llm', steps };
    } catch (e) { /* repli silencieux */ }
    return { ideaId, goal, generatedBy: 'fallback', steps: this._fallbackSteps() };
  }

  /**
   * Phase SOLVE (ReAct) : rappel mémoire (classique ou layered) -> étapes -> gouvernance.
   */
  async *run(plan, opts = {}) {
    const level = opts.governance ?? 'supervise';
    const maxSteps = opts.maxSteps ?? 20;
    const doRecall = opts.recall !== false;
    const doRemember = opts.remember !== false;
    const doOffload = opts.offload !== false;

    // 1) RAPPEL mémoire — préfère LayeredMemory si disponible
    let contextBlock = '';
    if (doRecall) {
      if (this._hasLayered()) {
        try {
          contextBlock = await this.layered.buildContextBlock(plan.goal, { ideaId: plan.ideaId, k: this.recallK });
          if (contextBlock) {
            const snap = this.layered.snapshot(plan.ideaId);
            yield {
              type: 'recall',
              ideaId: plan.ideaId,
              source: 'layered',
              stats: snap.stats,
              preview: contextBlock.slice(0, 400),
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

      if (specialist && specialist.execute) {
        const res = await specialist.execute(s.description, {
          goal: plan.goal, context: contextBlock,
          provider: opts.provider, sovereignty: opts.sovereignty,
        });
        observation = res.output;
        actionType = 'specialized_agent';
        actionName = s.agent;
        agentOutputs.push(res);
      } else {
        const messages = [];
        if (contextBlock) messages.push({ role: 'system', content: contextBlock });
        messages.push({ role: 'user', content: `${plan.goal}\n\nTache : ${s.description}` });

        const llmRes = await this.llm.complete({ role: s.agent, messages }, opts);
        observation = llmRes.text;
        usage = llmRes.usage;
        if (s.tool && this.tools) { observation = await this.tools.call(s.tool, s.toolInput ?? {}, { ideaId: plan.ideaId }); actionType = 'tool'; actionName = s.tool; }
      }

      const obsText = typeof observation === 'string' ? observation : JSON.stringify(observation);

      // Enregistrement classique
      this.memory?.addContribution?.({ actor: s.agent, content: obsText });
      if (doRemember && this._hasVectorMemory()) {
        try { await this.memory.remember({ id: `${plan.ideaId}:${s.id}:${count}`, ideaId: plan.ideaId, text: `[${s.agent}] ${obsText}` }); } catch { /* best-effort */ }
      }

      // Layered path : L0 working item + best-effort L1 fact
      if (this._hasLayered()) {
        try {
          this.layered.rememberL0({
            ideaId: plan.ideaId,
            step: s.id,
            agentRole: s.agent,
            kind: 'agent_scratch',
            content: obsText,
            summary: obsText.slice(0, 200),
          });
          // Distillation légère : si l'observation est courte et assertive → L1
          if (obsText.length < 400 && obsText.length > 30) {
            await this.layered.addAtomicFact({
              ideaId: plan.ideaId,
              content: obsText.slice(0, 300),
              type: 'observation',
              actors: [s.agent],
              confidence: 0.55,
              sourceRefs: [{ type: 'agent', id: s.agent }],
            });
          }
        } catch { /* soft */ }
      }

      yield {
        type: 'trace', stepId: s.id, agent: s.agent,
        thought: `[${s.agent}] ${s.description}`,
        action: { type: actionType, name: actionName },
        observation,
        usedContext: !!contextBlock,
        tokens: { in: usage.tokensIn, out: usage.tokensOut },
        ts: new Date().toISOString(),
      };
    }

    // Fin de cycle : offload L0 pour alléger le prochain tour
    if (doOffload && this._hasLayered()) {
      try {
        const refs = await this.layered.offload(plan.ideaId);
        if (refs.length) {
          yield { type: 'offload', ideaId: plan.ideaId, count: refs.length, refs: refs.slice(0, 5), ts: new Date().toISOString() };
        }
      } catch { /* soft */ }
    }

    // Synthesize
    const synthAgent = this.agents?.Synthesizer;
    if (synthAgent && synthAgent.synthesize && agentOutputs.length > 0) {
      const synthesis = await synthAgent.synthesize(agentOutputs, opts);
      yield { type: 'synthesis', agent: 'Synthesizer', output: synthesis.output, decision: synthesis.structured, ts: new Date().toISOString() };
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
      yield { type: 'final', status: 'validated_human', answer, ts: new Date().toISOString() };
      return;
    }
    yield { type: 'final', status: 'auto', answer, ts: new Date().toISOString() };
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
    if (this._hasVectorMemory()) {
      for (const s of signals) { try { await this.memory.remember({ id: s.id, ideaId, text: s.contenu }); } catch { /* best-effort */ } }
    } else {
      for (const s of signals) this.memory?.addContribution?.({ actor: 'Ecouter', content: s.contenu });
    }
    // Aussi en L1 si layered disponible
    if (this._hasLayered()) {
      for (const s of signals) {
        try {
          await this.layered.addAtomicFact({
            ideaId,
            content: s.contenu,
            type: 'metric',
            actors: ['monitor'],
            confidence: 0.8,
            tags: ['kpi-alert'],
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
