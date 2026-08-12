// KayrosLab -- role-scoped context.
//
// Graph Engineering spec section 6: "Contexte passe = minimum requis (pas
// d'historique complet)." Until now every node received the same
// `contextBlock` plus whatever the orchestrator had on hand. That is not
// only wasteful, it is a correctness problem:
//
//   * a Researcher that sees the draft stops researching and starts
//     confirming it;
//   * a Verifier that sees the memory context judges the draft against
//     recalled material instead of the declared success criteria.
//
// The policy below is therefore a contract, not an optimization.

/**
 * Per role: which state channels it may read, whether it gets the plan's
 * success criteria, and whether it gets the shared memory context block.
 */
export const ROLE_CONTEXT_POLICY = Object.freeze({
  // Plans from the goal and the criteria; reads no produced artefact.
  Planner: Object.freeze({
    channels: Object.freeze([]), successCriteria: true, memoryContext: true,
  }),
  // Researches the goal. Deliberately blind to the draft and the review.
  Researcher: Object.freeze({
    channels: Object.freeze([]), successCriteria: true, memoryContext: true,
  }),
  // Computes from the collected facts.
  Simulator: Object.freeze({
    channels: Object.freeze(['research']), successCriteria: false, memoryContext: false,
  }),
  // Writes from facts and metrics, and needs the rejection comments to revise.
  Writer: Object.freeze({
    channels: Object.freeze(['research', 'simulation', 'review']),
    successCriteria: true, memoryContext: true,
  }),
  // Judges the draft against the criteria. Nothing else, on purpose.
  Verifier: Object.freeze({
    channels: Object.freeze(['draft']), successCriteria: true, memoryContext: false,
  }),
  // Records; reads everything but produces no reasoning.
  Logger: Object.freeze({
    channels: Object.freeze(['research', 'simulation', 'draft', 'review']),
    successCriteria: false, memoryContext: false,
  }),
  // Escalates; the human needs the verdict that caused it.
  HumanGate: Object.freeze({
    channels: Object.freeze(['draft', 'review']), successCriteria: true, memoryContext: false,
  }),

  // Dialectical roster: unchanged behaviour, the shared context is the point.
  Critic: Object.freeze({
    channels: Object.freeze([]), successCriteria: true, memoryContext: true,
  }),
  DevilsAdvocate: Object.freeze({
    channels: Object.freeze([]), successCriteria: true, memoryContext: true,
  }),
  RedTeam: Object.freeze({
    channels: Object.freeze([]), successCriteria: true, memoryContext: true,
  }),
  Bisociateur: Object.freeze({
    channels: Object.freeze([]), successCriteria: false, memoryContext: true,
  }),
  Synthesizer: Object.freeze({
    channels: Object.freeze(['research', 'simulation', 'draft', 'review']),
    successCriteria: true, memoryContext: true,
  }),
});

const ALL_CHANNELS = Object.freeze(['research', 'simulation', 'draft', 'review']);

/**
 * Default for a role with no declared policy: the shared context only, and no
 * channel at all. Failing closed here matters -- a new agent must opt in to
 * the state it reads rather than silently inherit everything.
 */
const DEFAULT_POLICY = Object.freeze({
  channels: Object.freeze([]), successCriteria: false, memoryContext: true,
});

export function policyForRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_CONTEXT_POLICY, role)
    ? ROLE_CONTEXT_POLICY[role]
    : DEFAULT_POLICY;
}

/**
 * Builds the context object handed to one node, masking every channel its
 * role may not read.
 *
 * @param {string} role
 * @param {object} shared
 * @param {object} [shared.state]           live workflow state
 * @param {string} [shared.contextBlock]    recalled memory block
 * @param {string[]} [shared.successCriteria]
 */
export function buildRoleContext(role, {
  state = null, contextBlock = '', successCriteria = [],
} = {}) {
  const policy = policyForRole(role);
  const out = {
    role,
    context: policy.memoryContext ? (contextBlock || '') : '',
    successCriteria: policy.successCriteria ? [...(successCriteria || [])] : [],
  };
  for (const channel of ALL_CHANNELS) {
    out[channel] = policy.channels.includes(channel) ? (state?.[channel] ?? null) : null;
  }
  return out;
}
