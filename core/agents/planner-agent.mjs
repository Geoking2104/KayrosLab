import { BaseAgent } from './base-agent.mjs';
import { parsePlanSteps, ensureSynthesizerLast, PLAN_AGENTS } from '../plan-parse.mjs';

/** Canonical fallback plan — shared with Orchestrator. */
export function defaultFallbackSteps() {
  return [
    { id: 's1', agent: 'Critic', description: 'Analyse du probleme et identification des angles morts' },
    { id: 's2', agent: 'DevilsAdvocate', description: 'Contestation systematique des hypotheses' },
    { id: 's3', agent: 'RedTeam', description: 'Simulation d\'attaques et tests de robustesse' },
    { id: 's4', agent: 'Bisociateur', description: 'Creation de ponts conceptuels avec domaines analogues' },
    { id: 's5', agent: 'Synthesizer', description: 'Synthese et recommandations arbitrables' },
  ];
}

export class PlannerAgent extends BaseAgent {
  constructor(opts = {}) {
    super({
      name: 'Planner',
      systemPrompt:
        'You are the Planner, the architect of the strategic ideation process. ' +
        'Decompose the objective into 3-6 actionable steps. ' +
        'Assign each step to the most suitable agent: Critic, DevilsAdvocate, RedTeam, Bisociateur, Synthesizer. ' +
        'The last step must always be Synthesizer. ' +
        'Respond ONLY with a JSON array, no surrounding text: ' +
        '[{"agent":"Critic","description":"..."},{"agent":"Synthesizer","description":"..."}]',
      ...opts,
    });
    this._toolNames = [];
  }

  async createPlan(goal, {
    provider, sovereignty, model, llmPlan, runId, run_id, traceId, trace_id,
  } = {}) {
    if (llmPlan === false) return this._fallbackPlan();
    const correlation = {
      runId: runId || run_id,
      run_id: runId || run_id,
      traceId: traceId || trace_id,
      trace_id: traceId || trace_id,
    };

    const messages = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: `Objective: ${goal}` },
    ];

    try {
      if (!this.llm) return this._fallbackPlan();
      const res = await this.llm.complete(
        {
          role: 'Planner',
          messages,
          temperature: 0.2,
          think: false,
          model: this._resolveModel(model),
          ...correlation,
        },
        { provider, sovereignty, ...correlation },
      );
      // Planner itself is rarely a step agent; allow specialist set + optional Planner
      const steps = parsePlanSteps(res.text, {
        allowed: PLAN_AGENTS.filter((a) => a !== 'Planner').concat(['Planner']),
      });
      if (!steps?.length) return this._fallbackPlan();
      return {
        generatedBy: 'llm',
        steps: ensureSynthesizerLast(steps),
        degraded: res.degraded || null,
      };
    } catch {
      return this._fallbackPlan();
    }
  }

  _fallbackPlan() {
    return { generatedBy: 'fallback', steps: defaultFallbackSteps(), degraded: null };
  }
}
