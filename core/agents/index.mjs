import { BaseAgent as _BaseAgent } from './base-agent.mjs';
import { PlannerAgent as _PlannerAgent } from './planner-agent.mjs';
import { CriticAgent as _CriticAgent } from './critic-agent.mjs';
import { DevilsAdvocateAgent as _DevilsAdvocateAgent } from './devils-advocate-agent.mjs';
import { RedTeamAgent as _RedTeamAgent } from './red-team-agent.mjs';
import { BisociateurAgent as _BisociateurAgent } from './bisociator-agent.mjs';
import { SynthesizerAgent as _SynthesizerAgent } from './synthesizer-agent.mjs';

export const BaseAgent = _BaseAgent;
export const PlannerAgent = _PlannerAgent;
export const CriticAgent = _CriticAgent;
export const DevilsAdvocateAgent = _DevilsAdvocateAgent;
export const RedTeamAgent = _RedTeamAgent;
export const BisociateurAgent = _BisociateurAgent;
export const SynthesizerAgent = _SynthesizerAgent;

export const AGENT_TYPES = ['Planner', 'Critic', 'DevilsAdvocate', 'RedTeam', 'Bisociateur', 'Synthesizer'];

export function createAgent(name, { llm, tools, memory } = {}) {
  const factories = {
    Planner: (o) => new _PlannerAgent(o),
    Critic: (o) => new _CriticAgent(o),
    DevilsAdvocate: (o) => new _DevilsAdvocateAgent(o),
    RedTeam: (o) => new _RedTeamAgent(o),
    Bisociateur: (o) => new _BisociateurAgent(o),
    Synthesizer: (o) => new _SynthesizerAgent(o),
  };
  const factory = factories[name];
  if (!factory) throw new Error(`Unknown agent type: ${name}`);
  return factory({ llm, tools, memory });
}

export function createAllAgents({ llm, tools, memory } = {}) {
  const map = {};
  for (const name of AGENT_TYPES) {
    map[name] = createAgent(name, { llm, tools, memory });
  }
  return map;
}
