// KayrosLab — L3 / layered memory scope resolution.
// Normalizes tenantId, builds hierarchical scope chains, merges engine defaults.

/**
 * @typedef {{ scope: string, scopeId: string }} ScopeRef
 */

/**
 * Resolve effective L3 scopes from call opts + engine defaults.
 *
 * Rules:
 * 1. Explicit `scopes[]` wins when non-empty.
 * 2. `tenantId` alone ⇒ `{ scope: 'tenant', scopeId: tenantId }`.
 * 3. Hierarchy (most specific first): user → team → organization → tenant.
 * 4. Single `scope` + `scopeId` (or defaults) used when no hierarchy ids.
 * 5. No scope at all ⇒ empty chain (safe multi-tenant: L3 omitted).
 *
 * @param {Object} [callOpts]
 * @param {Object} [engineDefaults]
 * @returns {{ scopes: ScopeRef[], scope: string|null, scopeId: string|null, tenantId: string|null }}
 */
export function resolveMemoryScope(callOpts = {}, engineDefaults = {}) {
  const opts = { ...engineDefaults, ...callOpts };

  // Explicit chain
  if (Array.isArray(opts.scopes) && opts.scopes.length) {
    const scopes = opts.scopes
      .filter((s) => s && s.scope && s.scopeId)
      .map((s) => ({ scope: String(s.scope), scopeId: String(s.scopeId) }));
    const tenantId = opts.tenantId
      || scopes.find((s) => s.scope === 'tenant')?.scopeId
      || null;
    return {
      scopes,
      scope: scopes[0]?.scope || null,
      scopeId: scopes[0]?.scopeId || null,
      tenantId: tenantId ? String(tenantId) : null,
    };
  }

  const tenantId = opts.tenantId != null && opts.tenantId !== ''
    ? String(opts.tenantId)
    : null;
  const userId = opts.userId != null && opts.userId !== '' ? String(opts.userId) : null;
  const teamId = opts.teamId != null && opts.teamId !== '' ? String(opts.teamId) : null;
  const organizationId = opts.organizationId != null && opts.organizationId !== ''
    ? String(opts.organizationId)
    : null;

  let scope = opts.scope || opts.defaultScope || null;
  let scopeId = opts.scopeId || opts.defaultScopeId || null;

  // B: tenantId alone ⇒ tenant scope
  if (tenantId && !scope && !scopeId) {
    scope = 'tenant';
    scopeId = tenantId;
  } else if (tenantId && scope === 'tenant' && !scopeId) {
    scopeId = tenantId;
  } else if (tenantId && !scopeId && !scope) {
    scope = 'tenant';
    scopeId = tenantId;
  }

  // D: hierarchical chain (specific → broad)
  /** @type {ScopeRef[]} */
  const scopes = [];
  if (userId) scopes.push({ scope: 'user', scopeId: userId });
  if (teamId) scopes.push({ scope: 'team', scopeId: teamId });
  if (organizationId) scopes.push({ scope: 'organization', scopeId: organizationId });
  if (tenantId) scopes.push({ scope: 'tenant', scopeId: tenantId });

  if (!scopes.length && scope && scopeId) {
    scopes.push({ scope: String(scope), scopeId: String(scopeId) });
  }

  return {
    scopes,
    scope: scopes[0]?.scope || (scope ? String(scope) : null),
    scopeId: scopes[0]?.scopeId || (scopeId ? String(scopeId) : null),
    tenantId,
  };
}

/** Merge call opts over engine defaults without dropping hierarchy fields. */
export function mergeScopeOpts(callOpts = {}, engineDefaults = {}) {
  return resolveMemoryScope(callOpts, engineDefaults);
}
