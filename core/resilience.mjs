// KayrosLab — Résilience : Retry (backoff exponentiel + jitter) + Circuit Breaker
// Réf. specs techniques §7 (EF-27/28). Portable navigateur + Node (ESM, zéro dépendance).

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Délai de backoff exponentiel, plafonné, avec jitter optionnel.
 * @returns {number} millisecondes
 */
export function computeBackoff(attempt, { baseMs = 400, factor = 2, jitter = true, maxMs = 30000 } = {}) {
  const raw = Math.min(baseMs * Math.pow(factor, attempt), maxMs);
  if (!jitter) return raw;
  // "full jitter" borné à [raw/2, raw]
  return Math.round(raw / 2 + Math.random() * (raw / 2));
}

export const BreakerState = Object.freeze({ CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' });

/**
 * Circuit Breaker à 3 états (CLOSED / OPEN / HALF_OPEN).
 * `now` est injectable pour des tests déterministes.
 */
export class CircuitBreaker {
  constructor({ failureThreshold = 5, coolDownMs = 30000, halfOpenProbes = 1, fallback = null, now = () => Date.now() } = {}) {
    this.failureThreshold = failureThreshold;
    this.coolDownMs = coolDownMs;
    this.halfOpenProbes = halfOpenProbes;
    this.fallback = fallback;
    this._now = now;
    this._state = BreakerState.CLOSED;
    this._failures = 0;
    this._openedAt = 0;
    this._probes = 0;
  }

  get state() {
    // Transition passive OPEN -> HALF_OPEN si le cooldown est écoulé.
    if (this._state === BreakerState.OPEN && this._now() - this._openedAt >= this.coolDownMs) {
      this._state = BreakerState.HALF_OPEN;
      this._probes = 0;
    }
    return this._state;
  }

  /** Le circuit autorise-t-il une tentative maintenant ? */
  allowRequest() {
    const s = this.state; // déclenche la transition éventuelle
    if (s === BreakerState.CLOSED) return true;
    if (s === BreakerState.OPEN) return false;
    // HALF_OPEN : nombre de sondes limité
    if (this._probes < this.halfOpenProbes) {
      this._probes += 1;
      return true;
    }
    return false;
  }

  onSuccess() {
    this._failures = 0;
    this._probes = 0;
    this._state = BreakerState.CLOSED;
  }

  onFailure() {
    if (this.state === BreakerState.HALF_OPEN) {
      this._trip();
      return;
    }
    this._failures += 1;
    if (this._failures >= this.failureThreshold) this._trip();
  }

  _trip() {
    this._state = BreakerState.OPEN;
    this._openedAt = this._now();
    this._probes = 0;
  }
}

/**
 * Convertit un en-tête HTTP `Retry-After` (secondes ou date HTTP) en millisecondes.
 * @returns {number|null}
 */
export function parseRetryAfter(value, nowMs = Date.now()) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.max(0, Math.round(Number(raw) * 1000));
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - nowMs);
}

/** Limitation de débit (HTTP 429) signalée par un provider. */
export function isRateLimitError(e) {
  return !!e && (e.status === 429 || e.code === 'RATE_LIMITED');
}

/**
 * Une nouvelle tentative a-t-elle une chance d'aboutir ? Non pour une clé
 * absente, un provider inconnu ou une erreur client 4xx (hors 408/429) :
 * relancer ne ferait que retarder le repli.
 */
export function isRetryableError(e) {
  if (!e) return true;
  if (e.retryable === false) return false;
  if (['NO_KEY', 'NOT_CONFIGURED', 'UNKNOWN_PROVIDER', 'NO_FETCH'].includes(e.code)) return false;
  if (typeof e.status === 'number' && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) return false;
  return true;
}

/**
 * Exécute `fn` avec retry + circuit breaker + fallback.
 *
 * - backoff exponentiel + jitter entre deux tentatives ;
 * - un 429 portant `retryAfterMs` (en-tête Retry-After) attend au moins ce
 *   délai ; au-delà de `maxRetryAfterMs`, on abandonne tout de suite (repli) ;
 * - un 429 n'est compté qu'une fois par le breaker, à l'épuisement des
 *   tentatives : une rafale de limitation ne doit pas ouvrir le circuit (et
 *   basculer tout le swarm sur le repli) dès le premier appel ;
 * - les erreurs non relançables (clé absente, 4xx) sortent immédiatement.
 * @param {() => Promise<any>} fn
 * @param {CircuitBreaker} [breaker]
 * @param {object} [retry]
 */
export async function withResilience(
  fn,
  breaker = null,
  retry = { maxRetries: 3, baseMs: 400, factor: 2, jitter: true }
) {
  if (breaker && !breaker.allowRequest()) {
    if (typeof breaker.fallback === 'function') return breaker.fallback();
    const err = new Error('CircuitBreaker OPEN');
    err.code = 'CIRCUIT_OPEN';
    throw err;
  }
  const maxRetries = Number.isFinite(retry?.maxRetries) ? retry.maxRetries : 3;
  const maxRetryAfterMs = Number.isFinite(retry?.maxRetryAfterMs) ? retry.maxRetryAfterMs : 60000;
  const wait = typeof retry?.sleep === 'function' ? retry.sleep : sleep;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fn();
      breaker?.onSuccess();
      return res;
    } catch (e) {
      lastErr = e;
      const rateLimited = isRateLimitError(e);
      if (!rateLimited) breaker?.onFailure();
      let delay = computeBackoff(attempt, retry);
      const retryAfter = rateLimited && Number.isFinite(e?.retryAfterMs) ? e.retryAfterMs : null;
      if (retryAfter !== null) delay = Math.max(delay, retryAfter);
      const canRetry = attempt < maxRetries
        && isRetryableError(e)
        && (retryAfter === null || retryAfter <= maxRetryAfterMs)
        && (!breaker || breaker.state !== BreakerState.OPEN);
      if (!canRetry) {
        if (rateLimited) breaker?.onFailure();
        break;
      }
      try { retry?.onRetry?.({ attempt: attempt + 1, delayMs: delay, error: e }); } catch { /* observabilité seulement */ }
      await wait(delay);
    }
  }
  if (breaker && typeof breaker.fallback === 'function') return breaker.fallback();
  throw lastErr;
}

/**
 * `Promise.all` à concurrence bornée : au plus `limit` appels de `fn` en vol,
 * résultats dans l'ordre d'entrée. `limit` <= 0 ou non fini → sans limite.
 */
export async function mapWithConcurrency(items, limit, fn) {
  const list = Array.from(items || []);
  const n = Number(limit);
  const width = Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), list.length || 1) : list.length || 1;
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      results[i] = await fn(list[i], i);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
