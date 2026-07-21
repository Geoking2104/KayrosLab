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
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
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
  async list({ tenantId } = {}) {
    const all = [...this._byId.values()];
    return tenantId ? all.filter((u) => u.tenantId === tenantId) : all;
  }
}

/** Vue publique d'un utilisateur : JAMAIS l'empreinte du mot de passe. */
export const publicUser = (u) => (u ? { id: u.id, email: u.email, name: u.name, role: u.role, tenantId: u.tenantId } : null);

/** Service d'authentification : inscription, connexion, verification, RBAC. */
export class AuthService {
  constructor({ users = new InMemoryUserStore(), secret, ttlSec = 3600 } = {}) {
    if (!secret) throw new Error('AuthService: secret requis (variable d environnement)');
    this.users = users; this.secret = secret; this.ttlSec = ttlSec;
  }

  async register({ email, password, name = null, role = 'contributeur', tenantId = 'default' }) {
    if (!email || !String(email).includes('@')) throw new Error('email invalide');
    if (!ROLES.includes(role)) throw new Error(`role invalide: ${role}`);
    const passwordHash = await hashPassword(password);
    const id = globalThis.crypto?.randomUUID?.() ?? `u_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const user = await this.users.create({ id, email: String(email).toLowerCase(), name, role, tenantId, passwordHash, createdAt: new Date().toISOString() });
    return publicUser(user);
  }

  /**
   * Connexion. Message d'erreur VOLONTAIREMENT identique pour email inconnu et
   * mot de passe faux : ne pas reveler quels comptes existent (enumeration).
   */
  async login({ email, password }) {
    const user = await this.users.findByEmail(email ?? '');
    const ok = user ? await verifyPassword(password ?? '', user.passwordHash) : false;
    if (!ok) { const e = new Error('identifiants invalides'); e.code = 'AUTH_INVALID'; throw e; }
    const token = await issueToken(
      { sub: user.id, email: user.email, role: user.role, tenantId: user.tenantId },
      this.secret, { ttlSec: this.ttlSec },
    );
    return { token, user: publicUser(user) };
  }

  /** Verifie un jeton et renvoie le contexte d'appel. */
  async verify(token) {
    const r = await verifyToken(token, this.secret);
    if (!r.valid) { const e = new Error(`jeton invalide (${r.reason})`); e.code = 'AUTH_TOKEN'; throw e; }
    return r.payload;
  }

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
