// KayrosLab -- Preset workflow graphs.
//
// The v2 engine is deliberately paradigm-agnostic: it enforces bounded
// cycles, attempt budgets and per-node permissions, but it does not care
// what the nodes mean. Two graphs ship with it, from two different families:
//
//   * KAYROS_CYCLE  -- the dialectical family. Adversarial agents attack an
//     idea (Critic, Devil's Advocate, Red Team) and a Synthesizer arbitrates.
//     Linear, no revision loop: the "retry" is the human gate downstream.
//
//   * REFERENCE_PIPELINE -- the produce-then-verify family from the Graph
//     Engineering spec section 4. Planner -> Researcher -> Simulator ->
//     Writer -> Verifier, with a bounded revision loop back to Writer and a
//     human escalation once the writer's budget is spent.
//
// Callers may of course compile their own graphs; these are starting points.

import { GRAPH_START, GRAPH_END, WORKFLOW_GRAPH_VERSION } from './workflow-graph.mjs';

function agentNode(id, agent, {
  description = '',
  maxAttempts = 1,
  tools = [],
  writes = [],
  gate = null,
} = {}) {
  return {
    id,
    kind: 'agent',
    agent,
    step: { id, agent, description },
    maxAttempts,
    permissions: { tools, writes },
    gate,
  };
}

function graph(nodes, edges) {
  return Object.freeze({
    version: WORKFLOW_GRAPH_VERSION,
    start: GRAPH_START,
    end: GRAPH_END,
    nodes,
    edges,
  });
}

// ------------------------------------------------- reference pipeline

/**
 * Condition resolvers for {@link referencePipelineGraph}. They read only the
 * `review` channel, which the Verifier node owns; no other node may write it.
 */
export const REFERENCE_CONDITIONS = Object.freeze({
  reviewOk: (state) => state?.review?.status === 'OK',
  reviewKo: (state) => state?.review?.status === 'KO',
});

/**
 * The spec section 4 topology.
 *
 *   [start] -> planner -> researcher -> simulator -> writer -> verifier
 *   verifier --OK--> logger -> [end]
 *   verifier --KO--> writer          (bounded by writerAttempts)
 *   verifier --else-> escalate -> [end]
 *
 * Once the writer's attempt budget is spent the KO edge stops being
 * selectable, so a persistently failing review escalates to a human instead
 * of spinning. That is the whole point of bounding the cycle rather than
 * forbidding it.
 */
export function referencePipelineGraph({
  writerAttempts = 3,
  simulatorAttempts = 2,
  researchTools = [],
  simulationTools = [],
  escalationRole = 'comex',
} = {}) {
  const verifierAttempts = writerAttempts + 1;
  return graph(
    [
      agentNode('planner', 'Planner', {
        description: 'Decompose the request and set success criteria',
      }),
      agentNode('researcher', 'Researcher', {
        description: 'Collect external facts and sources',
        tools: researchTools,
        writes: ['research'],
      }),
      agentNode('simulator', 'Simulator', {
        description: 'Run the domain computation',
        maxAttempts: simulatorAttempts,
        tools: simulationTools,
        writes: ['simulation'],
      }),
      agentNode('writer', 'Writer', {
        description: 'Produce the report',
        maxAttempts: writerAttempts,
        writes: ['draft'],
      }),
      agentNode('verifier', 'Verifier', {
        description: 'Check the draft against the success criteria',
        maxAttempts: verifierAttempts,
        // Read-only on everything except its own annotation channel.
        writes: ['review'],
      }),
      agentNode('escalate', 'HumanGate', {
        description: 'Hand over to a human after the revision budget is spent',
        // The checkpoint is part of the topology: reaching this node opens a
        // governance gate before anything else happens (spec section 5).
        gate: { type: 'human_escalation', requiredRole: escalationRole },
      }),
      agentNode('logger', 'Logger', {
        description: 'Persist decisions, traces and artifacts',
        writes: ['artifacts'],
      }),
    ],
    [
      { id: 'start->planner', from: GRAPH_START, to: 'planner', kind: 'always' },
      { id: 'planner->researcher', from: 'planner', to: 'researcher', kind: 'always' },
      { id: 'researcher->simulator', from: 'researcher', to: 'simulator', kind: 'always' },
      { id: 'simulator->writer', from: 'simulator', to: 'writer', kind: 'always' },
      { id: 'writer->verifier', from: 'writer', to: 'verifier', kind: 'always' },
      { id: 'verifier->logger', from: 'verifier', to: 'logger', kind: 'conditional', condition: 'reviewOk' },
      { id: 'verifier->writer', from: 'verifier', to: 'writer', kind: 'conditional', condition: 'reviewKo' },
      { id: 'verifier->escalate', from: 'verifier', to: 'escalate', kind: 'always' },
      { id: 'logger->end', from: 'logger', to: GRAPH_END, kind: 'always' },
      { id: 'escalate->end', from: 'escalate', to: GRAPH_END, kind: 'always' },
    ],
  );
}

// ------------------------------------------------------- kayros cycle

/**
 * The existing KayrosLab dialectical cycle, expressed as a v2 graph. Every
 * node runs once; adversarial agents hold no tool or channel permission
 * because they only produce text that the Synthesizer arbitrates.
 */
export function kayrosCycleGraph({ bisociator = true } = {}) {
  const nodes = [
    agentNode('critic', 'Critic', { description: 'Attack the assumptions' }),
    agentNode('devils-advocate', 'DevilsAdvocate', { description: 'Argue the opposite case' }),
    agentNode('red-team', 'RedTeam', { description: 'Look for failure modes' }),
  ];
  if (bisociator) {
    nodes.push(agentNode('bisociateur', 'Bisociateur', {
      description: 'Bridge distant domains',
    }));
  }
  nodes.push(agentNode('synthesizer', 'Synthesizer', {
    description: 'Arbitrate and produce the governed recommendation',
    writes: ['draft'],
  }));

  const route = [GRAPH_START, ...nodes.map(({ id }) => id), GRAPH_END];
  const edges = route.slice(0, -1).map((from, index) => ({
    id: `${from}->${route[index + 1]}`,
    from,
    to: route[index + 1],
    kind: 'always',
  }));
  return graph(nodes, edges);
}

/** No conditional edges in the dialectical cycle. */
export const KAYROS_CYCLE_CONDITIONS = Object.freeze({});

// -------------------------------------------------------- unified graph

/** Reads the decision a human left on the arbitrage gate. */
const decisionOf = (state) => state?.gate?.decision?.decision ?? null;

/**
 * Conditions of {@link unifiedGraph}. Arbitrage routes on the human decision
 * carried by the gate; the deliverable phase routes on the review channel.
 */
export const UNIFIED_CONDITIONS = Object.freeze({
  ...REFERENCE_CONDITIONS,
  arbitrageGo: (state) => ['approve', 'validate', 'go'].includes(decisionOf(state)),
  arbitrageRevise: (state) => decisionOf(state) === 'revise',
});

/**
 * The two rosters are two phases of one workflow, not two designs.
 *
 *   [start] -> planner -> researcher
 *           -> critic -> devils-advocate -> red-team -> bisociateur
 *           -> synthesizer -> decision-gate        (human arbitrage)
 *   decision-gate --Go------> simulator -> writer -> verifier
 *   decision-gate --revise--> critic               (bounded: the idea is
 *                                                   re-attacked, not reworded)
 *   decision-gate --else----> escalate
 *   verifier --OK--> logger -> [end]
 *   verifier --KO--> writer                        (bounded)
 *   verifier --else-> escalate -> [end]
 *
 * An idea is attacked until it holds, a human arbitrates the resulting
 * decision packet, and only then is a deliverable produced and checked.
 * Nothing is written before that arbitration: a veto costs no production.
 *
 * Both budgets are finite, and both exhaustions land on the same human
 * escalation -- a graph that cannot decide must hand over, not spin.
 */
export function unifiedGraph({
  reviseRounds = 2,
  writerAttempts = 3,
  simulatorAttempts = 2,
  arbitrageRole = 'comex',
  escalationRole = 'comex',
  researchTools = [],
  simulationTools = [],
} = {}) {
  // Every node of the revise loop shares the same budget: one attempt per
  // round, plus the initial pass.
  const rounds = Math.max(1, reviseRounds) + 1;
  const adversarial = (id, agent, description) => agentNode(id, agent, {
    description, maxAttempts: rounds,
  });

  return graph(
    [
      agentNode('planner', 'Planner', {
        description: 'Decompose the request and set success criteria',
        maxAttempts: rounds,
      }),
      agentNode('researcher', 'Researcher', {
        description: 'Collect external facts and sources',
        maxAttempts: rounds, tools: researchTools, writes: ['research'],
      }),
      adversarial('critic', 'Critic', 'Attack the assumptions'),
      adversarial('devils-advocate', 'DevilsAdvocate', 'Argue the opposite case'),
      adversarial('red-team', 'RedTeam', 'Look for failure modes'),
      adversarial('bisociateur', 'Bisociateur', 'Bridge distant domains'),
      agentNode('synthesizer', 'Synthesizer', {
        description: 'Arbitrate the attacks into a governed recommendation',
        maxAttempts: rounds,
      }),
      agentNode('decision-gate', 'HumanGate', {
        description: 'Human arbitrage of the decision packet',
        maxAttempts: rounds,
        gate: { type: 'decision_arbitrage', requiredRole: arbitrageRole },
      }),
      agentNode('simulator', 'Simulator', {
        description: 'Run the domain computation',
        maxAttempts: simulatorAttempts, tools: simulationTools, writes: ['simulation'],
      }),
      agentNode('writer', 'Writer', {
        description: 'Produce the report',
        maxAttempts: writerAttempts, writes: ['draft'],
      }),
      agentNode('verifier', 'Verifier', {
        description: 'Check the draft against the success criteria',
        maxAttempts: writerAttempts + 1, writes: ['review'],
      }),
      agentNode('escalate', 'HumanGate', {
        description: 'Hand over to a human once a budget is spent',
        gate: { type: 'human_escalation', requiredRole: escalationRole },
      }),
      agentNode('logger', 'Logger', {
        description: 'Persist decisions, traces and artifacts',
        writes: ['artifacts'],
      }),
    ],
    [
      { id: 'start->planner', from: GRAPH_START, to: 'planner', kind: 'always' },
      { id: 'planner->researcher', from: 'planner', to: 'researcher', kind: 'always' },
      { id: 'researcher->critic', from: 'researcher', to: 'critic', kind: 'always' },
      { id: 'critic->devils', from: 'critic', to: 'devils-advocate', kind: 'always' },
      { id: 'devils->red', from: 'devils-advocate', to: 'red-team', kind: 'always' },
      { id: 'red->biso', from: 'red-team', to: 'bisociateur', kind: 'always' },
      { id: 'biso->synth', from: 'bisociateur', to: 'synthesizer', kind: 'always' },
      { id: 'synth->arbitrage', from: 'synthesizer', to: 'decision-gate', kind: 'always' },

      { id: 'arbitrage->simulator', from: 'decision-gate', to: 'simulator', kind: 'conditional', condition: 'arbitrageGo' },
      { id: 'arbitrage->critic', from: 'decision-gate', to: 'critic', kind: 'conditional', condition: 'arbitrageRevise' },
      { id: 'arbitrage->escalate', from: 'decision-gate', to: 'escalate', kind: 'always' },

      { id: 'simulator->writer', from: 'simulator', to: 'writer', kind: 'always' },
      { id: 'writer->verifier', from: 'writer', to: 'verifier', kind: 'always' },
      { id: 'verifier->logger', from: 'verifier', to: 'logger', kind: 'conditional', condition: 'reviewOk' },
      { id: 'verifier->writer', from: 'verifier', to: 'writer', kind: 'conditional', condition: 'reviewKo' },
      { id: 'verifier->escalate', from: 'verifier', to: 'escalate', kind: 'always' },

      { id: 'logger->end', from: 'logger', to: GRAPH_END, kind: 'always' },
      { id: 'escalate->end', from: 'escalate', to: GRAPH_END, kind: 'always' },
    ],
  );
}

export const WORKFLOW_PRESETS = Object.freeze({
  unified: {
    build: unifiedGraph,
    conditions: UNIFIED_CONDITIONS,
    description: 'Adversarial phase, human arbitrage, then produce-then-verify pipeline',
  },
  reference: {
    build: referencePipelineGraph,
    conditions: REFERENCE_CONDITIONS,
    description: 'Graph Engineering reference pipeline with a bounded revision loop',
  },
  kayros: {
    build: kayrosCycleGraph,
    conditions: KAYROS_CYCLE_CONDITIONS,
    description: 'KayrosLab dialectical cycle (adversarial agents + synthesizer)',
  },
});

/**
 * The unified graph is the default: it is the only one that produces both a
 * governed recommendation and a verified report. `kayros` and `reference`
 * stay available for a short cycle or an MVP (spec section 8, "mode light").
 */
export const DEFAULT_PRESET = 'unified';

/** Returns `{ graph, conditions }` for a named preset. */
export function buildPreset(name = DEFAULT_PRESET, options = {}) {
  const preset = Object.prototype.hasOwnProperty.call(WORKFLOW_PRESETS, name)
    ? WORKFLOW_PRESETS[name]
    : null;
  if (!preset) throw new Error(`Workflow preset: unknown preset ${name}`);
  return { graph: preset.build(options), conditions: preset.conditions };
}
