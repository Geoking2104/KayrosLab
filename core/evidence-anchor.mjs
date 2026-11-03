// KayrosLab -- ancrage externe des têtes de chaîne de preuves (pilote Proof-of-Control).
//
// Une chaîne signée seule ne protège pas contre son propre signataire : qui
// détient la clé privée peut réécrire toute la chaîne. L'ancrage publie
// régulièrement, HORS du système, un manifeste signé des têtes de chaîne
// (chain, seq, head). Toute réécriture ou troncature antérieure à une ancre
// devient détectable par quiconque possède le manifeste publié.
//
// Destinations fournies :
//   - createFileAnchor : fichiers manifestes + anchors.jsonl dans un dossier
//     (à monter sur un stockage distinct, synchronisé hors du serveur) ;
//   - createGistAnchor : GitHub Gist (révisions horodatées par un tiers) ;
//   - n'importe quel objet { kind, publish(manifest) } fourni par l'appelant.

import { canonicalize, sha256Hex, keyIdOf, verifyEvidenceChain } from './evidence-chain.mjs';
import { createPublicKey, verify } from 'node:crypto';

export const ANCHOR_FORMAT = 'kayros-anchor/0.1';

/** Manifeste signé d'un ensemble de têtes de chaîne. */
export function buildAnchorManifest({ checkpoints = [], signer, now = () => new Date().toISOString(), note = undefined } = {}) {
  if (!signer || typeof signer.sign !== 'function') throw new Error('evidence-anchor: signer requis');
  const entries = checkpoints
    .filter(Boolean)
    .map((c) => ({ chain: String(c.chain), seq: c.seq, head: c.head ?? c.hash }))
    .sort((a, b) => a.chain.localeCompare(b.chain));
  const body = { v: ANCHOR_FORMAT, type: 'anchor-manifest', created: now(), alg: signer.alg, kid: signer.kid, entries, ...(note ? { note } : {}) };
  const digest = sha256Hex(canonicalize(body));
  return { ...body, digest, sig: signer.sign(digest) };
}

/** Vérifie la signature d'un manifeste ; ne fait confiance qu'aux clés fournies. */
export function verifyAnchorManifest(manifest, { publicKeys } = {}) {
  const keys = new Map();
  for (const pem of [].concat(publicKeys || [])) keys.set(keyIdOf(pem), createPublicKey(pem));
  const errors = [];
  if (!manifest || manifest.v !== ANCHOR_FORMAT) errors.push('format de manifeste inconnu');
  else {
    const { digest, sig, ...body } = manifest;
    const expected = sha256Hex(canonicalize(body));
    const key = keys.get(manifest.kid);
    if (!key) errors.push(`clé inconnue ${manifest.kid}`);
    else if (digest !== expected) errors.push('manifeste modifié');
    else {
      let ok = false;
      try { ok = verify(null, Buffer.from(expected, 'hex'), key, Buffer.from(String(sig), 'base64url')); } catch { ok = false; }
      if (!ok) errors.push('signature du manifeste invalide');
    }
  }
  return { ok: errors.length === 0, errors, entries: errors.length ? [] : manifest.entries };
}

const stamp = (iso) => String(iso).replace(/[^0-9TZ]/g, '');

/** Ancrage fichier : un manifeste par ancrage + un index anchors.jsonl en ajout seul. */
export function createFileAnchor({ dir, fs = null } = {}) {
  if (!dir) throw new Error('evidence-anchor: dossier requis');
  const getFs = async () => fs || import('node:fs/promises');
  return {
    kind: 'file',
    dir,
    async publish(manifest) {
      const nodeFs = await getFs();
      await nodeFs.mkdir(dir, { recursive: true });
      const location = `${dir}/anchor-${stamp(manifest.created)}-${manifest.digest.slice(0, 8)}.json`;
      await nodeFs.writeFile(location, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      await nodeFs.appendFile(`${dir}/anchors.jsonl`, `${JSON.stringify(manifest)}\n`, 'utf8');
      return { kind: 'file', location };
    },
  };
}

/**
 * Ancrage GitHub Gist : chaque ancrage ajoute un fichier au gist (ou crée le
 * gist). GitHub conserve et horodate chaque révision, hors du serveur KayrosLab.
 * Jeton : droit `gist` uniquement.
 */
export function createGistAnchor({ token, gistId = null, isPublic = false, fetchImpl = globalThis.fetch, apiBase = 'https://api.github.com' } = {}) {
  if (!token) throw new Error('evidence-anchor: jeton GitHub requis pour le gist');
  let currentId = gistId || null;
  return {
    kind: 'gist',
    get gistId() { return currentId; },
    async publish(manifest) {
      const filename = `kayros-anchor-${stamp(manifest.created)}-${manifest.digest.slice(0, 8)}.json`;
      const files = { [filename]: { content: `${JSON.stringify(manifest, null, 2)}\n` } };
      const res = await fetchImpl(currentId ? `${apiBase}/gists/${currentId}` : `${apiBase}/gists`, {
        method: currentId ? 'PATCH' : 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'user-agent': 'kayroslab-evidence-anchor',
        },
        body: JSON.stringify(currentId ? { files } : { description: 'KayrosLab — ancres du journal d\'audit (pilote Proof-of-Control)', public: !!isPublic, files }),
      });
      if (!res.ok) throw new Error(`evidence-anchor: gist HTTP ${res.status}`);
      const data = await res.json();
      currentId = data.id || currentId;
      const revision = data.history?.[0]?.version || null;
      return { kind: 'gist', location: data.html_url || `https://gist.github.com/${currentId}`, gistId: currentId, revision, filename };
    },
  };
}

/**
 * Service d'ancrage : rassemble les têtes du sink signé, signe le manifeste
 * et le publie sur chaque destination. Périodique (start) ou à la demande.
 */
export function createAnchorService({ sink, signer, publishers = [], intervalMs = 0, now = () => new Date().toISOString(), logger = console } = {}) {
  if (!sink || typeof sink.checkpoints !== 'function') throw new Error('evidence-anchor: sink signé requis');
  let timer = null;
  let last = null;
  let lastDigestKey = null;
  const history = [];

  async function anchorNow({ force = false, note } = {}) {
    if (typeof sink.flush === 'function') await sink.flush();
    const checkpoints = sink.checkpoints();
    const key = canonicalize(checkpoints.map((c) => [c.chain, c.seq, c.head]));
    if (!checkpoints.length || (!force && key === lastDigestKey)) return { skipped: true, reason: checkpoints.length ? 'aucune nouvelle entrée' : 'aucune chaîne', last };
    const manifest = buildAnchorManifest({ checkpoints, signer, now, note });
    const receipts = [];
    for (const publisher of publishers) {
      try { receipts.push({ ok: true, ...(await publisher.publish(manifest)) }); } catch (e) {
        receipts.push({ ok: false, kind: publisher.kind, error: String(e?.message || e) });
        logger?.warn?.('[kayros][audit] ancrage échoué', publisher.kind, e?.message || e);
      }
    }
    if (receipts.some((r) => r.ok)) lastDigestKey = key;
    last = { created: manifest.created, digest: manifest.digest, chains: manifest.entries.length, receipts };
    history.unshift(last);
    history.length = Math.min(history.length, 20);
    return { skipped: false, manifest, receipts };
  }

  return {
    anchorNow,
    get last() { return last; },
    get history() { return history.slice(); },
    start() {
      if (timer || !(intervalMs > 0)) return false;
      timer = setInterval(() => { anchorNow().catch(() => {}); }, intervalMs);
      timer.unref?.();
      return true;
    },
    async stop({ finalAnchor = true } = {}) {
      if (timer) clearInterval(timer);
      timer = null;
      if (finalAnchor) await anchorNow().catch(() => {});
    },
  };
}

/** Relit la dernière enveloppe d'un fichier JSONL : reprise d'une chaîne au redémarrage. */
export function jsonlHeadLoader({ pathFor, fs = null } = {}) {
  return async (chain) => {
    const nodeFs = fs || (await import('node:fs/promises'));
    let text;
    try { text = await nodeFs.readFile(pathFor(chain), 'utf8'); } catch { return null; }
    const lines = text.split('\n').filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const env = JSON.parse(lines[i]);
        if (env.chain === chain && Number.isInteger(env.seq)) return { seq: env.seq, hash: env.hash };
      } catch { /* ligne incomplète après crash : on remonte */ }
    }
    return null;
  };
}

/** Vérifie tous les journaux .jsonl d'un dossier ; utilisé par les scripts. */
export async function verifyEvidenceDir(dir, { publicKeys, anchors = [], fs = null } = {}) {
  const nodeFs = fs || (await import('node:fs/promises'));
  const names = (await nodeFs.readdir(dir)).filter((n) => n.endsWith('.jsonl') && n !== 'anchors.jsonl').sort();
  const files = [];
  for (const name of names) {
    const result = verifyEvidenceChain(await nodeFs.readFile(`${dir}/${name}`, 'utf8'), { publicKeys, anchors });
    files.push({ file: name, ...result });
  }
  const checkpoints = files.flatMap((f) => Object.entries(f.chains).map(([chain, h]) => ({ chain, seq: h.length - 1, head: h.head })));
  // Une chaîne ancrée dont le fichier a disparu est une suppression.
  const present = new Set(checkpoints.map((c) => c.chain));
  const missing = [].concat(anchors || []).filter((a) => a && !present.has(a.chain)).map((a) => ({ chain: a.chain, reason: `chaîne ancrée absente (seq ${a.seq}) : journal supprimé` }));
  return { ok: files.every((f) => f.ok) && missing.length === 0, files, checkpoints, missing };
}
