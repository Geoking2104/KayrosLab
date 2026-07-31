// Slack deepening helpers (EF-89, EF-92) — pure functions, zero deps.
// Imported by connectors.mjs / tests without circular risk.

/** Constant-time string compare (hex signatures). */
export function timingSafeEqual(a, b) {
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  return diff === 0;
}

/** Canonical platform identity: `slack:U123`. */
export function platformUserId(platform, rawId) {
  if (!rawId) return null;
  const s = String(rawId);
  if (s.includes(':')) return s;
  return `${platform}:${s}`;
}

/**
 * Build Slack Block Kit payload for incoming webhooks (no bot token).
 * @param {import('./connectors.mjs').AbstractView} view
 */
export function viewToSlackWebhookBody(view, renderBlocks) {
  const blocks = typeof renderBlocks === 'function' ? renderBlocks(view) : [];
  return {
    text: view?.title || 'KayrosLab',
    blocks,
  };
}

/**
 * Idempotence store for interaction IDs (EF-92).
 * Keeps last `max` keys; returns true if already seen.
 */
export function createIdempotenceStore(max = 2000) {
  const seen = new Map();
  return {
    seen(id) {
      if (!id) return false;
      if (seen.has(id)) return true;
      seen.set(id, Date.now());
      if (seen.size > max) {
        const first = seen.keys().next().value;
        seen.delete(first);
      }
      return false;
    },
    size() { return seen.size; },
    clear() { seen.clear(); },
  };
}

/** Extract a stable interaction id from a Slack payload. */
export function slackInteractionId(body = {}) {
  if (body.actions?.[0]?.action_id && body.user?.id && body.message?.ts) {
    return `slack:${body.user.id}:${body.actions[0].action_id}:${body.message.ts}`;
  }
  if (body.view?.id && body.user?.id) return `slack:view:${body.user.id}:${body.view.id}`;
  if (body.trigger_id) return `slack:trig:${body.trigger_id}`;
  return null;
}
