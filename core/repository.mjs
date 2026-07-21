// KayrosLab — Persistance & portefeuille multi-idees.
// Abstraction `IdeaRepository` : InMemory (P0/tests) et File (node, mono-serveur).
// Une base SQL/Mongo se branche en implementant la meme interface.

import { STAGES, STATUSES } from './model.mjs';

/** Repository en memoire. Interface de reference. */
export class InMemoryIdeaRepository {
  constructor(seed = []) { this._m = new Map(seed.map((i) => [i.id, i])); }
  async save(idea) { this._m.set(idea.id, idea); return idea; }
  async get(id) { return this._m.get(id) ?? null; }
  async remove(id) { return this._m.delete(id); }
  async all() { return [...this._m.values()]; }
  async size() { return this._m.size; }

  /** Filtrage combinable (facettes) + recherche plein texte simple. */
  async list({ tenantId, stage, status, category, author, q, sort = 'updatedAt', order = 'desc' } = {}) {
    let out = [...this._m.values()];
    // Isolation multi-tenant : filtre applique EN PREMIER.
    if (tenantId) out = out.filter((i) => (i.tenantId ?? 'default') === tenantId);
    if (stage) out = out.filter((i) => i.stage === stage);
    if (status) out = out.filter((i) => i.status === status);
    if (category) out = out.filter((i) => i.category === category);
    if (author) out = out.filter((i) => i.author === author);
    if (q) {
      const needle = String(q).toLowerCase();
      out = out.filter((i) => `${i.title} ${JSON.stringify(i.intake ?? '')}`.toLowerCase().includes(needle));
    }
    out.sort((a, b) => (a[sort] > b[sort] ? 1 : a[sort] < b[sort] ? -1 : 0));
    if (order === 'desc') out.reverse();
    return out;
  }
}

/** Repository fichier JSON (node). Persistance simple mono-serveur. */
export class FileIdeaRepository extends InMemoryIdeaRepository {
  constructor({ path, fs } = {}) {
    super([]);
    if (!path) throw new Error('FileIdeaRepository: path requis');
    this.path = path; this._fs = fs; this._loaded = false;
  }
  async _mod() { return this._fs ?? (await import('node:fs/promises')); }
  async load() {
    const fs = await this._mod();
    try {
      const raw = await fs.readFile(this.path, 'utf8');
      const arr = JSON.parse(raw);
      this._m = new Map(arr.map((i) => [i.id, i]));
    } catch { this._m = new Map(); } // fichier absent = portefeuille vide
    this._loaded = true; return this;
  }
  async flush() {
    const fs = await this._mod();
    await fs.writeFile(this.path, JSON.stringify([...this._m.values()], null, 2), 'utf8');
    return true;
  }
  async save(idea) { await super.save(idea); await this.flush(); return idea; }
  async remove(id) { const ok = await super.remove(id); await this.flush(); return ok; }
}

/** Compteurs de charge (WIP) par etape et par statut. */
export async function counts(repo) {
  const all = await repo.all();
  const byStage = Object.fromEntries(STAGES.map((s) => [s, 0]));
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const i of all) {
    if (byStage[i.stage] !== undefined) byStage[i.stage]++;
    if (byStatus[i.status] !== undefined) byStatus[i.status]++;
  }
  return { total: all.length, byStage, byStatus };
}

/** Vue portefeuille facon kanban : colonnes = etapes, avec WIP. */
export async function portfolio(repo, filter = {}) {
  const items = await repo.list(filter);
  const columns = STAGES.map((stage) => {
    const ideas = items.filter((i) => i.stage === stage);
    return { stage, wip: ideas.length, ideas };
  });
  return { columns, total: items.length };
}
