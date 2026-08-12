export const GRAPH_START = '__start__';
export const GRAPH_END = '__end__';
export const WORKFLOW_GRAPH_VERSION = 1;

const MAX_GRAPH_NODES = 256;
const MAX_GRAPH_EDGES = 1024;
const MAX_JSON_DEPTH = 64;

const GRAPH_FIELDS = new Set(['version', 'start', 'end', 'nodes', 'edges']);
const NODE_FIELDS = new Set(['id', 'kind', 'agent', 'step']);
const EDGE_FIELDS = new Set(['id', 'from', 'to', 'kind', 'condition']);
const STEP_FIELDS = new Set(['id', 'agent', 'description', 'input', 'tool', 'toolInput']);

function assertKnownFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Workflow graph: unknown ${label} field ${key}`);
  }
}

function assertJsonSafeLeaf(value, path) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  throw new Error(`Workflow graph: ${path} must contain only JSON-safe values`);
}

/**
 * Reads caller-owned data exactly once into a detached plain snapshot,
 * validating JSON-safety, depth, cycles and prototypes during the single
 * read. All later validation and freezing operate on the snapshot only, so
 * stateful getters/proxies cannot swap values between validation and
 * transport (no validate-then-clone TOCTOU window).
 */
function snapshotJsonSafe(value, path = 'graph', ancestors = new WeakSet(), depth = 0) {
  if (depth > MAX_JSON_DEPTH) {
    throw new Error(`Workflow graph: ${path} nesting is too deep`);
  }
  if (value === null || typeof value !== 'object') {
    assertJsonSafeLeaf(value, path);
    return value;
  }
  if (ancestors.has(value)) {
    throw new Error(`Workflow graph: ${path} must contain only JSON-safe values (cycle)`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Workflow graph: ${path} must contain only JSON-safe values`);
  }
  if (Object.getOwnPropertySymbols(value).length) {
    throw new Error(`Workflow graph: ${path} must contain only JSON-safe values`);
  }
  ancestors.add(value);
  let snapshot;
  if (Array.isArray(value)) {
    snapshot = [];
    const length = value.length;
    for (let index = 0; index < length; index += 1) {
      snapshot[index] = snapshotJsonSafe(value[index], `${path}.${index}`, ancestors, depth + 1);
    }
  } else {
    snapshot = {};
    for (const key of Object.keys(value)) {
      // Single read per property: the value captured here is the value
      // validated, frozen, and transported.
      snapshot[key] = snapshotJsonSafe(value[key], `${path}.${key}`, ancestors, depth + 1);
    }
  }
  ancestors.delete(value);
  return snapshot;
}

function assertOptionalString(value, label) {
  if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
    throw new Error(`Workflow graph: ${label} must be a non-blank string`);
  }
}

function validateStep(step, { requireId = false } = {}) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    throw new Error('Workflow graph: invalid step definition');
  }
  assertKnownFields(step, STEP_FIELDS, 'step');
  if (requireId && (typeof step.id !== 'string' || !step.id.trim())) {
    throw new Error('Workflow graph: step id must be a non-blank string');
  }
  if (!requireId && step.id !== undefined) assertOptionalString(step.id, 'step id');
  assertOptionalString(step.agent, 'step agent');
  assertOptionalString(step.description, 'step description');
  assertOptionalString(step.input, 'step input');
  assertOptionalString(step.tool, 'step tool');
  if (step.toolInput !== undefined
    && (!step.toolInput || typeof step.toolInput !== 'object' || Array.isArray(step.toolInput))) {
    throw new Error('Workflow graph: step toolInput must be an object');
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function freezeDefinition(definition) {
  return deepFreeze(definition);
}

export function declareWorkflowGraph(steps = []) {
  if (!Array.isArray(steps)) throw new Error('Workflow graph: steps must be an array');
  if (steps.length > MAX_GRAPH_NODES) throw new Error('Workflow graph: too many nodes');
  const safeSteps = snapshotJsonSafe(steps, 'steps');
  const nodes = safeSteps.map((step, index) => {
    validateStep(step);
    const id = step.id || `step-${index + 1}`;
    return {
      id,
      kind: step.agent ? 'agent' : step.tool ? 'tool' : 'agent',
      agent: step.agent || null,
      step: { ...step, id },
    };
  });
  const route = [GRAPH_START, ...nodes.map(({ id }) => id), GRAPH_END];
  const edges = route.slice(0, -1).map((from, index) => ({
    id: `${from}->${route[index + 1]}`,
    from,
    to: route[index + 1],
    kind: 'always',
  }));
  return freezeDefinition({
    version: WORKFLOW_GRAPH_VERSION,
    start: GRAPH_START,
    end: GRAPH_END,
    nodes,
    edges,
  });
}

export function compileWorkflowGraph(input, { conditions = {} } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Workflow graph: graph definition must be an object');
  }
  if (Array.isArray(input.nodes) && input.nodes.length > MAX_GRAPH_NODES) {
    throw new Error('Workflow graph: too many nodes');
  }
  if (Array.isArray(input.edges) && input.edges.length > MAX_GRAPH_EDGES) {
    throw new Error('Workflow graph: too many edges');
  }
  // Single read of caller-owned data into a detached, validated snapshot.
  const safeInput = snapshotJsonSafe(input);
  assertKnownFields(safeInput, GRAPH_FIELDS, 'graph');
  if (safeInput.version !== WORKFLOW_GRAPH_VERSION) {
    throw new Error(`Workflow graph: unsupported version ${safeInput.version}`);
  }
  if (safeInput.start !== GRAPH_START || safeInput.end !== GRAPH_END) {
    throw new Error('Workflow graph: invalid start/end sentinels');
  }
  if (!Array.isArray(safeInput.nodes) || !Array.isArray(safeInput.edges)) {
    throw new Error('Workflow graph: nodes and edges must be arrays');
  }
  if (safeInput.nodes.length > MAX_GRAPH_NODES) throw new Error('Workflow graph: too many nodes');
  if (safeInput.edges.length > MAX_GRAPH_EDGES) throw new Error('Workflow graph: too many edges');
  const definition = freezeDefinition(safeInput);
  const nodes = new Map();
  for (const node of definition.nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new Error('Workflow graph: invalid node definition');
    }
    assertKnownFields(node, NODE_FIELDS, 'node');
    if (typeof node.id !== 'string' || !node.id.trim()
      || node.id === definition.start || node.id === definition.end) {
      throw new Error(`Workflow graph: invalid node id ${node.id}`);
    }
    validateStep(node.step, { requireId: true });
    if (node.agent !== null && (typeof node.agent !== 'string' || !node.agent.trim())) {
      throw new Error(`Workflow graph: invalid node agent for ${node.id}`);
    }
    if (nodes.has(node.id)) throw new Error(`Workflow graph: duplicate node ${node.id}`);
    const expectedKind = node.step?.agent ? 'agent' : node.step?.tool ? 'tool' : 'agent';
    if (node.step?.id !== node.id
      || (node.step?.agent || null) !== (node.agent || null)
      || node.kind !== expectedKind) {
      throw new Error(`Workflow graph: node metadata mismatch for ${node.id}`);
    }
    nodes.set(node.id, node);
  }
  const outgoing = new Map();
  const edgeIds = new Set();
  const conditionResolvers = new Map();
  for (const edge of definition.edges) {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
      throw new Error('Workflow graph: invalid edge definition');
    }
    assertKnownFields(edge, EDGE_FIELDS, 'edge');
    if (typeof edge.id !== 'string' || !edge.id.trim()
      || typeof edge.from !== 'string' || !edge.from.trim()
      || typeof edge.to !== 'string' || !edge.to.trim()) {
      throw new Error('Workflow graph: invalid edge definition');
    }
    if (edgeIds.has(edge.id)) throw new Error(`Workflow graph: duplicate edge ${edge.id}`);
    edgeIds.add(edge.id);
    if (!['always', 'conditional'].includes(edge.kind)) {
      throw new Error(`Workflow graph: unsupported edge kind ${edge.kind}`);
    }
    if (edge.kind === 'always' && edge.condition !== undefined) {
      throw new Error(`Workflow graph: unconditional edge ${edge.id} cannot declare a condition`);
    }
    if (edge.kind === 'conditional') {
      const descriptor = typeof edge.condition === 'string'
        ? Object.getOwnPropertyDescriptor(conditions, edge.condition)
        : null;
      if (typeof edge.condition !== 'string'
        || !edge.condition.trim()
        || typeof descriptor?.value !== 'function') {
        throw new Error(`Workflow graph: missing condition resolver ${edge.condition || ''}`);
      }
      conditionResolvers.set(edge.condition, descriptor.value);
    }
    if (edge.from !== definition.start && !nodes.has(edge.from)) {
      throw new Error(`Workflow graph: unknown edge source ${edge.from}`);
    }
    if (edge.to !== definition.end && !nodes.has(edge.to)) {
      throw new Error(`Workflow graph: unknown edge target ${edge.to}`);
    }
    const siblings = outgoing.get(edge.from) || [];
    if (edge.kind === 'always' && siblings.some((candidate) => candidate.kind === 'always')) {
      throw new Error(`Workflow graph: multiple outgoing edges from ${edge.from} require distinct conditions`);
    }
    if (edge.kind === 'conditional'
      && siblings.some((candidate) => candidate.condition === edge.condition)) {
      throw new Error(`Workflow graph: duplicate condition ${edge.condition} from ${edge.from}`);
    }
    siblings.push(edge);
    outgoing.set(edge.from, siblings);
  }
  for (const source of [definition.start, ...nodes.keys()]) {
    if (!outgoing.has(source)) throw new Error(`Workflow graph: no outgoing edge from ${source}`);
  }
  const reachable = new Set();
  const visiting = new Set();
  const visited = new Set();
  let reachesEnd = false;
  function visit(source) {
    if (source === definition.end) { reachesEnd = true; return; }
    if (visiting.has(source)) throw new Error(`Workflow graph: non-terminating cycle at ${source}`);
    if (visited.has(source)) return;
    visiting.add(source);
    for (const edge of outgoing.get(source) || []) {
      if (edge.to !== definition.end) reachable.add(edge.to);
      visit(edge.to);
    }
    visiting.delete(source);
    visited.add(source);
  }
  visit(definition.start);
  if (!reachesEnd) throw new Error('Workflow graph: end is unreachable');
  for (const id of nodes.keys()) {
    if (!reachable.has(id)) throw new Error(`Workflow graph: unreachable node ${id}`);
  }

  function select(from, state = {}) {
    const candidates = outgoing.get(from);
    if (!candidates) throw new Error(`Workflow graph: no outgoing edge from ${from}`);
    const matches = [];
    for (const edge of candidates) {
      if (edge.kind !== 'conditional') continue;
      const result = conditionResolvers.get(edge.condition)(state);
      if (typeof result !== 'boolean') {
        throw new Error(`Workflow graph: condition ${edge.condition} must return a boolean`);
      }
      if (result) matches.push(edge);
    }
    if (matches.length > 1) throw new Error(`Workflow graph: ambiguous conditional edges from ${from}`);
    const edge = matches[0] || candidates.find((candidate) => candidate.kind === 'always');
    if (!edge) throw new Error(`Workflow graph: no matching edge from ${from}`);
    return edge;
  }

  function next(from, state = {}) {
    const edge = select(from, state);
    if (edge.to === definition.end) return GRAPH_END;
    const node = nodes.get(edge.to);
    if (!node) throw new Error(`Workflow graph: unknown node ${edge.to}`);
    return node;
  }

  function* walk({ maxNodes = definition.nodes.length, state = {} } = {}) {
    let current = definition.start;
    let visited = 0;
    while (true) {
      const currentState = typeof state === 'function' ? state() : state;
      const edge = select(current, currentState);
      if (edge.to === definition.end) return;
      if (visited++ >= maxNodes) throw new Error('Workflow graph: maxNodes exceeded');
      const node = nodes.get(edge.to);
      if (!node) throw new Error(`Workflow graph: unknown node ${edge.to}`);
      yield { node, edge };
      current = node.id;
    }
  }

  return Object.freeze({ definition, next, walk });
}
