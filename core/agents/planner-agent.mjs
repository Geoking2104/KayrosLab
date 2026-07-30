import { BaseAgent } from './base-agent.mjs';
import { parsePlanSteps } from '../orchestrator.mjs';

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

  async createPlan(goal, { provider, sovereignty, model, llmPlan } = {}) {
    if (llmPlan === false) return this._fallbackPlan(goal);

    const messages = [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: `Objective: ${goal}` },
    ];

    try {
      if (!this.llm) return this._fallbackPlan(goal);
      const res = await this.llm.complete(
        {
          role: 'Planner',
          messages,
          temperature: 0.2,
          think: false,
          model: this._resolveModel(model),
        },
        { provider, sovereignty },
      );
      const steps = parsePlanSteps(res.text);
      if (!steps?.length) return this._fallbackPlan(goal);
      // Ensure Synthesizer is last
      const normalized = [...steps];
      const last = normalized[normalized.length - 1];
      if (!last || last.agent !== 'Synthesizer') {
        normalized.push({
          id: `s${normalized.length + 1}`,
          agent: 'Synthesizer',
          description: 'Synthese et recommandations arbitrables',
        });
      }
      return {
        generatedBy: 'llm',
        steps: normalized,
        degraded: res.degraded || null,
      };
    } catch {
      return this._fallbackPlan(goal);
    }
  }

  _fallbackPlan(_goal) {
    return { generatedBy: 'fallback', steps: defaultFallbackSteps(), degraded: null };
  }
}
