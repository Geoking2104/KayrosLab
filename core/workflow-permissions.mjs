// KayrosLab -- Per-node permission enforcement for the workflow graph.
//
// Graph Engineering spec section 2 gives every node an explicit permission
// boundary (Planner cannot execute, Researcher reads only, Verifier annotates
// but never rewrites, Writer owns the draft, Logger owns the audit trail).
// Before v2 that boundary was documented but never enforced: ToolRegistry
// carried `sideEffect` and `gate` metadata that no caller ever read, so any
// node could invoke any tool. This module is the single enforcement point.

/** State channels a node may be granted write access to. */
export const WRITABLE_CHANNELS = Object.freeze([
  'research', 'simulation', 'draft', 'review', 'artifacts',
]);

/** Tool side effects, ordered from least to most dangerous. */
export const SIDE_EFFECTS = Object.freeze(['none', 'read', 'write']);

const EMPTY_PERMISSIONS = Object.freeze({ tools: Object.freeze([]), writes: Object.freeze([]) });

/**
 * Normalizes a node permission block. Absent permissions mean "no capability":
 * a node must opt in to every tool and every channel it touches.
 */
export function normalizePermissions(permissions) {
  if (permissions === undefined || permissions === null) return EMPTY_PERMISSIONS;
  if (typeof permissions !== 'object' || Array.isArray(permissions)) {
    throw new Error('Workflow permissions: permissions must be an object');
  }
  for (const key of Object.keys(permissions)) {
    if (key !== 'tools' && key !== 'writes') {
      throw new Error(`Workflow permissions: unknown permission field ${key}`);
    }
  }
  const { tools = [], writes = [] } = permissions;
  if (tools !== '*' && !Array.isArray(tools)) {
    throw new Error('Workflow permissions: tools must be an array or "*"');
  }
  if (Array.isArray(tools) && !tools.every((name) => typeof name === 'string' && name.trim())) {
    throw new Error('Workflow permissions: tool names must be non-blank strings');
  }
  if (!Array.isArray(writes)) {
    throw new Error('Workflow permissions: writes must be an array');
  }
  for (const channel of writes) {
    if (!WRITABLE_CHANNELS.includes(channel)) {
      throw new Error(`Workflow permissions: unknown channel ${channel}`);
    }
  }
  return Object.freeze({
    tools: tools === '*' ? '*' : Object.freeze([...tools]),
    writes: Object.freeze([...writes]),
  });
}

function permissionsOf(node) {
  if (!node || typeof node !== 'object') {
    throw new Error('Workflow permissions: node is required');
  }
  const raw = node.permissions;
  if (raw && raw.tools !== undefined && raw.writes !== undefined
    && (raw.tools === '*' || Array.isArray(raw.tools)) && Array.isArray(raw.writes)) {
    return raw;
  }
  return normalizePermissions(raw);
}

/**
 * Throws unless `node` may invoke `toolDef`.
 *
 * Three rules, checked in order:
 *  1. the tool must be on the node's allowlist;
 *  2. the wildcard allowlist never covers write-effect tools -- destructive
 *     capability is always named explicitly;
 *  3. a tool flagged `gate: true` needs an approved human gate, whatever the
 *     allowlist says (spec section 5).
 */
export function assertToolAllowed(node, toolDef, { gateApproved = false } = {}) {
  if (!toolDef || typeof toolDef !== 'object' || typeof toolDef.name !== 'string') {
    throw new Error('Workflow permissions: tool definition is required');
  }
  const { tools } = permissionsOf(node);
  const nodeId = node.id || 'node';
  const sideEffect = toolDef.sideEffect || 'none';
  if (!SIDE_EFFECTS.includes(sideEffect)) {
    throw new Error(`Workflow permissions: unknown side effect ${sideEffect} on ${toolDef.name}`);
  }

  if (tools === '*') {
    if (sideEffect === 'write') {
      throw new Error(
        `Workflow permissions: ${nodeId} holds a wildcard allowlist, but write tool `
        + `${toolDef.name} must be explicitly allowlisted`,
      );
    }
  } else if (!tools.includes(toolDef.name)) {
    throw new Error(`Workflow permissions: tool ${toolDef.name} is not permitted for ${nodeId}`);
  }

  if (toolDef.gate === true && !gateApproved) {
    throw new Error(
      `Workflow permissions: tool ${toolDef.name} requires an approved human gate before ${nodeId} may call it`,
    );
  }
  return true;
}

/** Boolean form of {@link assertToolAllowed}. */
export function isToolAllowed(node, toolDef, options = {}) {
  try {
    return assertToolAllowed(node, toolDef, options);
  } catch {
    return false;
  }
}

/** Throws unless `node` may write `channel` on the shared workflow state. */
export function assertChannelWritable(node, channel) {
  if (!WRITABLE_CHANNELS.includes(channel)) {
    throw new Error(`Workflow permissions: unknown channel ${channel}`);
  }
  const { writes } = permissionsOf(node);
  if (!writes.includes(channel)) {
    const nodeId = node.id || 'node';
    throw new Error(`Workflow permissions: ${nodeId} cannot write channel ${channel}`);
  }
  return true;
}

/** Boolean form of {@link assertChannelWritable}. */
export function isChannelWritable(node, channel) {
  try {
    return assertChannelWritable(node, channel);
  } catch {
    return false;
  }
}
