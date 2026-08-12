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
} = {}) {
  return {
    id,
    kind: 'agent',
    agent,
    step: { id, agent, description },
    maxAttempts,
    permissions: { tools, writes },
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

export const WORKFLOW_PRESETS = Object.freeze({
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

/** Returns `{ graph, conditions }` for a named preset. */
export function buildPreset(name, options = {}) {
  const preset = Object.prototype.hasOwnProperty.call(WORKFLOW_PRESETS, name)
    ? WORKFLOW_PRESETS[name]
    : null;
  if (!preset) throw new Error(`Workflow preset: unknown preset ${name}`);
  return { graph: preset.build(options), conditions: preset.conditions };
}
