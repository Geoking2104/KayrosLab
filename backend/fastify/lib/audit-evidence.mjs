// KayrosLab -- câblage backend du journal d'audit scellé (pilote Proof-of-Control).
//
// Activé seulement si une clé Ed25519 est fournie :
//   KAYROS_AUDIT_SIGNING_KEY       PEM PKCS#8 (ou PEM en base64)
//   KAYROS_AUDIT_SIGNING_KEY_FILE  chemin du PEM (prioritaire, recommandé)
// Options :
//   KAYROS_AUDIT_DIR                    journaux JSONL scellés (défaut ./data/audit)
//   KAYROS_AUDIT_CHECKPOINT_EVERY       checkpoint signé toutes les N entrées (défaut 100)
//   KAYROS_AUDIT_ANCHOR_DIR             dossier d'ancrage (à monter hors du serveur)
//   KAYROS_AUDIT_ANCHOR_INTERVAL_MS     période d'ancrage (défaut 3600000, 0 = manuel)
//   KAYROS_AUDIT_ANCHOR_GITHUB_TOKEN    jeton (droit gist) pour l'ancrage gist
//   KAYROS_AUDIT_ANCHOR_GIST_ID         gist existant à compléter
// Une clé invalide n'empêche pas le démarrage : la signature reste désactivée
// et /health l'indique (aucune preuve ne doit être présentée comme scellée).
import {
  createAnchorService, createEd25519Signer, createFileAnchor, createGistAnchor,
  createJsonlSink, createSignedChainSink, jsonlHeadLoader, readSigningKeyFromEnv,
} from '../../../core/index.mjs';

export function buildAuditEvidence(env = process.env, { logger = console, fs = null, now } = {}) {
  let pem;
  try { pem = readSigningKeyFromEnv(env); } catch (e) {
    logger?.warn?.('[kayros][audit] clé de signature illisible, journal scellé désactivé :', e.message);
    return { enabled: false, error: 'clé de signature illisible' };
  }
  if (!pem) return { enabled: false };
  let signer;
  try { signer = createEd25519Signer(pem); } catch (e) {
    logger?.warn?.('[kayros][audit] clé de signature invalide (Ed25519 PKCS#8 attendu), journal scellé désactivé :', e.message);
    return { enabled: false, error: 'clé de signature invalide' };
  }

  const dir = env.KAYROS_AUDIT_DIR || './data/audit';
  const inner = createJsonlSink({ dir, fs });
  const every = Number.parseInt(env.KAYROS_AUDIT_CHECKPOINT_EVERY ?? '100', 10);
  const sink = createSignedChainSink({
    inner, signer, ...(now ? { now } : {}),
    checkpointEvery: Number.isFinite(every) && every > 0 ? every : 0,
    loadHead: jsonlHeadLoader({ pathFor: inner.pathFor, fs }),
  });

  const publishers = [];
  if (env.KAYROS_AUDIT_ANCHOR_DIR) publishers.push(createFileAnchor({ dir: env.KAYROS_AUDIT_ANCHOR_DIR, fs }));
  if (env.KAYROS_AUDIT_ANCHOR_GITHUB_TOKEN) {
    publishers.push(createGistAnchor({ token: env.KAYROS_AUDIT_ANCHOR_GITHUB_TOKEN, gistId: env.KAYROS_AUDIT_ANCHOR_GIST_ID || null }));
  }
  const interval = Number.parseInt(env.KAYROS_AUDIT_ANCHOR_INTERVAL_MS ?? '3600000', 10);
  const anchors = publishers.length
    ? createAnchorService({ sink, signer, publishers, intervalMs: Number.isFinite(interval) ? interval : 0, logger, ...(now ? { now } : {}) })
    : null;

  return {
    enabled: true,
    kid: signer.kid,
    publicKey: signer.publicKey,
    dir,
    sink,
    signer,
    anchors,
    anchorTargets: publishers.map((p) => p.kind),
    describe() {
      return {
        enabled: true,
        kid: signer.kid,
        publicKey: signer.publicKey,
        sessionChain: sink.sessionChain,
        stats: sink.stats,
        heads: sink.checkpoints(),
        anchoring: { targets: publishers.map((p) => p.kind), intervalMs: anchors ? interval : 0, last: anchors?.last || null },
      };
    },
  };
}
