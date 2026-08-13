import { BaseAgent as _BaseAgent } from './base-agent.mjs';
import { PlannerAgent as _PlannerAgent } from './planner-agent.mjs';
import { CriticAgent as _CriticAgent } from './critic-agent.mjs';
import { DevilsAdvocateAgent as _DevilsAdvocateAgent } from './devils-advocate-agent.mjs';
import { RedTeamAgent as _RedTeamAgent } from './red-team-agent.mjs';
import { BisociateurAgent as _BisociateurAgent } from './bisociator-agent.mjs';
import { SynthesizerAgent as _SynthesizerAgent } from './synthesizer-agent.mjs';
import {
  ResearcherAgent as _ResearcherAgent,
  SimulatorAgent as _SimulatorAgent,
  WriterAgent as _WriterAgent,
  VerifierAgent as _VerifierAgent,
  LoggerAgent as _LoggerAgent,
  HumanGateAgent as _HumanGateAgent,
} from './pipeline-agents.mjs';
import {
  SignalScannerAgent as _SignalScannerAgent,
  TrendMapperAgent as _TrendMapperAgent,
  ScenarioGeneratorAgent as _ScenarioGeneratorAgent,
  PositionerAgent as _PositionerAgent,
  ProjectionAgentAgent as _ProjectionAgentAgent,
  ExecutionTrackerAgent as _ExecutionTrackerAgent,
} from './cycle-agents.mjs';
import { normalizeRole } from '../quant-guidance.mjs';

export const BaseAgent = _BaseAgent;
export const PlannerAgent = _PlannerAgent;
export const CriticAgent = _CriticAgent;
export const DevilsAdvocateAgent = _DevilsAdvocateAgent;
export const RedTeamAgent = _RedTeamAgent;
export const BisociateurAgent = _BisociateurAgent;
export const SynthesizerAgent = _SynthesizerAgent;
export const ResearcherAgent = _ResearcherAgent;
export const SimulatorAgent = _SimulatorAgent;
export const WriterAgent = _WriterAgent;
export const VerifierAgent = _VerifierAgent;
export const LoggerAgent = _LoggerAgent;
export const HumanGateAgent = _HumanGateAgent;
export const SignalScannerAgent = _SignalScannerAgent;
export const TrendMapperAgent = _TrendMapperAgent;
export const ScenarioGeneratorAgent = _ScenarioGeneratorAgent;
export const PositionerAgent = _PositionerAgent;
export const ProjectionAgentAgent = _ProjectionAgentAgent;
export const ExecutionTrackerAgent = _ExecutionTrackerAgent;

/**
 * Two rosters on one engine: the dialectical family (Critic, DevilsAdvocate,
 * RedTeam, Bisociateur, Synthesizer) and the produce-then-verify family of
 * the Graph Engineering spec (Researcher, Simulator, Writer, Verifier,
 * Logger). Planner is shared.
 */
export const AGENT_TYPES = [
  'Planner', 'Critic', 'DevilsAdvocate', 'RedTeam', 'Bisociateur', 'Synthesizer',
  'Researcher', 'Simulator', 'Writer', 'Verifier', 'Logger', 'HumanGate',
  // Roster du cycle KayrosLab : les noms que le metier emploie, un par etape.
  'SignalScanner', 'TrendMapper', 'ScenarioGenerator', 'Positioner',
  'ProjectionAgent', 'ExecutionTracker',
];

export function createAgent(name, { llm, tools, memory, quantGuidance = null, baseModel = null } = {}) {
  const factories = {
    Planner: (o) => new _PlannerAgent(o),
    Critic: (o) => new _CriticAgent(o),
    DevilsAdvocate: (o) => new _DevilsAdvocateAgent(o),
    RedTeam: (o) => new _RedTeamAgent(o),
    Bisociateur: (o) => new _BisociateurAgent(o),
    Synthesizer: (o) => new _SynthesizerAgent(o),
    Researcher: (o) => new _ResearcherAgent(o),
    Simulator: (o) => new _SimulatorAgent(o),
    Writer: (o) => new _WriterAgent(o),
    Verifier: (o) => new _VerifierAgent(o),
    Logger: (o) => new _LoggerAgent(o),
    HumanGate: (o) => new _HumanGateAgent(o),
    SignalScanner: (o) => new _SignalScannerAgent(o),
    TrendMapper: (o) => new _TrendMapperAgent(o),
    ScenarioGenerator: (o) => new _ScenarioGeneratorAgent(o),
    Positioner: (o) => new _PositionerAgent(o),
    ProjectionAgent: (o) => new _ProjectionAgentAgent(o),
    ExecutionTracker: (o) => new _ExecutionTrackerAgent(o),
  };
  const factory = factories[name];
  if (!factory) throw new Error(`Unknown agent type: ${name}`);

  let preferredModel = null;
  let quantRec = null;
  if (quantGuidance) {
    const roleKey = normalizeRole(name);
    quantRec = quantGuidance.byRole?.[roleKey] || quantGuidance.byRole?.[name] || quantGuidance.global || null;
    if (typeof quantGuidance.resolveForRole === 'function' && baseModel) {
      preferredModel = quantGuidance.resolveForRole(roleKey, baseModel)
        || quantGuidance.resolveForRole(name, baseModel);
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
