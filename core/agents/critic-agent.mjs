import { BaseAgent } from './base-agent.mjs';

export class CriticAgent extends BaseAgent {
  constructor(opts = {}) {
    super({
      name: 'Critic',
      systemPrompt:
        'You are the Critic. Your role is to analyse ideas rigorously and identify blind spots. ' +
        'Apply structured critical thinking: check assumptions, data quality, logical consistency, ' +
        'and potential biases. Output a structured critique with severity ratings (low/medium/high) ' +
        'for each issue found. Be constructive: for each blind spot, suggest a mitigation.',
      ...opts,
    });
    this._toolNames = ['search_regulatory_risks'];
  }

  async execute(task, ctx) {
    const result = await super.execute(task, ctx);
    const critique = this._structureCritique(result.output);
    return { ...result, structured: critique };
  }

  _structureCritique(text) {
    const issues = [];
    const lines = text.split('\n');
    let currentIssue = null;
    for (const line of lines) {
      const severityMatch = line.match(/\b(high|medium|low)\b/i);
      if (severityMatch && (line.includes('blind') || line.includes('issue') || line.includes('risk') || line.includes('problem'))) {
        if (currentIssue) issues.push(currentIssue);
        currentIssue = { severity: severityMatch[1].toLowerCase(), description: line.trim(), mitigation: '' };
      } else if (currentIssue && (line.includes('mitig') || line.includes('suggest') || line.includes('recommend'))) {
        currentIssue.mitigation = line.trim();
      }
    }
    if (currentIssue) issues.push(currentIssue);
    return { issues, structured: issues.length > 0 };
  }
}
