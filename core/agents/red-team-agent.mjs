import { BaseAgent } from './base-agent.mjs';

export class RedTeamAgent extends BaseAgent {
  constructor(opts = {}) {
    super({
      name: 'RedTeam',
      systemPrompt:
        'You are the Red Team. You simulate adversarial scenarios to test the resilience of strategic ideas. ' +
        'Think like a competitor trying to destroy this initiative. Identify: ' +
        '(1) Attack vectors - how competitors would counter this move, ' +
        '(2) Kill shots - single points of failure that would collapse the entire initiative, ' +
        '(3) Scenario stress-tests - extreme conditions (regulatory crackdown, talent loss, tech failure). ' +
        'For each kill shot, estimate the probability and impact on a scale of 1-10.',
      ...opts,
    });
    this._toolNames = ['calculate_ki_impact'];
  }

  async execute(task, ctx) {
    const result = await super.execute(task, ctx);
    const analysis = this._parseAttackVectors(result.output);
    return { ...result, structured: { attackVectors: analysis } };
  }

  _parseAttackVectors(text) {
    const vectors = [];
    const sections = text.split(/\n(?=(Attack|Kill|Scenario|Stress|Vector))/i);
    for (const section of sections) {
      const type = section.match(/(Attack|Kill Shot|Scenario|Stress Test|Vector)/i)?.[1] || 'generic';
      const probMatch = section.match(/probab[^:]*:\s*(\d+)/i);
      const impactMatch = section.match(/impact[^:]*:\s*(\d+)/i);
      vectors.push({
        type,
        description: section.trim().substring(0, 200),
        probability: probMatch ? parseInt(probMatch[1], 10) : null,
        impact: impactMatch ? parseInt(impactMatch[1], 10) : null,
      });
    }
    return vectors;
  }

  async calculateKIthreat(idea, threat) {
    if (!this.tools) return { delta_KI: -2 };
    try {
      return await this.tools.call('calculate_ki_impact', { ideaId: idea, changement: threat });
    } catch {
      return { delta_KI: -2 };
    }
  }
}
