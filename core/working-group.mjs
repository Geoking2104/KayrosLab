// KayrosLab — Groupe de travail collaboratif (EF-13 / EF-21).
// Calque de membres + quorum autour de l'agregation de votes `aggregateVotes`.
// Le resultat est un CONSEIL (Go/No-Go/Révision) : la decision finale reste
// un veto/resolution formelle via GovernanceService (RBAC). Zero-dep externe.

import { aggregateVotes, ROLE_WEIGHTS, SEUILS } from './evaluation.mjs';

export const DEFAULT_QUORUM = 0.5; // 50% des membres requis
export { ROLE_WEIGHTS, SEUILS };

export const WG_STATUS = Object.freeze({
  VIDE: 'vide',            // aucun vote encore
  EN_ATTENTE: 'en_attente', // votes en cours, quorum pas atteint
  QUORUM_OK: 'quorum_ok',  // quorum atteint, recommandation possible
});

export function normalizeMember(m) {
  return { email: String(m.email ?? '').toLowerCase(), role: m.role ?? 'contributeur' };
}

export function createWorkingGroup({ ideaId, members = [], stage = null, quorum = DEFAULT_QUORUM } = {}) {
  if (!ideaId) throw new Error('WorkingGroup: ideaId requis');
  const norm = Array.isArray(members) ? members.map(normalizeMember) : [];
  const seen = new Set();
  const uniq = [];
  for (const m of norm) {
    const key = m.email;
    if (key && !seen.has(key)) { seen.add(key); uniq.push(m); }
  }
  const q = Math.max(0, Math.min(1, Number(quorum) || DEFAULT_QUORUM));
  return { ideaId, stage, quorum: q, members: uniq };
}

export function isMember(email, wg) {
  const e = String(email ?? '').toLowerCase();
  return !!wg?.members?.some((m) => m.email === e);
}

export function participations(wg, votes = []) {
  const voters = new Set(votes.map((v) => String(v.by ?? v.email ?? '').toLowerCase()));
  const participants = wg.members.filter((m) => voters.has(m.email));
  return { participants, participation: wg.members.length ? participants.length / wg.members.length : 0 };
}

export function wgAggregateVotes(wg, votes = [], { roleWeights = ROLE_WEIGHTS, seuils = SEUILS } = {}) {
  const normVotes = (votes ?? []).map((v) => ({ by: v.by ?? v.email, role: v.role ?? 'contributeur', score: v.score, comment: v.comment }));
  const { participants, participation } = participations(wg, normVotes);
  const eligible = wg.members.length;
  const quorum = participation >= wg.quorum;
  const memberVotes = normVotes.filter((v) => isMember(v.by, wg));
  const agregat = aggregateVotes(memberVotes, { roleWeights, seuils });

  let status = WG_STATUS.VIDE;
  if (participants.length === 0) status = WG_STATUS.VIDE;
  else if (!quorum) status = WG_STATUS.EN_ATTENTE;
  else status = WG_STATUS.QUORUM_OK;

  const recommandation =
    status === WG_STATUS.VIDE ? 'insuffisant'
    : status === WG_STATUS.EN_ATTENTE ? 'Attendre quorum'
    : agregat.recommandation;

  return {
    ...agregat,
    eligible, participants: participants.length, participation: Math.round(participation * 1000) / 1000,
    quorum, status, recommandation,
    memberVotes: memberVotes.length,
  };
}

export function wgDecision(agregat, { abstention = true } = {}) {
  if (!agregat.quorum) return abstention ? 'Attendre quorum' : 'No-Go';
  if (agregat.moyennePonderee >= (SEUILS.go ?? 70)) return 'Go';
  if (agregat.moyennePonderee >= (SEUILS.revision ?? 45)) return 'Révision';
  return 'No-Go';
}

export class WorkingGroupStore {
  constructor({ quorum = DEFAULT_QUORUM } = {}) {
    this.quorum = quorum;
    this.groups = new Map();   // ideaId -> wg
    this.votes = new Map();    // ideaId -> vote[]
  }
  async load() { return this; }
  addGroup(wg) { this.groups.set(wg.ideaId, wg); if (!this.votes.has(wg.ideaId)) this.votes.set(wg.ideaId, []); return wg; }
  get(ideaId) { return this.groups.get(ideaId) ?? null; }
  getVotes(ideaId) { return [...(this.votes.get(ideaId) ?? [])]; }
  has(ideaId) { return this.groups.has(ideaId); }
  addVote(ideaId, { by, role = 'contributeur', score, comment } = {}) {
    const wg = this.groups.get(ideaId);
    if (!wg) return null;
    // Seuls les membres du groupe de travail peuvent voter.
    if (!isMember(by, wg)) return null;
    const list = this.votes.get(ideaId) ?? [];
    const idx = list.findIndex((v) => String(v.by ?? v.email).toLowerCase() === String(by ?? '').toLowerCase());
    const v = { by, role, score: Math.max(0, Math.min(100, score)), comment, ts: new Date().toISOString() };
    if (idx >= 0) list[idx] = v;
    else list.push(v);
    return v;
  }
  aggregate(ideaId, { roleWeights, seuils } = {}) {
    const wg = this.get(ideaId);
    if (!wg) return null;
    return wgAggregateVotes(wg, this.getVotes(ideaId), { roleWeights, seuils });
  }
  list() { return [...this.groups.values()]; }
  async shutdown() { return true; }
}

export class FileWorkingGroupStore extends WorkingGroupStore {
  constructor({ path, fs, quorum = DEFAULT_QUORUM } = {}) {
    super({ quorum });
    if (!path) throw new Error('FileWorkingGroupStore: path requis');
    this.path = path; this._fsOverride = fs;
  }
  async _mod() { return this._fsOverride ?? (await import('node:fs/promises')); }
  async load() {
    const fs = await this._mod();
    try {
      const raw = await fs.readFile(this.path, 'utf8');
      const data = JSON.parse(raw);
      for (const g of data.groups ?? []) this.groups.set(g.ideaId, g);
      for (const v of Object.entries(data.votes ?? {})) this.votes.set(v[0], v[1]);
    } catch { /* absent = vide */ }
    return this;
  }
  async _flush(fs) {
    const data = { groups: [...this.groups.values()], votes: Object.fromEntries([...this.votes.entries()]) };
    try { await fs.writeFile(this.path, JSON.stringify(data, null, 2), 'utf8'); } catch {}
  }
  async addGroup(wg) {
    const out = super.addGroup(wg);
    const fs = await this._mod();
    await this._flush(fs);
    return out;
  }
  async addVote(ideaId, vote) {
    const v = super.addVote(ideaId, vote);
    if (v) { const fs = await this._mod(); await this._flush(fs); }
    return v;
  }
}

export function createWorkingGroupStore({ file } = {}) {
  if (file) return new FileWorkingGroupStore({ path: file });
  return new WorkingGroupStore();
}
