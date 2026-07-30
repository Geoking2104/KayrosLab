import { BaseAgent } from './base-agent.mjs';

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
      let text;
      if (this.llm) {
        const res = await this.llm.complete(
          { role: 'Planner', messages, temperature: 0.2, model: this._resolveModel(model) },
          { provider, sovereignty },
        );
        text = res.text;
      } else {
        return this._fallbackPlan(goal);
      }
      return this._parseSteps(text);
    } catch {
      return this._fallbackPlan(goal);
    }
  }

  _fallbackPlan(goal) {
    return {
      generatedBy: 'fallback',
      steps: [
        { id: 's1', agent: 'Critic', description: 'Analyse du probleme et identification des angles morts' },
        { id: 's2', agent: 'DevilsAdvocate', description: 'Contestation systematique des hypotheses' },
        { id: 's3', agent: 'RedTeam', description: 'Simulation d\'attaques et tests de robustesse' },
        { id: 's4', agent: 'Bisociateur', description: 'Creation de ponts conceptuels avec domaines analogues' },
        { id: 's5', agent: 'Synthesizer', description: 'Synthese et recommandations arbitrables' },
      ],
    };
  }

  _parseSteps(text) {
    const s = String(text ?? '')
      .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
      .replace(/<think>[\s\S]*$/i, ' ')
      .replace(/```(?:json)?/gi, ' ');
    const start = s.indexOf('[');
    if (start < 0) return this._fallbackPlan(text);
    let depth = 0, inStr = false, end = -1;
    for (let i = start; i < s.length; i++) {
      if (inStr) { if (s[i] === '"' && s[i - 1] !== '\\') inStr = false; continue; }
      if (s[i] === '"') inStr = true;
      else if (s[i] === '[') depth++;
      else if (s[i] === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end < 0) return this._fallbackPlan(text);
    const allowed = new Set(['Critic', 'DevilsAdvocate', 'RedTeam', 'Bisociateur', 'Synthesizer']);
    try {
      const arr = JSON.parse(s.slice(start, end)).filter((x) => x && typeof x.description === 'string' && allowed.has(x.agent));
      if (!arr.length) return this._fallbackPlan(text);
      return { generatedBy: 'llm', steps: arr.slice(0, 8).map((x, i) => ({ id: `s${i + 1}`, agent: x.agent, description: x.description })) };
    } catch {
      return this._fallbackPlan(text);
    }
  }
}
