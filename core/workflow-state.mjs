// KayrosLab — Canonical execution state shared across workflow nodes.

export const WORKFLOW_SCHEMA_VERSION = 1;
export const WORKFLOW_LOG_LIMIT = 500;
export const WORKFLOW_STATUSES = Object.freeze([
  'created', 'running', 'pending_review', 'revision_required',
  'completed', 'blocked', 'failed', 'cancelled',
]);

function defaultIdFactory(kind) {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${kind}_${uuid}`;
  return `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function clone(value, fallback) {
  if (value == null) return fallback;
  return JSON.parse(JSON.stringify(value));
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
    && (entry.attempt === null || (Number.isInteger(entry.attempt) && entry.attempt >= 0))
    && WORKFLOW_STATUSES.includes(entry.status);
}

/**
 * Creates the canonical, serializable state carried by a workflow run.
 * Runtime dependencies are injectable to keep tests deterministic.
 */
export function createWorkflowState(input = {}, deps = {}) {
  const idFactory = deps.idFactory || defaultIdFactory;
  const now = deps.now || (() => new Date().toISOString());
  const createdAt = now();
  const request = String(input.input?.request ?? input.request ?? '').trim();
  const context = clone(input.input?.context ?? input.context, {});
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
    node: String(input.node || 'planner'),
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

/** Applies an orchestrator event immutably to the canonical workflow state. */
export function applyWorkflowEvent(state, event = {}, deps = {}) {
  validateWorkflowState(state);
  const now = deps.now || (() => new Date().toISOString());
  const next = clone(state, {});
  next.plan.graph = deepFreeze(next.plan.graph);
  next.updatedAt = now();

  if (['completed', 'blocked', 'revision_required', 'failed', 'cancelled'].includes(next.status)) {
    if (event.type) {
      next.logs.push({
        ts: next.updatedAt,
        type: String(event.type),
        node: next.node,
        attempt: next.nodeAttempts[next.node] || null,
        status: next.status,
      });
      if (next.logs.length > WORKFLOW_LOG_LIMIT) {
        next.logs.splice(0, next.logs.length - WORKFLOW_LOG_LIMIT);
      }
    }
    validateWorkflowState(next);
    return next;
  }

  if (event.type === 'start') {
    next.node = 'start';
    next.status = 'running';
  } else if (event.type === 'trace') {
    const node = String(event.agent || event.node || 'agent');
    next.node = node;
    next.status = 'running';
    next.nodeAttempts[node] = (next.nodeAttempts[node] || 0) + 1;
  } else if (event.type === 'gate') {
    next.node = 'human_gate';
    next.status = 'pending_review';
    next.gate = {
      id: event.gateId || null,
      type: event.gateType || null,
      status: event.status || 'pending_review',
    };
  } else if (event.type === 'gate_resolved') {
    next.node = 'human_gate';
    next.status = 'running';
    next.gate = {
      ...(next.gate || {}),
      status: 'resolved',
      decision: clone(event.decision, null),
    };
  } else if (event.type === 'error') {
    next.node = String(event.node || next.node || 'unknown');
    next.status = 'failed';
    next.errors.push({
      node: next.node,
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
    next.node = String(event.node || event.type);
  }

  if (event.type) {
    next.logs.push({
      ts: next.updatedAt,
      type: String(event.type),
      node: next.node,
      attempt: next.nodeAttempts[next.node] || null,
      status: next.status,
    });
    if (next.logs.length > WORKFLOW_LOG_LIMIT) {
      next.logs.splice(0, next.logs.length - WORKFLOW_LOG_LIMIT);
    }
  }

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
  const snapshot = clone(state, {});
  snapshot.plan.graph = state.plan.graph ?? null;
  validateWorkflowState(snapshot);
  return deepFreeze(snapshot);
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
  if (state.logs.length > WORKFLOW_LOG_LIMIT
    || !state.logs.every(isStructuredLogEntry)) {
    throw new Error(`WorkflowState.logs must contain at most ${WORKFLOW_LOG_LIMIT} structured entries`);
  }
  return true;
}
