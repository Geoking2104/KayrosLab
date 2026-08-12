// KayrosLab -- Canonical execution state shared across workflow nodes (v2).
//
// v2 changes:
//   * `node` holds the graph node id, `agent` holds the role. v1 conflated
//     them, which made per-node retry budgets and id-based routing impossible.
//   * research / simulation / draft / review are real channels written by
//     dedicated events. In v1 they were declared and never populated, so the
//     spec's `review.status == 'OK'` routing could never fire.
//   * log entries carry the node id, the agent and the correlation ids.

import { WRITABLE_CHANNELS } from './workflow-permissions.mjs';

export { WRITABLE_CHANNELS };

export const WORKFLOW_SCHEMA_VERSION = 2;

/**
 * v1 states are still readable: {@link migrateWorkflowState} promotes them.
 * Compatibility is explicit -- `validateWorkflowState` keeps refusing an
 * unmigrated v1 state rather than coercing it behind the caller's back.
 */
export const SUPPORTED_SCHEMA_VERSIONS = Object.freeze([1, 2]);
export const WORKFLOW_LOG_LIMIT = 500;
export const WORKFLOW_START_NODE = '__start__';
export const DRAFT_FORMATS = Object.freeze(['markdown', 'json']);
export const REVIEW_STATUSES = Object.freeze(['OK', 'KO']);
export const WORKFLOW_STATUSES = Object.freeze([
  'created', 'running', 'pending_review', 'revision_required',
  'completed', 'blocked', 'failed', 'cancelled',
]);

/** Events that write a state channel, mapped to the channel they own. */
export const CHANNEL_EVENTS = Object.freeze({
  research: 'research',
  simulation: 'simulation',
  draft: 'draft',
  review: 'review',
});

function defaultIdFactory(kind) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${kind}_${uuid}`;
  return `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function clone(value, fallback) {
  if (value == null) return fallback;
  return JSON.parse(JSON.stringify(value));
}

/**
 * Deep-copies caller-owned data, refusing anything a JSON round trip would
 * silently corrupt. The v1 `clone` swallowed `undefined`, stringified Dates
 * and turned NaN into null without a word; the run context comes from the
 * caller, so that corruption was invisible and unrecoverable.
 */
function jsonSafeClone(value, path, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`WorkflowState.${path} must contain only JSON-safe values`);
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new Error(`WorkflowState.${path} must contain only JSON-safe values`);
  }
  if (seen.has(value)) {
    throw new Error(`WorkflowState.${path} must contain only JSON-safe values (cycle)`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error(`WorkflowState.${path} must contain only JSON-safe values`);
  }
  if (Object.getOwnPropertySymbols(value).length) {
    throw new Error(`WorkflowState.${path} must contain only JSON-safe values`);
  }
  seen.add(value);
  let copy;
  if (Array.isArray(value)) {
    copy = value.map((item, index) => jsonSafeClone(item, `${path}.${index}`, seen));
  } else {
    copy = {};
    for (const key of Object.keys(value)) {
      copy[key] = jsonSafeClone(value[key], `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
  return copy;
}

/**
 * Derives the next state with structural sharing: only the branches an event
 * can mutate are copied. `input`, `plan` and the channel objects are treated
 * as immutable and carried by reference, so applying an event no longer
 * re-serializes the whole graph and the whole log buffer every time.
 */
function deriveState(state) {
  return {
    ...state,
    nodeAttempts: { ...state.nodeAttempts },
    errors: state.errors.slice(),
    artifacts: state.artifacts.slice(),
    logs: state.logs.slice(),
  };
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function isStructuredLogEntry(entry) {
  return Boolean(entry)
    && typeof entry === 'object'
    && !Array.isArray(entry)
    && typeof entry.ts === 'string'
    && !Number.isNaN(Date.parse(entry.ts))
    && typeof entry.type === 'string'
    && Boolean(entry.type.trim())
    && typeof entry.node === 'string'
    && Boolean(entry.node.trim())
    && (entry.agent === null || (typeof entry.agent === 'string' && Boolean(entry.agent.trim())))
    && typeof entry.runId === 'string'
    && Boolean(entry.runId.trim())
    && typeof entry.traceId === 'string'
    && Boolean(entry.traceId.trim())
    && (entry.attempt === null || (Number.isInteger(entry.attempt) && entry.attempt >= 0))
    && WORKFLOW_STATUSES.includes(entry.status);
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`WorkflowState.${label} must be an array of strings`);
  }
  return [...value];
}

// -------------------------------------------------------------- channels

function buildResearch(event) {
  return {
    facts: assertStringArray(event.facts ?? [], 'research.facts'),
    sources: assertStringArray(event.sources ?? [], 'research.sources'),
  };
}

function buildSimulation(event) {
  const metrics = event.metrics ?? {};
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
    throw new Error('WorkflowState.simulation.metrics must be an object');
  }
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`WorkflowState.simulation.metrics.${key} must be a finite number`);
    }
  }
  return {
    metrics: { ...metrics },
    warnings: assertStringArray(event.warnings ?? [], 'simulation.warnings'),
  };
}

function buildDraft(event) {
  const format = event.format ?? 'markdown';
  if (!DRAFT_FORMATS.includes(format)) {
    throw new Error(`WorkflowState.draft format must be one of ${DRAFT_FORMATS.join(', ')}`);
  }
  if (typeof event.content !== 'string') {
    throw new Error('WorkflowState.draft.content must be a string');
  }
  return { content: event.content, format };
}

function buildReview(event) {
  if (!REVIEW_STATUSES.includes(event.status)) {
    throw new Error(`WorkflowState.review status must be one of ${REVIEW_STATUSES.join(', ')}`);
  }
  return {
    status: event.status,
    comments: assertStringArray(event.comments ?? [], 'review.comments'),
  };
}

const CHANNEL_BUILDERS = Object.freeze({
  research: buildResearch,
  simulation: buildSimulation,
  draft: buildDraft,
  review: buildReview,
});

/**
 * Creates the canonical, serializable state carried by a workflow run.
 * Runtime dependencies are injectable to keep tests deterministic.
 */
export function createWorkflowState(input = {}, deps = {}) {
  const idFactory = deps.idFactory || defaultIdFactory;
  const now = deps.now || (() => new Date().toISOString());
  const createdAt = now();
  const request = String(input.input?.request ?? input.request ?? '').trim();
  const rawContext = input.input?.context ?? input.context;
  const context = rawContext == null ? {} : jsonSafeClone(rawContext, 'input.context');
  const steps = clone(input.plan?.steps, []);
  const successCriteria = clone(input.plan?.successCriteria, []);
  const graph = deepFreeze(clone(input.plan?.graph, null));
  const logs = clone(input.logs, []);
  const runId = String(input.runId || input.run_id || idFactory('run'));
  const traceId = String(input.traceId || input.trace_id || idFactory('trace'));

  const state = {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    runId,
    traceId,
    run_id: runId,
    trace_id: traceId,
    ideaId: String(input.ideaId || 'idea'),
    input: { request, context },
    plan: { steps, successCriteria, graph },
    // v2: node is the graph node id, agent is the role executing it.
    node: String(input.node || WORKFLOW_START_NODE),
    agent: input.agent == null ? null : String(input.agent),
    nodeAttempts: clone(input.nodeAttempts, {}),
    research: clone(input.research, null),
    simulation: clone(input.simulation, null),
    draft: clone(input.draft, null),
    review: clone(input.review, null),
    gate: clone(input.gate, null),
    errors: clone(input.errors, []),
    artifacts: clone(input.artifacts, []),
    logs: Array.isArray(logs) ? logs.slice(-WORKFLOW_LOG_LIMIT) : logs,
    status: String(input.status || 'created'),
    createdAt: String(input.createdAt || createdAt),
    updatedAt: String(input.updatedAt || createdAt),
  };
  validateWorkflowState(state);
  return state;
}

function pushLog(next, event) {
  if (!event.type) return;
  next.logs.push({
    ts: next.updatedAt,
    type: String(event.type),
    node: next.node,
    agent: next.agent,
    attempt: next.nodeAttempts[next.node] || null,
    status: next.status,
    runId: next.runId,
    traceId: next.traceId,
  });
  if (next.logs.length > WORKFLOW_LOG_LIMIT) {
    next.logs.splice(0, next.logs.length - WORKFLOW_LOG_LIMIT);
  }
}

/** Applies an orchestrator event immutably to the canonical workflow state. */
export function applyWorkflowEvent(state, event = {}, deps = {}) {
  validateWorkflowState(state);
  const now = deps.now || (() => new Date().toISOString());
  const next = deriveState(state);
  next.updatedAt = now();

  if (['completed', 'blocked', 'revision_required', 'failed', 'cancelled'].includes(next.status)) {
    pushLog(next, event);
    validateWorkflowState(next);
    return next;
  }

  const channel = CHANNEL_EVENTS[event.type];
  if (event.type === 'artifacts') {
    // Append-only: the audit trail is never rewritten, only extended.
    if (event.nodeId) next.node = String(event.nodeId);
    if (event.agent !== undefined) next.agent = event.agent == null ? null : String(event.agent);
    next.status = 'running';
    const added = Array.isArray(event.artifacts) ? event.artifacts : [];
    next.artifacts = [...next.artifacts, ...clone(added, [])];
  } else if (channel) {
    // Channel events also move the cursor: they are emitted by the node that
    // owns the channel, and routing conditions read both.
    if (event.nodeId) next.node = String(event.nodeId);
    if (event.agent !== undefined) next.agent = event.agent == null ? null : String(event.agent);
    next.status = 'running';
    next[channel] = CHANNEL_BUILDERS[channel](event);
  } else if (event.type === 'start') {
    next.node = WORKFLOW_START_NODE;
    next.agent = null;
    next.status = 'running';
  } else if (event.type === 'trace') {
    const nodeId = String(event.nodeId || event.node || event.agent || 'agent');
    next.node = nodeId;
    next.agent = event.agent == null ? null : String(event.agent);
    next.status = 'running';
    next.nodeAttempts[nodeId] = (next.nodeAttempts[nodeId] || 0) + 1;
  } else if (event.type === 'gate') {
    next.node = 'human_gate';
    next.agent = null;
    next.status = 'pending_review';
    next.gate = {
      id: event.gateId || null,
      type: event.gateType || null,
      // The node the gate guards. Without it a suspended run cannot say
      // where to resume, and `resumable` is an empty word.
      nodeId: event.nodeId || null,
      status: event.status || 'pending_review',
    };
  } else if (event.type === 'gate_resolved') {
    next.node = 'human_gate';
    next.agent = null;
    next.status = 'running';
    next.gate = {
      ...(next.gate || {}),
      status: 'resolved',
      decision: clone(event.decision, null),
    };
  } else if (event.type === 'soft_error') {
    // Observability only: a degraded optional phase must be visible in the
    // audit trail without moving the cursor or changing the run status.
  } else if (event.type === 'error') {
    next.node = String(event.nodeId || event.node || next.node || 'unknown');
    next.status = 'failed';
    next.errors.push({
      node: next.node,
      agent: next.agent,
      code: event.code || null,
      message: String(event.error || event.message || 'workflow error'),
      ts: next.updatedAt,
    });
  } else if (event.type === 'cancelled') {
    next.node = 'end';
    next.status = 'cancelled';
  } else if (event.type === 'halt') {
    next.node = 'halt';
    next.status = 'failed';
  } else if (event.type === 'final') {
    if (next.status === 'failed' || next.status === 'cancelled') {
      next.node = 'end';
    } else if (event.status === 'pending_review') {
      next.node = 'human_gate';
      next.status = 'pending_review';
    } else if (event.status === 'blocked_veto') {
      next.node = 'end';
      next.status = 'blocked';
    } else if (event.status === 'revise') {
      next.node = 'revision';
      next.status = 'revision_required';
    } else {
      next.node = 'end';
      next.status = 'completed';
    }
  } else if (event.type) {
    next.node = String(event.nodeId || event.node || event.type);
  }

  pushLog(next, event);
  validateWorkflowState(next);
  return next;
}

/**
 * Returns a detached, deep-frozen snapshot of the canonical workflow state.
 * The orchestrator keeps the live state private for conditional routing and
 * exposes only these snapshots on yielded events, so consumers can never
 * mutate routing-relevant state by reference.
 */
export function freezeWorkflowState(state) {
  validateWorkflowState(state);
  // Every mutable branch is copied before freezing: sharing an array here
  // would freeze the live state's buffers and break the next event.
  // `plan` and its graph are immutable by contract and shared by reference,
  // which is what keeps this O(logs) rather than O(logs + graph).
  const snapshot = {
    ...state,
    input: { request: state.input.request, context: clone(state.input.context, {}) },
    plan: { ...state.plan },
    nodeAttempts: { ...state.nodeAttempts },
    errors: state.errors.map((entry) => ({ ...entry })),
    artifacts: clone(state.artifacts, []),
    logs: state.logs.map((entry) => ({ ...entry })),
    research: clone(state.research, null),
    simulation: clone(state.simulation, null),
    draft: clone(state.draft, null),
    review: clone(state.review, null),
    gate: clone(state.gate, null),
  };
  validateWorkflowState(snapshot);
  return deepFreeze(snapshot);
}

/**
 * Promotes a persisted v1 state to the v2 schema. v1 stored the agent role in
 * `node`, so the role is lifted into `agent` and the node id keeps the same
 * value -- v1 simply had no better information. Idempotent on a v2 state.
 */
export function migrateWorkflowState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('WorkflowState must be an object');
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(state.schemaVersion)) {
    throw new Error(`WorkflowState: unsupported schema version ${state.schemaVersion}`);
  }
  if (state.schemaVersion === WORKFLOW_SCHEMA_VERSION) {
    validateWorkflowState(state);
    return clone(state, {});
  }

  const legacy = clone(state, {});
  const runId = String(legacy.runId || legacy.run_id || '');
  const traceId = String(legacy.traceId || legacy.trace_id || '');
  const role = typeof legacy.node === 'string' && legacy.node.trim() ? legacy.node : null;

  const migrated = {
    ...legacy,
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    runId,
    traceId,
    run_id: runId,
    trace_id: traceId,
    node: role || WORKFLOW_START_NODE,
    agent: role,
    logs: (Array.isArray(legacy.logs) ? legacy.logs : []).map((entry) => ({
      ...entry,
      node: typeof entry.node === 'string' && entry.node.trim() ? entry.node : (role || WORKFLOW_START_NODE),
      agent: entry.agent === undefined
        ? (typeof entry.node === 'string' && entry.node.trim() ? entry.node : role)
        : entry.agent,
      runId: entry.runId || runId,
      traceId: entry.traceId || traceId,
    })).slice(-WORKFLOW_LOG_LIMIT),
  };
  validateWorkflowState(migrated);
  return migrated;
}

function validateChannels(state) {
  if (state.research !== null) {
    if (!state.research || typeof state.research !== 'object' || Array.isArray(state.research)
      || !Array.isArray(state.research.facts) || !Array.isArray(state.research.sources)) {
      throw new Error('WorkflowState.research is invalid');
    }
  }
  if (state.simulation !== null) {
    if (!state.simulation || typeof state.simulation !== 'object' || Array.isArray(state.simulation)
      || !state.simulation.metrics || typeof state.simulation.metrics !== 'object'
      || Array.isArray(state.simulation.metrics)
      || !Array.isArray(state.simulation.warnings)) {
      throw new Error('WorkflowState.simulation is invalid');
    }
  }
  if (state.draft !== null) {
    if (!state.draft || typeof state.draft !== 'object' || Array.isArray(state.draft)
      || typeof state.draft.content !== 'string'
      || !DRAFT_FORMATS.includes(state.draft.format)) {
      throw new Error('WorkflowState.draft is invalid');
    }
  }
  if (state.review !== null) {
    if (!state.review || typeof state.review !== 'object' || Array.isArray(state.review)
      || !REVIEW_STATUSES.includes(state.review.status)
      || !Array.isArray(state.review.comments)) {
      throw new Error('WorkflowState.review is invalid');
    }
  }
}

/** Throws on an invalid state and returns true otherwise. */
export function validateWorkflowState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('WorkflowState must be an object');
  }
  if (state.schemaVersion !== WORKFLOW_SCHEMA_VERSION) {
    throw new Error(`WorkflowState.schemaVersion must be ${WORKFLOW_SCHEMA_VERSION}`);
  }
  for (const key of ['runId', 'traceId', 'ideaId', 'node', 'status', 'createdAt', 'updatedAt']) {
    if (typeof state[key] !== 'string' || !state[key].trim()) {
      throw new Error(`WorkflowState.${key} is required`);
    }
  }
  if (state.agent !== null && (typeof state.agent !== 'string' || !state.agent.trim())) {
    throw new Error('WorkflowState.agent must be a non-blank string or null');
  }
  if (state.run_id !== state.runId) {
    throw new Error('WorkflowState.run_id must equal runId');
  }
  if (state.trace_id !== state.traceId) {
    throw new Error('WorkflowState.trace_id must equal traceId');
  }
  if (!WORKFLOW_STATUSES.includes(state.status)) {
    throw new Error(`WorkflowState.status is invalid: ${state.status}`);
  }
  if (!state.input || typeof state.input.request !== 'string'
    || !state.input.context || typeof state.input.context !== 'object' || Array.isArray(state.input.context)) {
    throw new Error('WorkflowState.input is invalid');
  }
  if (!state.plan || !Array.isArray(state.plan.steps) || !Array.isArray(state.plan.successCriteria)) {
    throw new Error('WorkflowState.plan is invalid');
  }
  if (!state.nodeAttempts || typeof state.nodeAttempts !== 'object' || Array.isArray(state.nodeAttempts)) {
    throw new Error('WorkflowState.nodeAttempts is invalid');
  }
  if (!Object.values(state.nodeAttempts).every((attempt) => Number.isInteger(attempt) && attempt >= 0)) {
    throw new Error('WorkflowState.nodeAttempts values must be non-negative integers');
  }
  if (!Array.isArray(state.errors) || !Array.isArray(state.artifacts) || !Array.isArray(state.logs)) {
    throw new Error('WorkflowState errors/artifacts/logs must be arrays');
  }
  validateChannels(state);
  if (state.logs.length > WORKFLOW_LOG_LIMIT
    || !state.logs.every(isStructuredLogEntry)) {
    throw new Error(`WorkflowState.logs must contain at most ${WORKFLOW_LOG_LIMIT} structured entries`);
  }
  return true;
}
