// KayrosLab — Audit trail persistant (EF-32).
// Historisation des evenements de cycle / gates / actions utilisateur.
// Deux implémentations, meme interface : InMemory (P0/tests) et File (JSONL, mono-serveur).
// Le store File est utilise par context.mjs pour que `ctx.activites` survive aux redemarrages.

import { appendFile, readFile } from 'node:fs/promises';

export const AUDIT_RING_SIZE = 5000;

export class InMemoryAuditStore {
  constructor({ ring = AUDIT_RING_SIZE } = {}) {
    this.ring = Math.max(1, ring | 0);
    this.events = [];
  }
  async _fs() { return null; }
  async append(evt) {
    if (!evt || typeof evt !== 'object') return null;
    this.events.push(evt);
    if (this.events.length > this.ring) this.events.splice(0, this.events.length - this.ring);
    return evt;
  }
  async where({ ideaId, type, since, before, limit = this.ring } = {}) {
    let out = this.events;
    if (ideaId) out = out.filter((e) => e.ideaId === ideaId);
    if (type) out = out.filter((e) => e.type === type);
    if (since) { const t = new Date(since).getTime(); out = out.filter((e) => e.ts && new Date(e.ts).getTime() >= t); }
    if (before) { const t = new Date(before).getTime(); out = out.filter((e) => e.ts && new Date(e.ts).getTime() <= t); }
    return (limit && limit > 0) ? out.slice(-limit).reverse() : out.slice().reverse();
  }
  async list() { return [...this.events]; }
  async count() { return this.events.length; }
  async shutdown() { return true; }
}

export class FileAuditStore extends InMemoryAuditStore {
  constructor({ path, fs } = {}) {
    super();
    if (!path) throw new Error('FileAuditStore: path requis');
    this.path = path;
    this._fsOverride = fs;
  }
  async _mod() {
    if (this._fsOverride) return this._fsOverride;
    return await import('node:fs/promises');
  }
  async load() {
    const fs = await this._mod();
    try {
      const raw = await fs.readFile(this.path, 'utf8');
      const events = [];
      for (const line of raw.split('\n')) {
        if (line.trim()) {
          try { events.push(JSON.parse(line)); } catch {}
        }
      }
      // on ne recharge que les `ring` plus recent pour ne pas exploser la memoire
      if (events.length > this.ring) events.splice(0, events.length - this.ring);
      this.events = events;
    } catch { this.events = []; } // fichier absent = audit vide
    return this;
  }
  async append(evt) {
    await super.append(evt);
    const fs = await this._mod();
    try { await fs.appendFile(this.path, JSON.stringify(evt) + '\n', 'utf8'); }
    catch { /* best-effort : ne doit pas bloquer le cycle */ }
    return evt;
  }
  async shutdown() { return true; }
}

/** Construit le bon store selon l'environnement (mem par defaut). */
export function createAuditStore({ file, fs } = {}) {
  if (file) return new FileAuditStore({ path: file, fs });
  return new InMemoryAuditStore();
}

export async function hydrateAuditFromStore(activites, store, ring = AUDIT_RING_SIZE) {
  const events = await store.where({}, { limit: ring });
  for (const e of events) activites.push(e);
  return activites;
}
