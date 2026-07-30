// KayrosLab — Canvas : persistance des workspaces.
// EF-210 / EF-222. Meme interface et meme discipline que `core/repository.mjs` :
// InMemory (P0/tests) et Fichier (P1 mono-serveur). Une base SQL se branche en
// implementant la meme interface — c'est le point d'entree de la migration
// PostgreSQL identifiee comme chemin critique du lot v12 (CDC §5).

import { stats } from './model.mjs';

export class InMemoryCanvasRepository {
  constructor(seed = []) { this._m = new Map(seed.map((w) => [w.id, w])); }
  async save(ws) { this._m.set(ws.id, ws); return ws; }
  async get(id) { return this._m.get(id) ?? null; }
  async remove(id) { return this._m.delete(id); }
  async all() { return [...this._m.values()]; }
  async size() { return this._m.size; }

  /**
   * Filtrage. Le filtre tenant est applique EN PREMIER, comme dans
   * `InMemoryIdeaRepository` — l'isolation multi-tenant n'est pas une facette
   * parmi d'autres (coherence EF-48 / EF-206).
   */
  async list({ tenantId, createdBy, q, ideaId, sort = 'updatedAt', order = 'desc' } = {}) {
    let out = [...this._m.values()];
    if (tenantId) out = out.filter((w) => (w.tenantId ?? 'default') === tenantId);
    if (createdBy) out = out.filter((w) => w.createdBy === createdBy);
    if (ideaId) out = out.filter((w) => w.promotedIdeaIds.includes(ideaId));
    if (q) {
      const needle = String(q).toLowerCase();
      out = out.filter((w) => w.nom.toLowerCase().includes(needle)
        || w.nodes.some((n) => `${n.titre} ${n.corps}`.toLowerCase().includes(needle)));
    }
    out.sort((a, b) => (a[sort] > b[sort] ? 1 : a[sort] < b[sort] ? -1 : 0));
    if (order === 'desc') out.reverse();
    return out;
  }
}

/**
 * Persistance fichier JSON, ecriture atomique (ecriture temporaire + rename).
 * `core/repository.mjs` ecrit directement ; ici les workspaces sont nettement
 * plus volumineux, et une interruption en cours d'ecriture corromprait tout le
 * portefeuille de canvas. Le surcout d'un rename est negligeable.
 */
export class FileCanvasRepository extends InMemoryCanvasRepository {
  constructor({ path, fs } = {}) {
    super([]);
    if (!path) throw new Error('FileCanvasRepository: path requis');
    this.path = path; this._fs = fs;
  }
  async _mod() { return this._fs ?? (await import('node:fs/promises')); }
  async load() {
    const fs = await this._mod();
    try {
      const arr = JSON.parse(await fs.readFile(this.path, 'utf8'));
      this._m = new Map(arr.map((w) => [w.id, w]));
    } catch { this._m = new Map(); } // fichier absent = aucun canvas
    return this;
  }
  async flush() {
    const fs = await this._mod();
    const tmp = `${this.path}.tmp`;
    await fs.writeFile(tmp, JSON.stringify([...this._m.values()], null, 2), 'utf8');
    if (fs.rename) await fs.rename(tmp, this.path);
    return true;
  }
  async save(ws) { await super.save(ws); await this.flush(); return ws; }
  async remove(id) { const ok = await super.remove(id); await this.flush(); return ok; }
}

/**
 * Vue d'ensemble des canvas d'un tenant.
 * `tauxSourcage` remonte au niveau portefeuille : un atelier ou rien n'est
 * source produit des idees non etayees, et c'est visible ici avant l'arbitrage.
 */
export async function canvasPortfolio(repo, filter = {}) {
  const items = await repo.list(filter);
  return {
    total: items.length,
    workspaces: items.map((w) => ({
      id: w.id, nom: w.nom, tenantId: w.tenantId,
      updatedAt: w.updatedAt, promotedIdeaIds: w.promotedIdeaIds,
      ...stats(w),
    })),
  };
}
