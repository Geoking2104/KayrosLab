// KayrosLab -- chaîne de preuves signée pour le journal d'audit.
//
// Pilote inspiré du brouillon Proof-of-Control (Advanced AI Society,
// AAI-Society/ov-poc-standard, v1.0 en commentaires publics). Il vise les
// propriétés de preuve du chapitre C7 que l'on peut obtenir sans passerelle
// d'interception ni TEE :
//   - contemporaine : l'enveloppe est scellée au moment de l'append ;
//   - infalsifiable de façon détectable : chaque entrée porte l'empreinte de
//     la précédente (chaîne de hachage) et une signature Ed25519 ;
//   - vérifiable sans faire confiance à l'opérateur : un tiers n'a besoin que
//     du fichier JSONL et de la clé publique (voir verifyEvidenceChain et
//     scripts/verify-audit-chain.mjs) ;
//   - binaire : la vérification répond ok / pas ok, avec la première rupture.
// Ce n'est PAS une conformité Proof-of-Control : pas de passerelle sans
// contournement (C7.1), pas d'ancrage public automatique, pas de profil
// CWT/CBOR. La complétude n'est pas garantie : seuls les événements passés
// par le sink sont prouvés (comme le niveau 3 du standard).

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';

export const EVIDENCE_FORMAT = 'kayros-evidence/0.1';
export const GENESIS_HASH = '0'.repeat(64);

/** JSON canonique : clés triées, pas d'espaces, undefined omis (proche RFC 8785). */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    return JSON.stringify(value) ?? 'null';
  }
  if (typeof value.toJSON === 'function') return canonicalize(value.toJSON());
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalize(v))).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined && typeof value[k] !== 'function').sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

export const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Empreinte courte de la clé publique, utilisée comme `kid`. */
export function keyIdOf(publicKey) {
  const der = createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
  return `ed25519:${createHash('sha256').update(der).digest('hex').slice(0, 16)}`;
}

/** Génère une paire Ed25519 (PEM). Destiné aux tests et à l'initialisation. */
export function generateEvidenceKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  return { privateKey: privatePem, publicKey: publicPem, kid: keyIdOf(publicPem) };
}

/** Signataire à partir d'une clé privée PEM (ex. variable KAYROS_AUDIT_SIGNING_KEY). */
export function createEd25519Signer(privateKeyPem) {
  const key = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(key).export({ type: 'spki', format: 'pem' });
  return {
    alg: 'Ed25519',
    kid: keyIdOf(publicKey),
    publicKey,
    sign: (hashHex) => sign(null, Buffer.from(hashHex, 'hex'), key).toString('base64url'),
  };
}

/** Partie signée de l'enveloppe : tout sauf `hash` et `sig`. */
function sealedBody(envelope) {
  const { hash, sig, ...body } = envelope;
  return body;
}

function sealEnvelope({ chain, seq, prev, payload, signer, ts }) {
  const body = {
    v: EVIDENCE_FORMAT,
    chain,
    seq,
    prev,
    ts,
    alg: signer.alg,
    kid: signer.kid,
    payload_digest: sha256Hex(canonicalize(payload)),
    payload,
  };
  const hash = sha256Hex(canonicalize(body));
  return { ...body, hash, sig: signer.sign(hash) };
}

/**
 * Enveloppe un sink existant (mémoire, JSONL, fonction) : chaque entrée est
 * scellée dans une enveloppe chaînée et signée avant d'être transmise.
 * Une chaîne par runId (un fichier JSONL par run), à défaut une chaîne unique.
 *
 * @param {object} opts
 * @param {object|Function} opts.inner  sink cible (voir resolveLogSink)
 * @param {object} opts.signer          createEd25519Signer(...)
 * @param {Function} [opts.now]         horloge injectable
 * @param {Function} [opts.onCheckpoint] reçoit la tête de chaîne tous les `checkpointEvery` événements, pour ancrage externe
 */
export function createSignedChainSink({
  inner, signer, now = () => new Date().toISOString(), checkpointEvery = 0, onCheckpoint = null,
  defaultChain = null, loadHead = null,
} = {}) {
  if (!signer || typeof signer.sign !== 'function') throw new Error('evidence-chain: signer requis');
  const target = typeof inner === 'function' ? { append: inner } : inner;
  if (!target || typeof target.append !== 'function') throw new Error('evidence-chain: sink cible requis');
  const heads = new Map(); // chain -> { seq, hash }
  let queue = Promise.resolve();
  const stats = { sealed: 0, failures: 0 };

  // Un événement sans runId (essaim, passerelle) rejoint la chaîne de la
  // session : un nom unique par démarrage évite qu'un redémarrage reparte de
  // seq 0 dans un fichier déjà commencé.
  const sessionChain = String(defaultChain || `session-${now().replace(/[^0-9]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`);
  const chainOf = (entry) => String(entry?.runId ?? entry?.run_id ?? sessionChain);

  // Reprise d'une chaîne existante (ex. fichier JSONL après redémarrage).
  const headOf = async (chain) => {
    if (heads.has(chain)) return heads.get(chain);
    let head = { seq: -1, hash: GENESIS_HASH };
    if (typeof loadHead === 'function') {
      const last = await loadHead(chain);
      if (last && Number.isInteger(last.seq) && typeof last.hash === 'string') head = { seq: last.seq, hash: last.hash };
    }
    heads.set(chain, head);
    return head;
  };

  const sealOne = async (entry) => {
    const chain = chainOf(entry);
    const head = await headOf(chain);
    const envelope = sealEnvelope({ chain, seq: head.seq + 1, prev: head.hash, payload: entry, signer, ts: now() });
    // Nom de chaîne recopié en runId à la racine : le sink JSONL range un
    // fichier par chaîne, donc une chaîne = un fichier vérifiable seul.
    await target.append({ ...envelope, runId: chain });
    heads.set(chain, { seq: envelope.seq, hash: envelope.hash });
    stats.sealed += 1;
    if (checkpointEvery > 0 && onCheckpoint && (envelope.seq + 1) % checkpointEvery === 0) {
      try { await onCheckpoint(checkpointOf(chain)); } catch { /* l'ancrage ne bloque pas l'audit */ }
    }
    return envelope;
  };

  const checkpointOf = (chain = sessionChain) => {
    const head = heads.get(String(chain));
    if (!head) return null;
    const body = { v: EVIDENCE_FORMAT, type: 'checkpoint', chain: String(chain), seq: head.seq, head: head.hash, kid: signer.kid, ts: now() };
    const digest = sha256Hex(canonicalize(body));
    return { ...body, sig: signer.sign(digest) };
  };

  return {
    kind: 'signed-chain',
    kid: signer.kid,
    publicKey: signer.publicKey,
    stats,
    /** Sérialisé : l'ordre des seq suit l'ordre des appels. */
    append(entry) {
      const run = queue.then(() => sealOne(entry));
      queue = run.catch(() => { stats.failures += 1; });
      return run;
    },
    async flush() { await queue; return typeof target.flush === 'function' ? target.flush() : true; },
    /** Tête de chaîne signée, à publier hors du système (dépôt, horodatage...). */
    checkpoint: checkpointOf,
    /** Têtes signées de toutes les chaînes ouvertes depuis le démarrage. */
    checkpoints() { return [...heads.keys()].filter((c) => heads.get(c).seq >= 0).map((c) => checkpointOf(c)); },
    sessionChain,
    /** Adaptateur pour les auditSink synchrones (SwarmService, HybridAgentGateway). */
    asAuditFunction() {
      return (entry) => { this.append(entry).catch(() => {}); };
    },
  };
}

function parseLines(input) {
  if (Array.isArray(input)) return input.map((l) => (typeof l === 'string' ? JSON.parse(l) : l));
  return String(input).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/**
 * Vérification ouverte d'une chaîne. N'a besoin que des enregistrements et
 * des clés publiques de confiance ; ne fait confiance à rien d'autre.
 * Retourne un résultat binaire et la première rupture rencontrée par chaîne.
 *
 * @param {string|Array} input  contenu JSONL ou tableau d'enveloppes
 * @param {object} opts
 * @param {string|string[]} opts.publicKeys  clé(s) publique(s) PEM acceptées
 * @param {object} [opts.checkpoint]  tête attendue (ancrée hors système) : détecte une troncature
 */
export function verifyEvidenceChain(input, { publicKeys, checkpoint = null, anchors = [] } = {}) {
  const keys = new Map();
  for (const pem of [].concat(publicKeys || [])) keys.set(keyIdOf(pem), createPublicKey(pem));
  if (!keys.size) throw new Error('evidence-chain: au moins une clé publique requise');

  const errors = [];
  const heads = new Map();
  let records;
  let atCheckpoint = null;
  const anchorList = [].concat(anchors || []).filter((a) => a && a.chain != null);
  const seenAt = new Map(); // `${chain}#${seq}` -> hash, pour les ancres
  try { records = parseLines(input); } catch (e) {
    return { ok: false, count: 0, chains: {}, errors: [{ line: null, reason: `JSON illisible: ${e.message}` }] };
  }

  records.forEach((record, index) => {
    const line = index + 1;
    const fail = (reason) => errors.push({ line, chain: record?.chain, seq: record?.seq, reason });
    if (!record || record.v !== EVIDENCE_FORMAT) return fail('format inconnu ou enregistrement non scellé');
    const { runId, ...envelope } = record;
    const key = keys.get(envelope.kid);
    if (!key) return fail(`clé inconnue ${envelope.kid}`);
    if (envelope.payload_digest !== sha256Hex(canonicalize(envelope.payload))) return fail('payload modifié');
    const hash = sha256Hex(canonicalize(sealedBody(envelope)));
    if (hash !== envelope.hash) return fail('empreinte invalide');
    let sigOk = false;
    try { sigOk = verify(null, Buffer.from(hash, 'hex'), key, Buffer.from(String(envelope.sig), 'base64url')); } catch { sigOk = false; }
    if (!sigOk) return fail('signature invalide');
    const head = heads.get(envelope.chain) || { seq: -1, hash: GENESIS_HASH };
    if (envelope.seq !== head.seq + 1) return fail(`séquence rompue (attendu ${head.seq + 1})`);
    if (envelope.prev !== head.hash) return fail('chaînage rompu (prev)');
    heads.set(envelope.chain, { seq: envelope.seq, hash: envelope.hash });
    if (checkpoint && envelope.chain === checkpoint.chain && envelope.seq === checkpoint.seq) atCheckpoint = envelope.hash;
    if (anchorList.length) seenAt.set(`${envelope.chain}#${envelope.seq}`, envelope.hash);
  });

  if (checkpoint) {
    const key = keys.get(checkpoint.kid);
    const { sig, ...body } = checkpoint;
    let cpOk = false;
    try { cpOk = !!key && verify(null, Buffer.from(sha256Hex(canonicalize(body)), 'hex'), key, Buffer.from(String(sig), 'base64url')); } catch { cpOk = false; }
    const head = heads.get(checkpoint.chain);
    if (!cpOk) errors.push({ line: null, chain: checkpoint.chain, reason: 'checkpoint : signature invalide' });
    else if (!head || head.seq < checkpoint.seq) errors.push({ line: null, chain: checkpoint.chain, reason: 'journal tronqué : entrées manquantes avant le checkpoint' });
    else if (atCheckpoint !== checkpoint.head) errors.push({ line: null, chain: checkpoint.chain, reason: 'checkpoint : tête différente' });
  }

  // Ancres issues d'un manifeste déjà vérifié (verifyAnchorManifest) : seules
  // les chaînes présentes dans le journal sont contrôlées.
  for (const anchor of anchorList) {
    if (!heads.has(anchor.chain)) continue;
    const head = heads.get(anchor.chain);
    if (head.seq < anchor.seq) errors.push({ line: null, chain: anchor.chain, reason: `journal tronqué : l'ancre attend seq ${anchor.seq}, la chaîne s'arrête à ${head.seq}` });
    else if (seenAt.get(`${anchor.chain}#${anchor.seq}`) !== anchor.head) errors.push({ line: null, chain: anchor.chain, reason: `ancre : empreinte différente à seq ${anchor.seq} (journal réécrit)` });
  }

  const chains = Object.fromEntries([...heads].map(([c, h]) => [c, { length: h.seq + 1, head: h.hash }]));
  return { ok: errors.length === 0, count: records.length, chains, errors };
}
