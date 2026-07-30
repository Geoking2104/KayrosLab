import { BaseAgent } from './base-agent.mjs';

export class SynthesizerAgent extends BaseAgent {
  constructor(opts = {}) {
    super({
      name: 'Synthesizer',
      systemPrompt:
        'You are the Synthesizer. Your role is to aggregate multi-agent analyses into a coherent, ' +
        'actionable strategic recommendation. You must: ' +
        '(1) Summarize the key findings from each agent, ' +
        '(2) Identify consensus and disagreement points, ' +
        '(3) Produce a structured deliverable with: executive summary, key risks, recommended decision (Go/No-Go/Revise), ' +
        'confidence level, and next steps. ' +
        'Be concise and decision-oriented.',
      ...opts,
    });
    this._toolNames = ['calculate_ki_impact', 'simulate_trajectory'];
  }

  async synthesize(agentOutputs = [], ctx = {}) {
    const contributions = agentOutputs.map((o) => `[${o.agent}]\n${o.output}`).join('\n\n---\n\n');
    const task = `Synthesize the following multi-agent analyses into a decision-ready recommendation:\n\n${contributions}`;

    let text;
    if (this.llm) {
      const messages = [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: task },
      ];
      const res = await this.llm.complete(
        {
          role: 'Synthesizer',
          messages,
          temperature: 0.2,
          model: this._resolveModel(ctx.model),
        },
        { provider: ctx.provider, sovereignty: ctx.sovereignty },
      );
      text = res.text;
    } else {
      text = this._fallbackSynthesis(agentOutputs);
    }

    await this.addContribution(text);
    return { agent: 'Synthesizer', output: text, structured: this._extractDecision(text), model: this._resolveModel(ctx.model) || null };
  }

  _fallbackSynthesis(agentOutputs) {
    const risks = agentOutputs.filter((o) => o.agent === 'RedTeam' || o.agent === 'Critic');
    const opportunities = agentOutputs.filter((o) => o.agent === 'Bisociateur');
    return `## Synthesis\n\n` +
      `**Agents consulted:** ${agentOutputs.map((o) => o.agent).join(', ')}\n\n` +
      `**Key risks identified:** ${risks.length}\n` +
      `**Opportunities explored:** ${opportunities.length}\n\n` +
      `**Recommended decision:** Revise (${risks.length} unresolved risks require further analysis)\n` +
      `**Confidence:** Medium`;
  }

  _extractDecision(text) {
    const t = text.toLowerCase();
    let decision = 'revise';
    if (t.includes('go')) decision = 'go';
    else if (t.includes('no-go') || t.includes('reject')) decision = 'no-go';

    const confidenceMatch = text.match(/confiden[^:]*:\s*(high|medium|low)/i);
    return {
      decision,
      confidence: confidenceMatch?.[1]?.toLowerCase() || 'medium',
      summary: text.substring(0, 300),
    };
  }
}
