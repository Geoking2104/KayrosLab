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
 * Exécute `fn` avec retry + circuit breaker + fallback.
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
  let lastErr;
  for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
    try {
      const res = await fn();
      breaker?.onSuccess();
      return res;
    } catch (e) {
      lastErr = e;
      breaker?.onFailure();
      const canRetry = attempt < retry.maxRetries && (!breaker || breaker.state !== BreakerState.OPEN);
      if (!canRetry) break;
      await sleep(computeBackoff(attempt, retry));
    }
  }
  if (breaker && typeof breaker.fallback === 'function') return breaker.fallback();
  throw lastErr;
}
