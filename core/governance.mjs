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

const uuid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const randomBytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(randomBytes) ?? randomBytes.forEach((_, i, arr) => { arr[i] = Math.floor(Math.random() * 256); });
  return `gate_${Date.now()}_${Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
};

/** Service de gouvernance en mémoire : file d'attente de gates + résolution promise-based. */
export class GovernanceService {
  /**
   * @param {{notifier?:(evt:object)=>any, evaluation?:object}} [opts]
   * `notifier` est appele a l'ouverture d'un gate : sans lui, un censeur ne sait pas
   * qu'on l'attend et la gouvernance reste theorique (blocage en production).
   */
  constructor({ notifier = null, store = null } = {}) {
    this._pending = new Map(); this._resolvers = new Map(); this._notifier = notifier;
    this._notifications = []; this._store = store;
  }

  /** Journal des notifications emises (utile en test et pour l'audit). */
  notifications() { return [...this._notifications]; }

  /** Ecriture best-effort : la persistance ne doit jamais bloquer l'arbitrage. */
  _persist(fn) {
    if (!this._store) return;
    try { Promise.resolve(fn(this._store)).catch(() => {}); } catch { /* non bloquant */ }
  }

  /**
   * Restaure la file d'attente depuis le magasin (au demarrage).
   * Les gates restaures n'ont plus de promesse associee : l'appelant qui attendait
   * a disparu avec le process. Ils restent resolvables, et la decision est tracee.
   */
  async restore() {
    if (!this._store) return this;
    await this._store.load();
    for (const rec of await this._store.allPending()) this._pending.set(rec.gateId, rec);
    return this;
  }

  /** Historique persistant des resolutions (audit). */
  async history() { return this._store ? this._store.allHistory() : []; }

  /** Ouvre un gate. @returns {{gateId:string, promise:Promise<object>}} */
  open(req) {
    const gateId = uuid();
    const record = { gateId, createdAt: new Date().toISOString(), ...req };
    const promise = new Promise((resolve) => this._resolvers.set(gateId, resolve));
    this._pending.set(gateId, record);
    this._persist((s) => s.putPending(record));   // la file survit au redemarrage
    // EF : notifier l'ouverture (le censeur doit savoir qu'on l'attend).
    const evt = {
      type: 'gate_opened', gateId, gateType: record.type, ideaId: record.ideaId ?? null,
      requiredRole: record.requiredRole ?? null, evaluation: record.evaluation ?? null,
      createdAt: record.createdAt,
    };
    this._notifications.push(evt);
    // Le notifier peut etre asynchrone : on neutralise aussi les rejets de promesse,
    // sinon un canal en panne provoquerait un unhandledRejection.
    try { Promise.resolve(this._notifier?.(evt)).catch(() => {}); } catch { /* notif non bloquante */ }
    return { gateId, promise };
  }

  list() { return [...this._pending.values()]; }

  /** Résout un gate (validation humaine). Motif obligatoire si reject/revise. */
  resolve(gateId, { decision, by, role, reason = '' }) {
    const req = this._pending.get(gateId);
    if (!req) throw new Error(`Gate inconnu: ${gateId}`);
    if (!canResolve(role, req.type)) throw new Error(`Rôle "${role}" non habilité pour ${req.type}`);
    if ((decision === 'reject' || decision === 'revise') && !reason) throw new Error('Motif obligatoire pour reject/revise (EF-20)');
    const resolution = { gateId, decision, by, role, reason, resolvedAt: new Date().toISOString(), ideaId: req.ideaId ?? null, type: req.type };
    // `?.` : un gate RESTAURE apres redemarrage n'a plus de resolveur — c'est normal,
    // la decision est tout de meme enregistree et tracee.
    this._resolvers.get(gateId)?.(resolution);
    this._pending.delete(gateId);
    this._resolvers.delete(gateId);
    this._persist(async (s) => { await s.removePending(gateId); await s.appendHistory(resolution); });
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

/**
 * Magasin de gates. Les PROMESSES ne sont pas persistables : on conserve donc les
 * ENREGISTREMENTS (file d'attente + historique des resolutions). Apres redemarrage,
 * la file du censeur est restauree ; seul l'appelant qui attendait la promesse a disparu.
 */
export class InMemoryGateStore {
  constructor() { this.pending = new Map(); this.history = []; }
  async load() { return this; }
  async putPending(rec) { this.pending.set(rec.gateId, rec); }
  async removePending(gateId) { this.pending.delete(gateId); }
  async appendHistory(res) { this.history.push(res); }
  async allPending() { return [...this.pending.values()]; }
  async allHistory() { return [...this.history]; }
}

/** Magasin fichier (JSON) : ecriture atomique, comme les autres depots. */
export class FileGateStore extends InMemoryGateStore {
  constructor({ path, fs } = {}) {
    super();
    if (!path) throw new Error('FileGateStore: path requis');
    this.path = path; this._fs = fs;
  }
  async _mod() { return this._fs ?? (await import('node:fs/promises')); }
  async load() {
    const fs = await this._mod();
    try {
      const d = JSON.parse(await fs.readFile(this.path, 'utf8'));
      this.pending = new Map((d.pending ?? []).map((r) => [r.gateId, r]));
      this.history = d.history ?? [];
    } catch { /* fichier absent = file vide */ }
    return this;
  }
  async flush() {
    const fs = await this._mod();
    const tmp = `${this.path}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ pending: [...this.pending.values()], history: this.history }, null, 2), 'utf8');
    await fs.rename(tmp, this.path);
    return true;
  }
  async putPending(rec) { await super.putPending(rec); await this.flush(); }
  async removePending(id) { await super.removePending(id); await this.flush(); }
  async appendHistory(res) { await super.appendHistory(res); await this.flush(); }
}
