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

/** Map agent constructor names → quantGuidance role keys when they differ. */
const ROLE_ALIAS = {
  DevilsAdvocate: "Devil's Advocate",
  Bisociateur: 'Bisociator',
};

/**
 * @param {string} name
 * @param {Object} [opts]
 * @param {Object} [opts.llm]
 * @param {Object} [opts.tools]
 * @param {Object} [opts.memory]
 * @param {Object} [opts.quantGuidance]  // from recommendForEngine / createEngine
 * @param {string} [opts.baseModel]      // base model tag before quant suffix
 */
export function createAgent(name, { llm, tools, memory, quantGuidance = null, baseModel = null } = {}) {
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

  let preferredModel = null;
  let quantRec = null;
  if (quantGuidance) {
    const roleKey = ROLE_ALIAS[name] || name;
    quantRec = quantGuidance.byRole?.[roleKey] || quantGuidance.byRole?.[name] || quantGuidance.global || null;
    if (typeof quantGuidance.resolveForRole === 'function' && baseModel) {
      preferredModel = quantGuidance.resolveForRole(roleKey, baseModel)
        || quantGuidance.resolveForRole(name, baseModel);
    } else if (quantRec?.quant && baseModel) {
      // Fallback without resolveForRole
      preferredModel = baseModel;
    } else if (quantGuidance.resolvedDefaultModel) {
      preferredModel = quantGuidance.resolvedDefaultModel;
    }
  }

  return factory({ llm, tools, memory, preferredModel, quantRec });
}

export function createAllAgents({ llm, tools, memory, quantGuidance = null, baseModel = null } = {}) {
  const map = {};
  for (const name of AGENT_TYPES) {
    map[name] = createAgent(name, { llm, tools, memory, quantGuidance, baseModel });
  }
  return map;
}
