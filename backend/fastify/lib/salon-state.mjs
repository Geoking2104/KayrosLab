/**
 * Mémoire des cercles du Salon, par utilisateur (Bearer).
 * Fichier JSON par compte sous KAYROS_SALON_DIR, sinon magasin en mémoire.
 */

const MAX_BYTES = 512 * 1024;
const MAX_ROOMS = 48;
const MAX_TURNS = 500;
const MAX_AUTHORS = 40;
const MAX_TEXT = 2000;

export function safeUserKey(id) {
  const raw = String(id || '');
  if (!raw || raw.includes('..') || raw.includes('/') || raw.includes('\\')) {
    const e = new Error('identifiant salon invalide');
    e.code = 'SALON_USER';
    throw e;
  }
  const s = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  if (!s || s === '.' || s.startsWith('.')) {
    const e = new Error('identifiant salon invalide');
    e.code = 'SALON_USER';
    throw e;
  }
  return s;
}

function str(v, max) {
  if (typeof v !== 'string') return '';
  return v.slice(0, max);
}

function arr(v, max) {
  return Array.isArray(v) ? v.slice(0, max) : [];
}

const ACTS = new Set(['adresse', 'reponse', 'objection']);
const METHODS = new Set(['auto', 'rhetorique', 'elenchus']);

function sanitizeTurn(turn) {
  if (!turn || typeof turn !== 'object') return null;
  return {
    id: str(turn.id, 64),
    authorId: str(turn.authorId, 64),
    text: str(turn.text, MAX_TEXT),
    origin: turn.origin === 'agent' ? 'agent' : 'user',
    grounded: Boolean(turn.grounded),
    act: ACTS.has(turn.act) ? turn.act : 'adresse',
    to: str(turn.to, 64),
    createdAt: str(turn.createdAt, 40),
    citations: arr(turn.citations, 4).map((c) => ({
      work: str(c?.work, 200),
      text: str(c?.text, 800),
    })).filter((c) => c.text),
  };
}

export function sanitizeSalonState(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const locale = src.locale === 'en' ? 'en' : 'fr';
  const rooms = arr(src.rooms, MAX_ROOMS).map((room) => {
    if (!room || typeof room !== 'object') return null;
    return {
      id: str(room.id, 64) || 'salon',
      name: str(room.name, 80) || 'Salon',
      question: str(room.question, 400),
      authorIds: arr(room.authorIds, 30).map((id) => str(id, 64)).filter(Boolean),
      turns: arr(room.turns, MAX_TURNS).map(sanitizeTurn).filter(Boolean),
    };
  }).filter(Boolean);

  const patches = {};
  if (src.patches && typeof src.patches === 'object') {
    for (const [key, value] of Object.entries(src.patches).slice(0, MAX_AUTHORS)) {
      if (!value || typeof value !== 'object') continue;
      const id = str(key, 64);
      if (!id) continue;
      patches[id] = {
        handle: value.handle != null ? str(value.handle, 24) : undefined,
        blurb: value.blurb != null ? str(value.blurb, 400) : undefined,
        method: METHODS.has(value.method) ? value.method : undefined,
        note: value.note != null ? str(value.note, 180) : undefined,
        workTitles: Array.isArray(value.workTitles)
          ? value.workTitles.slice(0, 12).map((title) => str(title, 200))
          : undefined,
      };
    }
  }

  const customs = arr(src.customs, 20).map((author) => {
    if (!author || typeof author !== 'object') return null;
    const id = str(author.id, 64);
    if (!id) return null;
    return {
      id,
      name: str(author.name, 80),
      nameEn: str(author.nameEn || author.name, 80),
      kind: str(author.kind, 24) || 'écrivain',
      blurb: str(author.blurb, 400),
      blurbEn: str(author.blurbEn || author.blurb, 400),
      era: str(author.era, 80),
      eraEn: str(author.eraEn || author.era, 80),
      avatar: str(author.avatar, 200),
      monogram: str(author.monogram, 8),
      method: str(author.method, 16) || 'auto',
      works: arr(author.works, 12),
    };
  }).filter(Boolean);

  const extras = arr(src.extras, MAX_TURNS).map((turn) => ({
    text: str(turn?.text, MAX_TEXT),
    createdAt: str(turn?.createdAt, 40),
    authorId: str(turn?.authorId || 'user', 64),
  })).filter((turn) => turn.text);

  const extraWorks = {};
  if (src.extraWorks && typeof src.extraWorks === 'object') {
    for (const [key, value] of Object.entries(src.extraWorks).slice(0, MAX_AUTHORS)) {
      extraWorks[str(key, 64)] = arr(value, 12).map((work) => ({
        title: str(work?.title, 200),
        url: str(work?.url, 400),
        source: str(work?.source, 40),
        ok: true,
      })).filter((work) => work.title);
    }
  }

  const extraPassages = {};
  if (src.extraPassages && typeof src.extraPassages === 'object') {
    for (const [key, value] of Object.entries(src.extraPassages).slice(0, MAX_AUTHORS)) {
      extraPassages[str(key, 64)] = arr(value, 80).map((passage) => ({
        id: str(passage?.id, 64),
        work: str(passage?.work, 200),
        text: str(passage?.text, 800),
        terms: arr(passage?.terms, 12).map((term) => str(term, 40)),
      })).filter((passage) => passage.text);
    }
  }

  const state = {
    version: 1,
    locale,
    rooms,
    patches,
    customs,
    extras,
    extraWorks,
    extraPassages,
    updatedAt: typeof src.updatedAt === 'string' ? str(src.updatedAt, 40) : new Date().toISOString(),
  };
  const json = JSON.stringify(state);
  if (json.length > MAX_BYTES) {
    const e = new Error('mémoire du salon trop volumineuse');
    e.code = 'SALON_TOO_LARGE';
    throw e;
  }
  return state;
}

export function emptySalonState() {
  return sanitizeSalonState({ locale: 'fr', rooms: [], patches: {}, customs: [], extras: [] });
}

export class SalonStateStore {
  constructor({ dir = null, fs = null } = {}) {
    this.dir = dir ? String(dir) : null;
    this._fs = fs;
    this._mem = new Map();
  }

  async _mod() {
    return this._fs ?? (await import('node:fs/promises'));
  }

  async get(userId) {
    const key = safeUserKey(userId);
    if (this._mem.has(key)) return this._mem.get(key);
    if (!this.dir) return null;
    const fs = await this._mod();
    try {
      const raw = JSON.parse(await fs.readFile(`${this.dir}/${key}.json`, 'utf8'));
      const state = sanitizeSalonState(raw);
      this._mem.set(key, state);
      return state;
    } catch {
      return null;
    }
  }

  async put(userId, raw) {
    const key = safeUserKey(userId);
    const state = sanitizeSalonState({
      ...raw,
      updatedAt: new Date().toISOString(),
    });
    this._mem.set(key, state);
    if (!this.dir) return state;
    const fs = await this._mod();
    await fs.mkdir(this.dir, { recursive: true }).catch(() => {});
    const path = `${this.dir}/${key}.json`;
    const tmp = `${path}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, path);
    try { await fs.chmod(path, 0o600); } catch { /* systèmes sans chmod */ }
    return state;
  }
}
