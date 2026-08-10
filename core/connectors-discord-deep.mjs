// KayrosLab — Discord adapter helpers (V16)
// Server-only: Ed25519 signature verification + pure helpers.
import { createPublicKey, verify } from 'node:crypto';

// SPKI DER prefix for a raw 32-byte Ed25519 public key.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Verify a Discord interaction signature (Ed25519, signed over
 * `timestamp + rawBody`), with a 5-minute anti-replay window.
 * @param {{publicKey?:string, timestamp?:string, rawBody?:string, signature?:string, nowMs?:number}} opts
 * @returns {boolean}
 */
export function verifyDiscordSignature({ publicKey = '', timestamp = '', rawBody = '', signature = '', nowMs = Date.now() } = {}) {
  if (!publicKey || !timestamp || !signature) return false;
  const t = Number(timestamp);
  if (!Number.isFinite(t)) return false;
  if (Math.abs(Math.floor(nowMs / 1000) - t) > 300) return false;
  try {
    const pub = Buffer.from(String(publicKey), 'hex');
    const sig = Buffer.from(String(signature), 'hex');
    if (pub.length !== 32 || sig.length !== 64) return false;
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, pub]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, Buffer.from(`${timestamp}${rawBody}`, 'utf8'), key, sig);
  } catch {
    return false;
  }
}

/**
 * Stable interaction id for idempotence (mirror Slack EF-92).
 * @param {object} body
 */
export function discordInteractionId(body = {}) {
  if (body.type === 3 && body.id && body.user && body.message?.id && body.data?.custom_id) {
    return `discord:${body.user.id}:${body.data.custom_id}:${body.message.id}`;
  }
  if (body.type === 5 && body.id && body.user?.id && body.data?.custom_id) {
    return `discord:modal:${body.user.id}:${body.data.custom_id}:${body.id}`;
  }
  if (body.type === 2 && body.id && body.user?.id && body.data?.name) {
    return `discord:slash:${body.user.id}:${body.data.name}:${body.id}`;
  }
  return null;
}

/** Discord embed color: `#rrggbb` → 24-bit integer (default Kayros blue). */
export function discordEmbedColor(colorHex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(colorHex ?? ''));
  return m ? parseInt(m[1], 16) : 0x3b82f6;
}