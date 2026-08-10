// KayrosLab — Jalons de gouvernance futurs (EF-45) : gates COMEX dates.
// Planifies dans la roadmap, ils deviennent dus a leur date et peuvent etre
// materialises en vrais gates gouvernance (GovernanceService.open).

const nowIso = () => new Date().toISOString();

/** Normalise un gate futur : id, date ISO validee, type/role par defaut. */
export function normalizeFuturGate(g, { index = 0 } = {}) {
  if (!g || typeof g !== 'object') throw new Error('gate futur : objet requis');
  if (!g.libelle) throw new Error('gate futur : libelle requis');
  if (!g.date) throw new Error('gate futur : date requise');
  const d = new Date(g.date);
  if (Number.isNaN(d.getTime())) throw new Error(`gate futur : date invalide "${g.date}"`);
  return {
    id: g.id ?? `gf${index + 1}`,
    libelle: g.libelle,
    date: d.toISOString(),
    type: g.type ?? 'comex_arbitrage',
    requiredRole: g.requiredRole ?? 'comex',
    questions: Array.isArray(g.questions) ? g.questions : [],
    statut: 'planifie',
    materialise: g.materialise ?? null,
    createdAt: g.createdAt ?? nowIso(),
  };
}

/** Remplace la liste des gates futurs de la roadmap (maintenance). */
export function setGatesFuturs(roadmap = {}, gates = []) {
  const gatesFuturs = gates.map((g, i) => normalizeFuturGate(g, { index: i }));
  return { ...roadmap, gatesFuturs, gatesFutursCount: gatesFuturs.length };
}

/**
 * Statut de chaque gate futur : du / en retard / materialise.
 * @param {Object[]} gates
 * @param {{now?:()=>Date}} [opts]
 */
export function gatesFutursStatus(gates = [], { now = () => new Date() } = {}) {
  const t = now();
  const items = gates.map((g) => {
    const du = new Date(g.date).getTime() <= t.getTime();
    return { ...g, du, enRetard: du && !g.materialise };
  });
  return {
    items,
    aVenir: items.filter((x) => !x.du && !x.materialise).length,
    dus: items.filter((x) => x.du && !x.materialise).length,
    materialises: items.filter((x) => x.materialise).length,
  };
}

/** Gates dus (date passee) et non encore materialises. */
export function dueGates(gates = [], { now = () => new Date() } = {}) {
  const t = now();
  return gates.filter((g) => new Date(g.date).getTime() <= t.getTime() && !g.materialise);
}

/** Marque un gate comme materialise (lie au vrai gate cree). */
export function materialiserGate(gate, { gateId, ts = null } = {}) {
  if (!gateId) throw new Error('materialiserGate: gateId requis');
  return { ...gate, statut: 'materialise', materialise: { gateId, ts: ts ?? nowIso() } };
}
