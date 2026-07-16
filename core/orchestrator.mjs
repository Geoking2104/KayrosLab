// KayrosLab — Orchestrateur (Plan-and-Solve + ReAct).
// Réf. specs techniques §3 (EF-15/16). Émet des ReActTrace en flux (async generator).

import { classifySensitive, policyFor } from './governance.mjs';

/** @typedef {'Planner'|'Critic'|'DevilsAdvocate'|'RedTeam'|'Bisociateur'|'Synthesizer'} AgentType */

export class Orchestrator {
  constructor({ llm, tools = null, memory = null, governance = null, classifier = null } = {}) {
    if (!llm) throw new Error('Orchestrator: llm (KayrosLLM) requis');
    this.llm = llm; this.tools = tools; this.memory = memory; this.governance = governance; this.classifier = classifier;
  }

  /**
   * Phase PLAN : décomposition explicite (EF-15). Ici, plan déterministe minimal ;
   * en cible, généré par le Planner via LLM.
   */
  async plan(goal, ctx = {}) {
    const ideaId = ctx.ideaId ?? 'idea';
    return {
      ideaId,
      goal,
      steps: [
        { id: 's1', description: 'Cadrer et planifier la réponse', agent: 'Planner' },
        { id: 's2', description: 'Critiquer et détecter les angles morts', agent: 'Critic' },
        { id: 's3', description: 'Attaquer la robustesse (kill shots)', agent: 'RedTeam' },
        { id: 's4', description: 'Synthétiser une réponse arbitrable', agent: 'Synthesizer' },
      ],
    };
  }

  /**
   * Phase SOLVE (ReAct) : émet un ReActTrace par étape, puis la gouvernance de sortie.
   * @param {{ideaId:string, goal:string, steps:any[]}} plan
   * @param {{governance?:'auto'|'supervise'|'strict', sovereignty?:'cloud'|'local', maxSteps?:number}} [opts]
   */
  async *run(plan, opts = {}) {
    const level = opts.governance ?? 'supervise';
    const maxSteps = opts.maxSteps ?? 20;
    let count = 0;

    for (const s of plan.steps) {
      if (count++ >= maxSteps) { yield { type: 'halt', reason: 'maxSteps', ts: new Date().toISOString() }; break; }
      const llmRes = await this.llm.complete(
        { role: s.agent, messages: [{ role: 'user', content: `${plan.goal}\n\nTâche: ${s.description}` }] },
        opts
      );
      let observation = llmRes.text;
      let actionType = 'llm', actionName = 'complete';
      if (s.tool && this.tools) { observation = await this.tools.call(s.tool, s.toolInput ?? {}, { ideaId: plan.ideaId }); actionType = 'tool'; actionName = s.tool; }

      this.memory?.addContribution?.({ actor: s.agent, content: typeof observation === 'string' ? observation : JSON.stringify(observation) });

      yield {
        type: 'trace', stepId: s.id, agent: s.agent,
        thought: `[${s.agent}] ${s.description}`,
        action: { type: actionType, name: actionName },
        observation,
        tokens: { in: llmRes.usage.tokensIn, out: llmRes.usage.tokensOut },
        ts: new Date().toISOString(),
      };
    }

    // Synthèse
    const answer = `Synthèse gouvernée pour: ${plan.goal}`;
    const sens = await classifySensitive(answer, { classifier: this.classifier });
    const gateType = policyFor({ sensitive: sens.sensitive }, level);

    if (gateType && this.governance) {
      const { gateId, promise } = this.governance.open({ ideaId: plan.ideaId, type: gateType, requiredRole: 'comex', payload: answer });
      yield { type: 'gate', gateId, gateType, status: 'pending_review', ts: new Date().toISOString() };
      const res = await promise; // attend la décision humaine
      if (res.decision === 'reject') { yield { type: 'final', status: 'blocked_veto', message: `Bloqué (veto) : ${res.reason}`, ts: new Date().toISOString() }; return; }
      if (res.decision === 'revise') { yield { type: 'final', status: 'revise', message: res.reason, ts: new Date().toISOString() }; return; }
      yield { type: 'final', status: 'validated_human', answer, ts: new Date().toISOString() };
      return;
    }
    yield { type: 'final', status: 'auto', answer, ts: new Date().toISOString() };
  }
}

/** Utilitaire : consomme le générateur et renvoie la liste des événements (usage hors-gate ou avec auto-résolution). */
export async function collect(gen) {
  const out = [];
  for await (const ev of gen) out.push(ev);
  return out;
}
