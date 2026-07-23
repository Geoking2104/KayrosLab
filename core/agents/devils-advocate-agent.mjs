import { BaseAgent } from './base-agent.mjs';

export class DevilsAdvocateAgent extends BaseAgent {
  constructor(opts = {}) {
    super({
      name: 'DevilsAdvocate',
      systemPrompt:
        'You are the Devil\'s Advocate. Your sole mission is to find why an idea will FAIL. ' +
        'Challenge every hypothesis systematically. Assume the opposite of every claim. ' +
        'Identify hidden dependencies, competitive responses, market rejection vectors, ' +
        'and execution impossibilities. Be brutal but rigorous - no personal opinion, only logic. ' +
        'For each challenge, provide: (1) the assumption being challenged, (2) the counter-argument, ' +
        '(3) the probability of this being a real threat (low/medium/high).',
      ...opts,
    });
    this._toolNames = [];
  }

  async execute(task, ctx) {
    const result = await super.execute(task, ctx);
    const challenges = this._extractChallenges(result.output);
    return { ...result, structured: { challenges } };
  }

  _extractChallenges(text) {
    const challenges = [];
    const lines = text.split('\n');
    let current = null;
    for (const line of lines) {
      if (line.match(/assumption|hypothesis|claim/i) && line.includes(':')) {
        if (current) challenges.push(current);
        current = { assumption: line.trim(), counter: '', probability: 'medium' };
      } else if (current) {
        const probMatch = line.match(/\b(high|medium|low)\b/i);
        if (probMatch && line.includes('probab')) current.probability = probMatch[1].toLowerCase();
        else if (line.length > 10) current.counter += line.trim() + ' ';
      }
    }
    if (current) challenges.push(current);
    return challenges;
  }
}
