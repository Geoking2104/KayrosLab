import { BaseAgent } from './base-agent.mjs';
import { buildPersonalityContext } from '../personality.mjs';

const OUTPUT_CONTRACT = `Return one JSON object only, with this exact shape:
{
  "verdict": "GO | NO_GO | CONDITIONAL_GO",
  "primary_reason": "concise reason",
  "simulated_stakeholder_feedback": "clearly labeled simulation, never a real quote",
  "strengths_opportunities": ["..."],
  "critical_risks": ["..."],
  "metrics": [{"metric":"...","value":"...","confidence_impact":"high | medium | low","persona_skepticism_level":"high | medium | low"}],
  "required_mitigations": ["..."],
  "unverified_assumptions": ["..."]
}`;

/**
 * Runtime adapter for system-defined and user-defined decision agents.
 * The registry owns definitions/rules; this class only executes an immutable
 * effective context for one swarm run.
 */
export class SpecializedDecisionAgent extends BaseAgent {
  constructor({ definition, effectiveContext, personalityEnabled = false, ...opts } = {}) {
    if (!definition?.agent_id) throw new Error('SpecializedDecisionAgent: definition required');
    const veto = definition.veto_power
      ? 'You have veto power: issue NO_GO when a blocking condition is evidenced.'
      : 'You do not have unilateral human authority: your verdict is advisory input to the swarm.';
    const personalityContext = personalityEnabled && definition.human_profile
      ? buildPersonalityContext(definition.human_profile) : '';
    super({
      name: definition.agent_id,
      systemPrompt: [
        `You are ${definition.role_name}, ${definition.department} (${definition.seniority}).`,
        `Primary mission: ${definition.primary_focus}`,
        veto,
        'Challenge assumptions and expose failure modes; do not validate a premise merely to be agreeable.',
        'Ground every claim in the supplied context. Put missing evidence in unverified_assumptions.',
        'Use quantitative estimates where evidence permits, preferably P10/P50/P90 ranges.',
        'A human decision-maker retains the final validation and veto authority.',
        personalityContext || null,
        `Effective rules:\n${effectiveContext || '- No active rule'}`,
        OUTPUT_CONTRACT,
      ].filter(Boolean).join('\n\n'),
      ...opts,
    });
    this.definition = definition;
    this.effectiveContext = effectiveContext;
    this.personalityEnabled = !!personalityContext;
  }

  async executeDecision({ question, context = '', ...ctx } = {}) {
    const result = await super.execute(
      `Evaluate the decision request and issue the mandatory formal verdict.\n\nDecision request: ${question}`,
      { ...ctx, goal: question, context },
    );
    return { ...result, agentId: this.definition.agent_id, definition: this.definition };
  }
}
