// KayrosLab — Orchestrateur (Plan-and-Solve + ReAct), memory-aware, Planner LLM.
// Ref. specs techniques §3 (EF-15/16) + §6 (EF-17/18). Emet des ReActTrace en flux.

import { classifySensitive, policyFor } from './governance.mjs';

/** @typedef {'Planner'|'Critic'|'DevilsAdvocate'|'RedTeam'|'Bisociateur'|'Synthesizer'} AgentType */

const AGENTS = ['Planner', 'Critic', 'DevilsAdvocate', 'RedTeam', 'Bisociateur', 'Synthesizer'];

const PLANNER_SYSTEM =
  "Tu es le Planner de KayrosLab. Decompose l'objectif en 3 a 6 etapes d'ideation strategique. " +
  'Agents disponibles : Planner, Critic, DevilsAdvocate, RedTeam, Bisociateur, Synthesizer. ' +
  'La derniere etape doit etre Synthesizer. ' +
  'Reponds UNIQUEMENT par un tableau JSON, sans texte autour : ' +
  '[{"agent":"Planner","description":"..."},{"agent":"RedTeam","description":"..."},{"agent":"Synthesizer","description":"..."}]';

/** Extrait et valide un tableau d'etapes depuis la reponse LLM. Renvoie null si invalide. */
export function parsePlanSteps(text) {
  try {
    const m = String(text ?? '').match(/\[[\s\S]*\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr) || !arr.length) return null;
    const allowed = new Set(AGENTS);
    const steps = arr
      .filter((s) => s && typeof s.description === 'string' && allowed.has(s.agent))
      .slice(0, 8)
      .map((s, i) => ({ id: `s${i + 1}`, agent: s.agent, description: s.description, ...(s.tool ? { tool: s.tool } : {}) }));
    return steps.length ? steps : null;
  } catch { return null; }
}

export class Orchestrator {
  constructor({ llm, tools = null, memory = null, governance = null, classifier = null, recallK = 3 } = {}) {
    if (!llm) throw new Error('Orchestrator: llm (KayrosLLM) requis');
    this.llm = llm; this.tools = tools; this.memory = memory; this.governance = governance; this.classifier = classifier; this.recallK = recallK;
  }

  _hasVectorMemory() { return !!this.memory && typeof this.memory.recall === 'function' && typeof this.memory.remember === 'function'; }

  _fallbackSteps() {
    return [
      { id: 's1', description: 'Cadrer et planifier la reponse', agent: 'Planner' },
      { id: 's2', description: 'Critiquer et detecter les angles morts', agent: 'Critic' },
      { id: 's3', description: 'Attaquer la robustesse (kill shots)', agent: 'RedTeam' },
      { id: 's4', description: 'Synthetiser une reponse arbitrable', agent: 'Synthesizer' },
    ];
  }

  /**
   * Phase PLAN (EF-15) : le Planner LLM genere le plan ; repli deterministe si echec/non-JSON.
   * @param {string} goal
   * @param {{ideaId?:string, provider?:string, sovereignty?:'cloud'|'local', model?:string, llmPlan?:boolean}} [ctx]
   */
  async plan(goal, ctx = {}) {
    const ideaId = ctx.ideaId ?? 'idea';
    if (ctx.llmPlan === false) return { ideaId, goal, generatedBy: 'fallback', steps: this._fallbackSteps() };
    try {
      const opts = {};
      if (ctx.provider) opts.provider = ctx.provider;
      if (ctx.sovereignty) opts.sovereignty = ctx.sovereignty;
      const res = await this.llm.complete(
        { role: 'Planner', model: ctx.model, temperature: 0.2, messages: [
          { role: 'system', content: PLANNER_SYSTEM },
          { role: 'user', content: `Objectif : ${goal}` },
        ] },
        opts
      );
      const steps = parsePlanSteps(res.text);
      if (steps) return { ideaId, goal, generatedBy: 'llm', steps };
    } catch { /* repli */ }
    return { ideaId, goal, generatedBy: 'fallback', steps: this._fallbackSteps() };
  }

  /**
   * Phase SOLVE (ReAct) : rappel memoire -> etapes -> gouvernance de sortie.
   * @param {{ideaId:string, goal:string, steps:any[]}} plan
   * @param {{governance?:'auto'|'supervise'|'strict', sovereignty?:'cloud'|'local', provider?:string, maxSteps?:number, recall?:boolean, remember?:boolean}} [opts]
   */
  async *run(plan, opts = {}) {
    const level = opts.governance ?? 'supervise';
    const maxSteps = opts.maxSteps ?? 20;
    const doRecall = opts.recall !== false;
    const doRemember = opts.remember !== false;

    // 1) RAPPEL memoire (EF-18).
    let contextBlock = '';
    if (doRecall && this._hasVectorMemory()) {
      let recalled = [];
      try { recalled = await this.memory.recall(plan.ideaId, plan.goal, this.recallK); } catch { recalled = []; }
      if (recalled.length) {
        contextBlock = 'Contexte pertinent (memoire de l\'idee) :\n' + recalled.map((r) => `- ${r.text}`).join('\n');
        yield { type: 'recall', ideaId: plan.ideaId, items: recalled.map((r) => ({ id: r.id, score: r.score, text: r.text })), ts: new Date().toISOString() };
      }
    }

    let count = 0;
    for (const s of plan.steps) {
      if (count++ >= maxSteps) { yield { type: 'halt', reason: 'maxSteps', ts: new Date().toISOString() }; break; }

      const messages = [];
      if (contextBlock) messages.push({ role: 'system', content: contextBlock });
      messages.push({ role: 'user', content: `${plan.goal}\n\nTache : ${s.description}` });

      const llmRes = await this.llm.complete({ role: s.agent, messages }, opts);
      let observation = llmRes.text;
      let actionType = 'llm', actionName = 'complete';
      if (s.tool && this.tools) { observation = await this.tools.call(s.tool, s.toolInput ?? {}, { ideaId: plan.ideaId }); actionType = 'tool'; actionName = s.tool; }

      const obsText = typeof observation === 'string' ? observation : JSON.stringify(observation);
      this.memory?.addContribution?.({ actor: s.agent, content: obsText });
      if (doRemember && this._hasVectorMemory()) {
        try { await this.memory.remember({ id: `${plan.ideaId}:${s.id}:${count}`, ideaId: plan.ideaId, text: `[${s.agent}] ${obsText}` }); } catch { /* best-effort */ }
      }

      yield {
        type: 'trace', stepId: s.id, agent: s.agent,
        thought: `[${s.agent}] ${s.description}`,
        action: { type: actionType, name: actionName },
        observation,
        usedContext: !!contextBlock,
        tokens: { in: llmRes.usage.tokensIn, out: llmRes.usage.tokensOut },
        ts: new Date().toISOString(),
      };
    }

    const answer = `Synthese gouvernee pour: ${plan.goal}`;
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
}

export async function collect(gen) {
  const out = [];
  for await (const ev of gen) out.push(ev);
  return out;
}
