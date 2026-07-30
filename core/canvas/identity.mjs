// KayrosLab — Canvas : identite des agents.
// EF-240 (identite propre), EF-241 (agent = membre), EF-242 (production signee),
// EF-243 (un agent ne resout jamais un gate et n'exerce jamais de veto).
//
// Transposition B1 de Buzz : un agent n'emprunte pas l'identite d'un humain,
// il a sa paire de cles. La difference avec Buzz est deliberee : chez eux
// l'agent a les MEMES affordances qu'un humain. Ici non — cf. EF-243. Un
// atelier gouverne ou un agent peut trancher n'est plus gouverne.
//
// Ed25519 via WebCrypto : disponible dans Node 20+ et les navigateurs recents,
// donc zero dependance ET portable. Aucune bibliotheque de crypto embarquee.

const enc = new TextEncoder();

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) { const e = new Error('WebCrypto indisponible'); e.code = 'NO_WEBCRYPTO'; throw e; }
  return s;
};

// ---------------------------------------------------------------------------
// Encodage
// ---------------------------------------------------------------------------

export function toBase64Url(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * Serialisation CANONIQUE : cles triees, recursivement.
 * Sans elle, `{a:1,b:2}` et `{b:2,a:1}` produiraient deux signatures
 * differentes pour un contenu identique, et la verification serait un
 * jeu de hasard sur l'ordre d'insertion.
 */
export function canonical(valeur) {
  if (valeur === null || typeof valeur !== 'object') return JSON.stringify(valeur ?? null);
  if (Array.isArray(valeur)) return `[${valeur.map(canonical).join(',')}]`;
  const cles = Object.keys(valeur).filter((k) => valeur[k] !== undefined).sort();
  return `{${cles.map((k) => `${JSON.stringify(k)}:${canonical(valeur[k])}`).join(',')}}`;
}

/** SHA-256 en base64url. Sert au chainage du journal et aux empreintes. */
export async function sha256(texte) {
  return toBase64Url(await subtle().digest('SHA-256', enc.encode(String(texte))));
}

// ---------------------------------------------------------------------------
// Cles
// ---------------------------------------------------------------------------

/** Genere une paire Ed25519. La cle privee est exportable pour etre stockee. */
export async function generateKeyPair() {
  const kp = await subtle().generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pub = await subtle().exportKey('raw', kp.publicKey);
  const priv = await subtle().exportKey('pkcs8', kp.privateKey);
  return {
    publicKey: toBase64Url(pub),
    privateKey: toBase64Url(priv),
    _keys: kp,
  };
}

async function importPrivate(b64) {
  return subtle().importKey('pkcs8', fromBase64Url(b64), { name: 'Ed25519' }, false, ['sign']);
}
async function importPublic(b64) {
  return subtle().importKey('raw', fromBase64Url(b64), { name: 'Ed25519' }, false, ['verify']);
}

/** Signe une valeur quelconque (canonicalisee). Renvoie une signature base64url. */
export async function sign(valeur, privateKeyB64) {
  const k = await importPrivate(privateKeyB64);
  return toBase64Url(await subtle().sign({ name: 'Ed25519' }, k, enc.encode(canonical(valeur))));
}

/** Verifie une signature. Retourne `false` plutot que de lever : une signature
 *  invalide est un cas NORMAL a traiter, pas une panne. */
export async function verify(valeur, signature, publicKeyB64) {
  try {
    const k = await importPublic(publicKeyB64);
    return await subtle().verify({ name: 'Ed25519' }, k, fromBase64Url(signature), enc.encode(canonical(valeur)));
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// EF-243 — perimetre d'action
// ---------------------------------------------------------------------------

/**
 * Actions structurellement INTERDITES a un agent.
 *
 * Cette liste n'est pas une politique configurable : c'est la frontiere qui
 * distingue KayrosLab d'un assistant. Le vote d'un agent instruit ; il ne
 * tranche pas. Rendre ceci parametrable reviendrait a le rendre negociable.
 */
export const ACTIONS_INTERDITES_AGENT = Object.freeze([
  'gate.resolve', 'gate.open', 'veto', 'decision.apply',
  'moderation.reject', 'moderation.approve', 'idea.stage', 'idea.status',
]);

/** Actions ouvertes aux agents comme aux humains. */
export const ACTIONS_AGENT = Object.freeze([
  'node.add', 'node.update', 'node.remove', 'edge.add', 'edge.remove',
  'comment.add', 'cluster.label', 'swarm.run', 'framework.run', 'vote.advisory',
  'notify', 'promote',
]);

/**
 * EF-243 : verifie qu'un acteur peut effectuer une action.
 * @returns {{autorise:boolean, motif:string|null}}
 */
export function canAct(acteur, action) {
  if (!acteur) return { autorise: false, motif: 'acteur inconnu' };
  // Seul un HUMAIN echappe a la liste blanche. Tester `kind !== 'agent'`
  // laisserait passer un workflow ou tout futur acteur automatique : la
  // contrainte doit porter sur « non humain », pas sur « agent ».
  if (acteur.kind === 'human') return { autorise: true, motif: null };
  if (ACTIONS_INTERDITES_AGENT.includes(action)) {
    return { autorise: false, motif: `action "${action}" reservee a un acteur humain — un acteur automatique instruit, il ne tranche pas` };
  }
  if (!ACTIONS_AGENT.includes(action)) {
    // Liste blanche : une action inconnue est refusee par defaut. Ajouter une
    // capacite doit etre un acte explicite, pas un effet de bord.
    return { autorise: false, motif: `action "${action}" non ouverte aux agents` };
  }
  return { autorise: true, motif: null };
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

/** Cree une identite d'agent. `privateKey` n'est jamais stockee dans l'objet public. */
export async function createAgentIdentity({ id, tenantId = 'default', persona, nom = null, voteWeight = 1, keys = null } = {}) {
  if (!id) throw new Error('createAgentIdentity: id requis');
  if (!persona) throw new Error('createAgentIdentity: persona requise');
  const k = keys ?? await generateKeyPair();
  return {
    identite: {
      id, tenantId, persona, nom: nom ?? persona,
      kind: 'agent',
      publicKey: k.publicKey,
      memberships: [],
      voteWeight,
      // Expose et fige : aucun code appelant ne peut se tromper sur ce point.
      canResolveGate: false,
      createdAt: new Date().toISOString(),
    },
    privateKey: k.privateKey,
  };
}

export class AgentRegistry {
  constructor() { this._m = new Map(); }

  register(identite) {
    if (!identite?.id || identite.kind !== 'agent') throw new Error('AgentRegistry: identite d agent requise');
    if (identite.canResolveGate) throw new Error('AgentRegistry: un agent ne peut pas resoudre un gate (EF-243)');
    this._m.set(identite.id, identite);
    return this;
  }
  get(id) { return this._m.get(id) ?? null; }
  list(tenantId = null) {
    const t = [...this._m.values()];
    return tenantId ? t.filter((a) => a.tenantId === tenantId) : t;
  }

  /**
   * EF-241 : l'appartenance definit le perimetre, pas un drapeau de permission.
   * On ajoute et on retire un agent d'un espace comme un participant humain.
   */
  join(agentId, workspaceId) {
    const a = this.get(agentId);
    if (!a) throw new Error(`join: agent introuvable "${agentId}"`);
    if (a.memberships.includes(workspaceId)) return a;
    const next = { ...a, memberships: [...a.memberships, workspaceId] };
    this._m.set(agentId, next);
    return next;
  }
  leave(agentId, workspaceId) {
    const a = this.get(agentId);
    if (!a) throw new Error(`leave: agent introuvable "${agentId}"`);
    const next = { ...a, memberships: a.memberships.filter((w) => w !== workspaceId) };
    this._m.set(agentId, next);
    return next;
  }
  isMember(agentId, workspaceId) {
    return Boolean(this.get(agentId)?.memberships.includes(workspaceId));
  }

  /** Agents membres d'un espace — la liste des participants non humains. */
  membersOf(workspaceId) { return this.list().filter((a) => a.memberships.includes(workspaceId)); }
}

// ---------------------------------------------------------------------------
// EF-242 — productions signees
// ---------------------------------------------------------------------------

/** Charge utile signee d'une production : ce qui engage l'agent. */
function chargeUtile(production) {
  return {
    type: production.type,
    titre: production.titre,
    corps: production.corps ?? '',
    authorId: production.authorId,
    workspaceId: production.workspaceId ?? null,
  };
}

/** Signe une production d'agent. */
export async function signProduction(production, privateKey) {
  if (!production?.authorId) throw new Error('signProduction: authorId requis');
  const signature = await sign(chargeUtile(production), privateKey);
  return { ...production, signature, signedAt: new Date().toISOString() };
}

/**
 * EF-242 : verifie une production. Une sortie NON SIGNEE est refusee — pas
 * "acceptee avec un avertissement". Si l'attribution peut etre contournee en
 * omettant la signature, elle ne vaut rien.
 */
export async function verifyProduction(production, registry) {
  if (!production?.signature) return { valide: false, motif: 'production non signee' };
  const agent = registry.get(production.authorId);
  if (!agent) return { valide: false, motif: `agent inconnu "${production.authorId}"` };
  const ok = await verify(chargeUtile(production), production.signature, agent.publicKey);
  return ok ? { valide: true, motif: null, agent } : { valide: false, motif: 'signature invalide' };
}

/** Filtre une liste de productions : ne laisse passer que les signatures valides. */
export async function filterSigned(productions, registry) {
  const res = await Promise.all(productions.map(async (p) => ({ p, v: await verifyProduction(p, registry) })));
  return {
    valides: res.filter((x) => x.v.valide).map((x) => x.p),
    rejetees: res.filter((x) => !x.v.valide).map((x) => ({ production: x.p, motif: x.v.motif })),
  };
}
