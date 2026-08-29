// KayrosLab — Authentification (cote SERVEUR).
// Primitives : scrypt (mots de passe) + HMAC-SHA256 (jetons), via node:crypto.
// `node:crypto` est importe DYNAMIQUEMENT pour que l'import de ce module ne casse
// pas un bundle navigateur (le cœur est aussi consomme cote client).
//
// Regles tenues ici :
//   - aucun mot de passe stocke en clair (scrypt + sel aleatoire par utilisateur)
//   - comparaisons en TEMPS CONSTANT (timingSafeEqual) : pas de fuite par timing
//   - le secret de signature vient de l'appelant (env), jamais code en dur
//   - les erreurs de login ne disent pas si c'est l'email ou le mot de passe

const nodeCrypto = () => import('node:crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

/** Parametres scrypt (couts par defaut raisonnables pour un login interactif). */
export const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 64, saltLen: 16 };

/** Hache un mot de passe. Format : `scrypt$N$r$p$sel$empreinte`. */
export async function hashPassword(password, params = {}) {
  if (typeof password !== 'string' || password.length < 10) {
    throw new Error('hashPassword: mot de passe trop court (10 caracteres minimum)');
  }
  const c = await nodeCrypto();
  const { N, r, p, keyLen, saltLen } = { ...SCRYPT, ...params };
  const salt = c.randomBytes(saltLen);
  const key = await new Promise((res, rej) =>
    c.scrypt(password, salt, keyLen, { N, r, p }, (e, k) => (e ? rej(e) : res(k))));
  return `scrypt$${N}$${r}$${p}$${b64u(salt)}$${b64u(key)}`;
}

/** Verifie un mot de passe contre une empreinte stockee. Temps constant. */
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 128 || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const c = await nodeCrypto();
  const salt = unb64u(saltB64), expected = unb64u(keyB64);
  try {
    const key = await new Promise((res, rej) =>
      c.scrypt(password, salt, expected.length, { N: Number(N), r: Number(r), p: Number(p) },
        (e, k) => (e ? rej(e) : res(k))));
    return key.length === expected.length && c.timingSafeEqual(key, expected);
  } catch { return false; }
}

/** Signature HMAC-SHA256 (base64url). */
async function sign(data, secret) {
  const c = await nodeCrypto();
  return b64u(c.createHmac('sha256', secret).update(data).digest());
}

/**
 * Emet un jeton compact signe : `payloadB64u.signatureB64u`.
 * @param {object} payload  claims metier (sub, role, tenantId...)
 * @param {string} secret   secret de signature (env, jamais code en dur)
 */
export async function issueToken(payload, secret, { ttlSec = 3600 } = {}) {
  if (!secret) throw new Error('issueToken: secret requis');
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSec };
  const data = b64u(JSON.stringify(body));
  return `${data}.${await sign(data, secret)}`;
}

/** Verifie un jeton : signature (temps constant) puis expiration. */
export async function verifyToken(token, secret, { now = () => Math.floor(Date.now() / 1000) } = {}) {
  if (!secret) throw new Error('verifyToken: secret requis');
  if (typeof token !== 'string' || !token.includes('.')) return { valid: false, reason: 'format' };
  const [data, sig] = token.split('.');
  const expected = await sign(data, secret);
  const c = await nodeCrypto();
  const a = Buffer.from(sig ?? '', 'utf8'), b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !c.timingSafeEqual(a, b)) return { valid: false, reason: 'signature' };
  let payload;
  try { payload = JSON.parse(unb64u(data).toString('utf8')); } catch { return { valid: false, reason: 'payload' }; }
  if (typeof payload.exp === 'number' && now() >= payload.exp) return { valid: false, reason: 'expire' };
  return { valid: true, payload };
}

/** Roles applicatifs (alignes sur la gouvernance : censeurs + contributeurs). */
export const ROLES = ['comex', 'expert', 'redteam', 'facilitateur', 'contributeur'];

/** Magasin d'utilisateurs en memoire. Meme interface qu'un magasin SQL. */
export class InMemoryUserStore {
  constructor(seed = []) { this._byId = new Map(); this._byEmail = new Map(); seed.forEach((u) => this._put(u)); }
  _put(u) { this._byId.set(u.id, u); this._byEmail.set(String(u.email).toLowerCase(), u); return u; }
  async create(user) {
    if (this._byEmail.has(String(user.email).toLowerCase())) throw new Error('utilisateur deja existant');
    return this._put(user);
  }
  async findByEmail(email) { return this._byEmail.get(String(email).toLowerCase()) ?? null; }
  async findById(id) { return this._byId.get(id) ?? null; }
  async update(id, patch = {}) {
    const current = await this.findById(id);
    if (!current) throw new Error('utilisateur introuvable');
    const previousEmail = String(current.email).toLowerCase();
    const next = {
      ...current,
      ...patch,
      id: current.id,
      email: String(patch.email ?? current.email).toLowerCase(),
    };
    if (next.email !== previousEmail) this._byEmail.delete(previousEmail);
    return this._put(next);
  }
  async list({ tenantId } = {}) {
    const all = [...this._byId.values()];
    return tenantId ? all.filter((u) => u.tenantId === tenantId) : all;
  }
}

/** Vue publique d'un utilisateur : JAMAIS l'empreinte du mot de passe. */
export const publicUser = (u) => (u ? { id: u.id, email: u.email, name: u.name, role: u.role, tenantId: u.tenantId } : null);

/** Service d'authentification : inscription, connexion, verification, RBAC. */
export class AuthService {
  constructor({ users = new InMemoryUserStore(), secret, ttlSec = 3600, sessions = null, throttle = null } = {}) {
    if (!secret) throw new Error('AuthService: secret requis (variable d environnement)');
    this.users = users; this.secret = secret; this.ttlSec = ttlSec;
    this.sessions = sessions ?? new SessionStore();
    this.throttle = throttle ?? new LoginThrottle();
  }

  async register({ email, password, name = null, role = 'contributeur', tenantId = 'default' }) {
    if (!email || !String(email).includes('@')) throw new Error('email invalide');
    if (!ROLES.includes(role)) throw new Error(`role invalide: ${role}`);
    const passwordHash = await hashPassword(password);
    const id = globalThis.crypto?.randomUUID?.() ?? `u_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const user = await this.users.create({ id, email: String(email).toLowerCase(), name, role, tenantId, passwordHash, sessionVersion: 0, createdAt: new Date().toISOString() });
    return publicUser(user);
  }

  /**
   * Connexion. Message d'erreur VOLONTAIREMENT identique pour email inconnu et
   * mot de passe faux : ne pas reveler quels comptes existent (enumeration).
   */
  async login({ email, password, throttleKey = null }) {
    const key = throttleKey ?? String(email ?? '').toLowerCase();
    this.throttle.check(key);                       // leve si verrouille
    const user = await this.users.findByEmail(email ?? '');
    const ok = user ? await verifyPassword(password ?? '', user.passwordHash) : false;
    if (!ok) {
      this.throttle.fail(key);
      const e = new Error('identifiants invalides'); e.code = 'AUTH_INVALID'; throw e;
    }
    this.throttle.reset(key);
    const jti = globalThis.crypto?.randomUUID?.() ?? `j_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const token = await issueToken(
      { sub: user.id, email: user.email, role: user.role, tenantId: user.tenantId, jti, sessionVersion: Number(user.sessionVersion || 0) },
      this.secret, { ttlSec: this.ttlSec },
    );
    return { token, user: publicUser(user) };
  }

  /** Verifie un jeton : signature, expiration, revocation unitaire et globale. */
  async verify(token) {
    const r = await verifyToken(token, this.secret);
    if (!r.valid) { const e = new Error(`jeton invalide (${r.reason})`); e.code = 'AUTH_TOKEN'; throw e; }
    const p = r.payload;
    if (p.purpose) { const e = new Error('jeton invalide'); e.code = 'AUTH_TOKEN'; throw e; }
    if (this.sessions.isRevoked(p.jti)) { const e = new Error('jeton revoque'); e.code = 'AUTH_REVOKED'; throw e; }
    if (this.sessions.isBeforeCutoff(p.sub, p.iat)) { const e = new Error('session invalidee'); e.code = 'AUTH_REVOKED'; throw e; }
    const user = await this.users.findById(p.sub);
    if (!user || Number(user.sessionVersion || 0) !== Number(p.sessionVersion || 0)) {
      const e = new Error('session invalidee'); e.code = 'AUTH_REVOKED'; throw e;
    }
    return p;
  }

  /** Cree un jeton de verification d'adresse, sans reveler si le compte existe. */
  async createPasswordReset({ email, ttlSec = 1800 } = {}) {
    const user = await this.users.findByEmail(email ?? '');
    const subject = user ?? { id: 'unknown', email: String(email || '').toLowerCase(), passwordHash: 'unknown' };
    const passwordMarker = await sign(`password:${subject.id}:${subject.passwordHash}`, this.secret);
    const token = await issueToken({
      sub: subject.id,
      email: subject.email,
      purpose: 'password_reset',
      passwordMarker,
    }, this.secret, { ttlSec });
    if (!user) return null;
    return { token, user: publicUser(user) };
  }

  /** Consomme le lien verifie, change le mot de passe et invalide les sessions. */
  async resetPassword({ token, password } = {}) {
    const checked = await verifyToken(token, this.secret);
    const invalid = () => { const e = new Error('lien de réinitialisation invalide ou expiré'); e.code = 'AUTH_RESET_INVALID'; return e; };
    if (!checked.valid || checked.payload?.purpose !== 'password_reset') throw invalid();
    const user = await this.users.findById(checked.payload.sub);
    if (!user || user.email !== checked.payload.email) throw invalid();
    const expectedMarker = await sign(`password:${user.id}:${user.passwordHash}`, this.secret);
    if (expectedMarker !== checked.payload.passwordMarker) throw invalid();
    const passwordHash = await hashPassword(password);
    await this.users.update(user.id, {
      passwordHash,
      sessionVersion: Number(user.sessionVersion || 0) + 1,
      passwordChangedAt: new Date().toISOString(),
    });
    this.revokeAllSessions(user.id);
    return true;
  }

  /** Deconnexion : revoque ce jeton precis. */
  async logout(token) {
    const r = await verifyToken(token, this.secret);
    if (r.valid) this.sessions.revoke(r.payload.jti);
    return true;
  }

  /** Invalide toutes les sessions d'un utilisateur (changement de mot de passe, compromission). */
  revokeAllSessions(userId) { this.sessions.revokeAllForUser(userId); return true; }

  /** Garde RBAC : le porteur possede-t-il l'un des roles requis ? */
  hasRole(payload, roles = []) {
    const list = Array.isArray(roles) ? roles : [roles];
    return !!payload && list.includes(payload.role);
  }

  /** Garde stricte : leve si le role n'est pas habilite. */
  requireRole(payload, roles = []) {
    if (!this.hasRole(payload, roles)) {
      const e = new Error(`role "${payload?.role ?? 'anonyme'}" non habilite`); e.code = 'AUTH_FORBIDDEN'; throw e;
    }
    return true;
  }

  /** Isolation multi-tenant : l'appelant peut-il acceder a cette ressource ? */
  sameTenant(payload, resource) {
    if (!payload?.tenantId) return false;
    const rt = resource?.tenantId ?? 'default';
    return payload.tenantId === rt;
  }
}

/**
 * Limitation des tentatives de connexion (anti-bruteforce en ligne).
 * scrypt ralentit le bruteforce hors-ligne ; ceci freine le bruteforce en ligne.
 * Horloge injectable pour des tests deterministes.
 */
export class LoginThrottle {
  constructor({ maxAttempts = 5, windowMs = 15 * 60 * 1000, now = () => Date.now() } = {}) {
    this.maxAttempts = maxAttempts; this.windowMs = windowMs; this.now = now; this._m = new Map();
  }
  _entry(key) {
    const e = this._m.get(key);
    if (!e || this.now() - e.first > this.windowMs) { const n = { count: 0, first: this.now() }; this._m.set(key, n); return n; }
    return e;
  }
  /** Leve si la cle est verrouillee. */
  check(key) {
    const e = this._entry(key);
    if (e.count >= this.maxAttempts) {
      const reste = Math.max(0, this.windowMs - (this.now() - e.first));
      const err = new Error(`trop de tentatives, reessayez dans ${Math.ceil(reste / 1000)}s`);
      err.code = 'AUTH_THROTTLED'; err.retryAfterMs = reste; throw err;
    }
    return true;
  }
  fail(key) { const e = this._entry(key); e.count++; return e.count; }
  reset(key) { this._m.delete(key); }
}

/** Denylist de jetons revoques (jti) + revocation globale par utilisateur. */
export class SessionStore {
  constructor() { this._revoked = new Set(); this._notBefore = new Map(); }
  revoke(jti) { if (jti) this._revoked.add(jti); return this; }
  isRevoked(jti) { return this._revoked.has(jti); }
  /** Invalide TOUS les jetons d'un utilisateur emis avant maintenant (ex. changement de mot de passe). */
  revokeAllForUser(userId, at = Math.floor(Date.now() / 1000)) { this._notBefore.set(userId, at); return this; }
  isBeforeCutoff(userId, iat) {
    const nb = this._notBefore.get(userId);
    return typeof nb === 'number' && typeof iat === 'number' && iat < nb;
  }
}

/**
 * Magasin d'utilisateurs persistant (fichier JSON).
 * Precautions : le fichier contient des EMPREINTES de mots de passe.
 *  - ecriture ATOMIQUE (fichier temporaire + rename) : pas de fichier corrompu si crash
 *  - permissions 0600 (proprietaire seul) sur les systemes qui les supportent
 *  - `load()` explicite avant usage
 */
export class FileUserStore extends InMemoryUserStore {
  constructor({ path, fs } = {}) {
    super([]);
    if (!path) throw new Error('FileUserStore: path requis');
    this.path = path; this._fs = fs; this.loaded = false;
  }
  async _mod() { return this._fs ?? (await import('node:fs/promises')); }

  async load() {
    const fs = await this._mod();
    try {
      const arr = JSON.parse(await fs.readFile(this.path, 'utf8'));
      this._byId = new Map(); this._byEmail = new Map();
      for (const u of arr) this._put(u);
    } catch { /* fichier absent = base vide */ }
    this.loaded = true; return this;
  }

  async flush() {
    const fs = await this._mod();
    const tmp = `${this.path}.tmp`;
    const data = JSON.stringify([...this._byId.values()], null, 2);
    await fs.writeFile(tmp, data, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(tmp, this.path);                 // atomique
    try { await fs.chmod(this.path, 0o600); } catch { /* systeme sans chmod */ }
    return true;
  }

  async create(user) { const u = await super.create(user); await this.flush(); return u; }

  /** Met a jour un utilisateur existant (ex. rotation de mot de passe). */
  async update(id, patch = {}) { const u = await super.update(id, patch); await this.flush(); return u; }
}
