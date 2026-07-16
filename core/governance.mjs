// KayrosLab — Gouvernance & censeurs humains (gates, RBAC, veto).
// Réf. specs techniques §8 (EF-19/20/21, EF-34/36/37/38). Défaut = 'supervise' ; 'strict' non par défaut.

export const GateType = Object.freeze({
  EXPERT_REVIEW: 'expert_review',
  RED_TEAM_VETO: 'red_team_veto',
  COMEX_ARBITRAGE: 'comex_arbitrage',
  OUTPUT_CENSOR: 'output_censor',
});

/** RBAC : rôles humains -> gates autorisés + droit de veto. */
export const HUMAN_ROLES = Object.freeze({
  expert_metier: { gates: [GateType.EXPERT_REVIEW], veto: 'conditional' },
  red_team: { gates: [GateType.RED_TEAM_VETO], veto: true },
  comex: { gates: [GateType.COMEX_ARBITRAGE, GateType.OUTPUT_CENSOR], veto: true },
  facilitateur: { gates: [], veto: false },
});

export function canResolve(role, gateType) {
  const r = HUMAN_ROLES[role];
  return !!r && r.gates.includes(gateType);
}

const uuid = () => (globalThis.crypto?.randomUUID?.() ?? `gate_${Date.now()}_${Math.random().toString(36).slice(2)}`);

/** Service de gouvernance en mémoire : file d'attente de gates + résolution promise-based. */
export class GovernanceService {
  constructor() { this._pending = new Map(); this._resolvers = new Map(); }

  /** Ouvre un gate. @returns {{gateId:string, promise:Promise<object>}} */
  open(req) {
    const gateId = uuid();
    const record = { gateId, createdAt: new Date().toISOString(), ...req };
    const promise = new Promise((resolve) => this._resolvers.set(gateId, resolve));
    this._pending.set(gateId, record);
    return { gateId, promise };
  }

  list() { return [...this._pending.values()]; }

  /** Résout un gate (validation humaine). Motif obligatoire si reject/revise. */
  resolve(gateId, { decision, by, role, reason = '' }) {
    const req = this._pending.get(gateId);
    if (!req) throw new Error(`Gate inconnu: ${gateId}`);
    if (!canResolve(role, req.type)) throw new Error(`Rôle "${role}" non habilité pour ${req.type}`);
    if ((decision === 'reject' || decision === 'revise') && !reason) throw new Error('Motif obligatoire pour reject/revise (EF-20)');
    const resolution = { gateId, decision, by, role, reason, resolvedAt: new Date().toISOString() };
    this._resolvers.get(gateId)?.(resolution);
    this._pending.delete(gateId);
    this._resolvers.delete(gateId);
    return resolution;
  }
}

/** Règles statiques de repli (si classifieur LLM indisponible). */
export function staticSensitiveRules(text = '') {
  const t = text.toLowerCase();
  if (/\b(régulat|reglement|conformité|compliance|rgpd|legal)\b/.test(t)) return { label: 'reglementaire', confidence: 0.6 };
  if (/\b(go\/no-go|go no go|décision|arbitrage|investir)\b/.test(t)) return { label: 'decision_go_nogo', confidence: 0.6 };
  if (/\b(publier|diffuser|externe|presse|client)\b/.test(t)) return { label: 'diffusion_externe', confidence: 0.55 };
  return { label: 'neutre', confidence: 0.5 };
}

/**
 * Classifie une sortie comme sensible ou non — via classifieur LLM (décision actée), repli règles statiques.
 * @param {string} text
 * @param {{classifier?:(t:string)=>Promise<{label:string,confidence:number}>, threshold?:number}} [opts]
 * @returns {Promise<{label:string, confidence:number, sensitive:boolean}>}
 */
export async function classifySensitive(text, { classifier, threshold = 0.5 } = {}) {
  let res;
  if (classifier) { try { res = await classifier(text); } catch { res = null; } }
  if (!res) res = staticSensitiveRules(text);
  const sensitive = res.label !== 'neutre' && (res.confidence ?? 1) >= threshold;
  return { ...res, sensitive };
}

/**
 * Politique de gate selon le niveau de gouvernance.
 * 'auto' -> jamais ; 'supervise' (défaut) -> si sensible ; 'strict' -> toujours.
 * @returns {string|null} GateType ou null
 */
export function policyFor(output, level = 'supervise') {
  if (level === 'auto') return null;
  if (level === 'strict') return GateType.OUTPUT_CENSOR;
  return output?.sensitive ? GateType.OUTPUT_CENSOR : null; // supervise
}
