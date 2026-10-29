// Objets d'espace de travail de la console : sociétés, projets, skills et
// sources de contexte. Stockage par tenant, en mémoire ou dans un fichier JSON
// (écriture atomique). KAYROS_WORKSPACE_FILE=memory désactive la persistance.
import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';

export const WORKSPACE_KINDS = ['companies', 'projects', 'skills', 'contexts', 'members', 'notifications'];
const PREFIX = { companies: 'co', projects: 'prj', skills: 'skl', contexts: 'ctx', members: 'mbr', notifications: 'ntf' };

export class WorkspaceStore {
  constructor({ file = 'memory' } = {}) {
    this.file = file && file !== 'memory' ? file : null;
    this.data = null;
    this.chain = Promise.resolve();
  }
  async _load() {
    if (this.data) return this.data;
    this.data = {};
    if (this.file) {
      try { this.data = JSON.parse(await fs.readFile(this.file, 'utf8')) || {}; } catch { this.data = {}; }
    }
    return this.data;
  }
  async _save() {
    if (!this.file) return;
    const snapshot = JSON.stringify(this.data);
    this.chain = this.chain.then(async () => {
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, snapshot, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(tmp, this.file);
    }).catch(() => {});
    await this.chain;
  }
  async _bucket(tenantId, kind) {
    if (!WORKSPACE_KINDS.includes(kind)) throw new Error(`type inconnu: ${kind}`);
    const data = await this._load();
    const t = (data[tenantId || 'default'] ||= {});
    return (t[kind] ||= []);
  }
  async list(tenantId, kind, filter = {}) {
    const items = await this._bucket(tenantId, kind);
    return items.filter((item) => Object.entries(filter).every(([k, v]) => v == null || item[k] === v)).map((i) => structuredClone(i));
  }
  async get(tenantId, kind, id) {
    const items = await this._bucket(tenantId, kind);
    const found = items.find((item) => item.id === id);
    return found ? structuredClone(found) : null;
  }
  async create(tenantId, kind, fields, { by = null } = {}) {
    const items = await this._bucket(tenantId, kind);
    const at = new Date().toISOString();
    const item = { ...fields, id: `${PREFIX[kind]}_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`, created_by: by, created_at: at, updated_at: at };
    items.push(item);
    await this._save();
    return structuredClone(item);
  }
  async update(tenantId, kind, id, patch) {
    const items = await this._bucket(tenantId, kind);
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return null;
    items[index] = { ...items[index], ...patch, id, updated_at: new Date().toISOString() };
    await this._save();
    return structuredClone(items[index]);
  }
  async remove(tenantId, kind, id) {
    const items = await this._bucket(tenantId, kind);
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    items.splice(index, 1);
    await this._save();
    return true;
  }
}
