// KayrosLab -- Workflow graph declaration and compilation (v2).
//
// v2 changes the contract in three ways, all required by the Graph
// Engineering spec:
//   * cycles are legal when bounded (spec section 4 needs Verifier -KO-> Writer);
//   * every node carries an attempt budget (spec section 5);
//   * every node carries an explicit permission boundary (spec section 2).
// Termination is no longer guaranteed by acyclicity but by two invariants:
// every node must be able to reach the end, and every node inside a cycle
// must declare a finite attempt budget.

import { normalizePermissions, WRITABLE_CHANNELS } from './workflow-permissions.mjs';

export const GRAPH_START = '__start__';
export const GRAPH_END = '__end__';
export const WORKFLOW_GRAPH_VERSION = 2;

/**
 * v1 payloads are still accepted: they are promoted to v2 with validated
 * defaults, then held to the full v2 invariants. Compatibility is explicit,
 * never silent -- a v1 node that already carries v2 fields is refused rather
 * than half-trusted.
 */
export const SUPPORTED_GRAPH_VERSIONS = Object.freeze([1, 2]);

const MAX_GRAPH_NODES = 256;
const MAX_GRAPH_EDGES = 1024;
const MAX_JSON_DEPTH = 64;
const DEFAULT_STEP_BUDGET_FACTOR = 8;
const MIN_STEP_BUDGET = 64;

const GRAPH_FIELDS = new Set(['version', 'start', 'end', 'nodes', 'edges']);
const NODE_FIELDS = new Set(['id', 'kind', 'agent', 'step', 'maxAttempts', 'permissions', 'gate']);
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

/**
 * `null` means "unbounded" and is only legal outside a cycle. Any other value
 * must be a positive integer: a budget of zero would make the node
 * unreachable, which is a graph authoring error rather than a runtime state.
 */
function normalizeMaxAttempts(value, nodeId) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Workflow graph: maxAttempts for ${nodeId} must be a positive integer`);
  }
  return value;
}

/**
 * A gate declaration makes the human checkpoint part of the topology instead
 * of a branch hard-wired after the walk (spec section 5). `type` is what the
 * governance layer opens; `requiredRole` is who may resolve it.
 */
function normalizeGate(value, nodeId) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Workflow graph: gate on ${nodeId} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (key !== 'type' && key !== 'requiredRole') {
      throw new Error(`Workflow graph: unknown gate field ${key} on ${nodeId}`);
    }
  }
  if (typeof value.type !== 'string' || !value.type.trim()) {
    throw new Error(`Workflow graph: gate type on ${nodeId} must be a non-blank string`);
  }
  if (value.requiredRole !== undefined
    && (typeof value.requiredRole !== 'string' || !value.requiredRole.trim())) {
    throw new Error(`Workflow graph: gate requiredRole on ${nodeId} must be a non-blank string`);
  }
  return Object.freeze({ type: value.type, requiredRole: value.requiredRole || 'comex' });
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
      // A declared linear graph runs each node once; there is no back edge
      // that could re-enter it.
      maxAttempts: 1,
      permissions: { tools: step.tool ? [step.tool] : [], writes: [] },
      gate: null,
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

/**
 * Promotes a v1 graph to the v2 shape. v1 nodes ran exactly once along a
 * linear route, so the promoted attempt budget is 1; a v1 tool node is
 * allowlisted for exactly the tool its step names, and nothing else.
 * Idempotent on a v2 graph.
 */
export function upgradeWorkflowGraph(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Workflow graph: graph definition must be an object');
  }
  if (!SUPPORTED_GRAPH_VERSIONS.includes(input.version)) {
    throw new Error(`Workflow graph: unsupported version ${input.version}`);
  }
  const safeInput = snapshotJsonSafe(input);
  if (safeInput.version === WORKFLOW_GRAPH_VERSION) return safeInput;

  for (const node of safeInput.nodes || []) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new Error('Workflow graph: invalid node definition');
    }
    if (node.maxAttempts !== undefined || node.permissions !== undefined) {
      throw new Error(
        `Workflow graph: v1 node ${node.id} must not declare v2 fields (maxAttempts, permissions)`,
      );
    }
    node.maxAttempts = 1;
    node.permissions = { tools: node.step?.tool ? [node.step.tool] : [], writes: [] };
    node.gate = null;
  }
  safeInput.version = WORKFLOW_GRAPH_VERSION;
  return safeInput;
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
  const sourceVersion = input.version;
  // Single read of caller-owned data into a detached, validated snapshot,
  // promoting a v1 payload to the v2 shape along the way.
  const safeInput = upgradeWorkflowGraph(input);
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

  // Normalize permissions and attempt budgets before freezing so the frozen
  // definition is the same object the runtime enforces against.
  for (const node of safeInput.nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new Error('Workflow graph: invalid node definition');
    }
    assertKnownFields(node, NODE_FIELDS, 'node');
    node.maxAttempts = normalizeMaxAttempts(node.maxAttempts, node.id ?? 'node');
    node.permissions = normalizePermissions(node.permissions);
    node.gate = normalizeGate(node.gate, node.id ?? 'node');
  }

  const definition = freezeDefinition(safeInput);
  const nodes = new Map();
  for (const node of definition.nodes) {
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
    for (const channel of node.permissions.writes) {
      if (!WRITABLE_CHANNELS.includes(channel)) {
        throw new Error(`Workflow graph: unknown channel ${channel} on node ${node.id}`);
      }
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

  // --- Reachability from the start (unchanged intent, iterative) ---
  const reachable = new Set();
  const stack = [definition.start];
  const seenForward = new Set([definition.start]);
  let reachesEnd = false;
  while (stack.length) {
    const source = stack.pop();
    for (const edge of outgoing.get(source) || []) {
      if (edge.to === definition.end) { reachesEnd = true; continue; }
      reachable.add(edge.to);
      if (!seenForward.has(edge.to)) { seenForward.add(edge.to); stack.push(edge.to); }
    }
  }
  if (!reachesEnd) throw new Error('Workflow graph: end is unreachable');
  for (const id of nodes.keys()) {
    if (!reachable.has(id)) throw new Error(`Workflow graph: unreachable node ${id}`);
  }

  // --- Every node must be able to reach the end (no traps) ---
  // Replaces the v1 acyclicity check: a cycle is fine, a dead end is not.
  const incoming = new Map();
  for (const edge of definition.edges) {
    const list = incoming.get(edge.to) || [];
    list.push(edge);
    incoming.set(edge.to, list);
  }
  const canReachEnd = new Set([definition.end]);
  const backStack = [definition.end];
  while (backStack.length) {
    const target = backStack.pop();
    for (const edge of incoming.get(target) || []) {
      if (!canReachEnd.has(edge.from)) {
        canReachEnd.add(edge.from);
        backStack.push(edge.from);
      }
    }
  }
  for (const id of nodes.keys()) {
    if (!canReachEnd.has(id)) {
      throw new Error(`Workflow graph: node ${id} cannot reach the end`);
    }
  }

  // --- Cycles are legal only when every node in them is bounded ---
  const cyclicNodes = findCyclicNodes(nodes, outgoing, definition);
  if (sourceVersion === 1 && cyclicNodes.size) {
    // A v1 graph was acyclic by construction. Promoting it must not silently
    // grant it a revision loop it was never validated for.
    throw new Error(
      `Workflow graph: a v1 graph must stay acyclic (cycle at ${[...cyclicNodes][0]})`,
    );
  }
  for (const id of cyclicNodes) {
    if (nodes.get(id).maxAttempts === null) {
      throw new Error(
        `Workflow graph: unbounded cycle at ${id} -- every node in a cycle must declare maxAttempts`,
      );
    }
  }

  const stepBudget = Math.max(nodes.size * DEFAULT_STEP_BUDGET_FACTOR, MIN_STEP_BUDGET);
  const hasConditionalEdges = definition.edges.some((edge) => edge.kind === 'conditional');

  function attemptsFor(state, nodeId) {
    const attempts = state?.nodeAttempts?.[nodeId];
    return Number.isInteger(attempts) && attempts > 0 ? attempts : 0;
  }

  /** A node is enterable while it has attempt budget left. */
  function hasBudget(state, nodeId) {
    if (nodeId === definition.end) return true;
    const node = nodes.get(nodeId);
    if (!node || node.maxAttempts === null) return true;
    return attemptsFor(state, nodeId) < node.maxAttempts;
  }

  function evaluate(condition, state) {
    let result;
    try {
      result = conditionResolvers.get(condition)(state);
    } catch (cause) {
      // A throwing resolver must not escape as a raw exception: it would
      // bypass the event protocol entirely.
      throw new Error(`Workflow graph: condition ${condition} threw: ${cause?.message || cause}`);
    }
    if (typeof result !== 'boolean') {
      throw new Error(`Workflow graph: condition ${condition} must return a boolean`);
    }
    return result;
  }

  function select(from, state = {}) {
    const candidates = outgoing.get(from);
    if (!candidates) throw new Error(`Workflow graph: no outgoing edge from ${from}`);
    const affordable = candidates.filter((edge) => hasBudget(state, edge.to));
    const matches = [];
    for (const edge of affordable) {
      if (edge.kind !== 'conditional') continue;
      if (evaluate(edge.condition, state)) matches.push(edge);
    }
    if (matches.length > 1) throw new Error(`Workflow graph: ambiguous conditional edges from ${from}`);
    const edge = matches[0] || affordable.find((candidate) => candidate.kind === 'always');
    if (edge) return edge;
    if (affordable.length < candidates.length) {
      throw new Error(
        `Workflow graph: attempts exhausted for every remaining edge from ${from}`,
      );
    }
    throw new Error(`Workflow graph: no matching edge from ${from}`);
  }

  function next(from, state = {}) {
    const edge = select(from, state);
    if (edge.to === definition.end) return GRAPH_END;
    const node = nodes.get(edge.to);
    if (!node) throw new Error(`Workflow graph: unknown node ${edge.to}`);
    return node;
  }

  /**
   * Walks the graph. `maxSteps` bounds the number of node visits, not the
   * number of distinct nodes: with cycles allowed, the node count is no
   * longer an upper bound on the traversal length.
   */
  function* walk({ maxSteps = stepBudget, state = {}, from = null } = {}) {
    // A conditional graph routes on live state. Walking it with a frozen
    // snapshot -- or with nothing at all -- silently collapses every
    // condition to false and takes the `always` edge, so the same graph
    // would route differently depending on the caller. Refuse instead.
    if (hasConditionalEdges && typeof state !== 'function') {
      throw new Error('Workflow graph: a conditional graph requires a state provider function');
    }
    let current = definition.start;
    let visited = 0;
    // Resuming: the node the run stopped at never executed, so it is yielded
    // first and traversal continues from there.
    if (from !== null && from !== undefined) {
      const entry = nodes.get(from);
      if (!entry) throw new Error(`Workflow graph: unknown node ${from}`);
      visited += 1;
      yield { node: entry, edge: null };
      current = entry.id;
    }
    for (;;) {
      const currentState = typeof state === 'function' ? state() : state;
      const edge = select(current, currentState);
      if (edge.to === definition.end) return;
      if (visited++ >= maxSteps) throw new Error('Workflow graph: maxSteps exceeded');
      const node = nodes.get(edge.to);
      if (!node) throw new Error(`Workflow graph: unknown node ${edge.to}`);
      yield { node, edge };
      current = node.id;
    }
  }

  function nodeById(id) { return nodes.get(id) || null; }

  return Object.freeze({
    definition, next, walk, nodeById, stepBudget, hasConditionalEdges, sourceVersion,
  });
}

/**
 * Returns the set of node ids that take part in at least one cycle, using an
 * iterative Tarjan strongly-connected-components pass. Nodes in a component
 * of size > 1, and nodes carrying a self-loop, are cyclic.
 */
function findCyclicNodes(nodes, outgoing, definition) {
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const cyclic = new Set();
  let counter = 0;

  const successors = (id) => (outgoing.get(id) || [])
    .map((edge) => edge.to)
    .filter((to) => to !== definition.end && nodes.has(to));

  for (const root of nodes.keys()) {
    if (index.has(root)) continue;
    const work = [{ id: root, successors: successors(root), cursor: 0 }];
    index.set(root, counter); low.set(root, counter); counter += 1;
    stack.push(root); onStack.add(root);

    while (work.length) {
      const frame = work[work.length - 1];
      if (frame.cursor < frame.successors.length) {
        const child = frame.successors[frame.cursor];
        frame.cursor += 1;
        if (child === frame.id) { cyclic.add(child); continue; }
        if (!index.has(child)) {
          index.set(child, counter); low.set(child, counter); counter += 1;
          stack.push(child); onStack.add(child);
          work.push({ id: child, successors: successors(child), cursor: 0 });
        } else if (onStack.has(child)) {
          low.set(frame.id, Math.min(low.get(frame.id), index.get(child)));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.id, Math.min(low.get(parent.id), low.get(frame.id)));
      if (low.get(frame.id) === index.get(frame.id)) {
        const component = [];
        for (;;) {
          const member = stack.pop();
          onStack.delete(member);
          component.push(member);
          if (member === frame.id) break;
        }
        if (component.length > 1) for (const member of component) cyclic.add(member);
      }
    }
  }
  return cyclic;
}
