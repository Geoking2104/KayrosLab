// Métriques applicatives KayrosLab (Prometheus), exposées par /metrics via
// fastify-metrics sur le registre global de @platformatic/prom-client.
//
// Règles :
//   - aucune donnée personnelle ni secret dans les labels (pas de tenant,
//     d'utilisateur, de question, de clé) ;
//   - labels à cardinalité bornée : fournisseurs connus, issues normalisées,
//     modèles plafonnés (au-delà de MAX_MODEL_LABELS → `other`).
//
// Accès : /metrics est réservé au jeton `METRICS_TOKEN` (Authorization:
// Bearer) s'il est défini, sinon au loopback direct (Prometheus local), et
// toujours refusé pour une requête relayée par nginx (en-têtes de proxy).
import { timingSafeEqual } from 'node:crypto';
import promClient from '@platformatic/prom-client';

export const KNOWN_PROVIDERS = Object.freeze(['nvidia', 'mistral', 'anthropic', 'ollama', 'mock']);
export const LLM_OUTCOMES = Object.freeze(['success', 'rate_limited', 'timeout', 'not_configured', 'circuit_open', 'error']);
export const RUN_OUTCOMES = Object.freeze(['completed', 'needs_clarification', 'failed', 'timeout']);
const MAX_MODEL_LABELS = 20;

const register = promClient.register;

function getOrCreate(Type, config) {
  return register.getSingleMetric(config.name) || new Type(config);
}

const llmCalls = getOrCreate(promClient.Counter, {
  name: 'kayros_llm_calls_total',
  help: 'Appels unitaires aux fournisseurs LLM (chaque tentative, relances comprises), par fournisseur, modèle et issue.',
  labelNames: ['provider', 'model', 'outcome'],
});
const llmCallDuration = getOrCreate(promClient.Histogram, {
  name: 'kayros_llm_call_duration_seconds',
  help: 'Durée des appels unitaires aux fournisseurs LLM.',
  labelNames: ['provider', 'outcome'],
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 20, 40, 60, 120, 180, 300],
});
const llmRequests = getOrCreate(promClient.Counter, {
  name: 'kayros_llm_requests_total',
  help: 'Requêtes LLM de bout en bout (chaîne de repli comprise) : success, degraded (repli) ou failed.',
  labelNames: ['outcome'],
});
const llmFallbacks = getOrCreate(promClient.Counter, {
  name: 'kayros_llm_fallbacks_total',
  help: 'Replis de la chaîne LLM (llm_degraded), par fournisseur d\'origine et de repli.',
  labelNames: ['from', 'to', 'reason'],
});
const llmLastMockFallback = getOrCreate(promClient.Gauge, {
  name: 'kayros_llm_last_fallback_to_mock_timestamp_seconds',
  help: 'Horodatage (epoch, s) du dernier repli vers le moteur déterministe mock (0 = jamais depuis le démarrage).',
});
const llmPrimaryInfo = getOrCreate(promClient.Gauge, {
  name: 'kayros_llm_primary_info',
  help: 'Fournisseur LLM primaire configuré (valeur 1 sur la série active).',
  labelNames: ['provider', 'model'],
});
const consoleRuns = getOrCreate(promClient.Counter, {
  name: 'kayros_console_runs_total',
  help: 'Missions console asynchrones terminées, par type et issue.',
  labelNames: ['kind', 'outcome'],
});
const consoleRunDuration = getOrCreate(promClient.Histogram, {
  name: 'kayros_console_run_duration_seconds',
  help: 'Durée des missions console asynchrones (du 202 au statut final).',
  labelNames: ['kind', 'outcome'],
  buckets: [5, 15, 30, 60, 120, 300, 600, 900, 1200, 1800, 2700, 3600],
});
const consoleRunsInProgress = getOrCreate(promClient.Gauge, {
  name: 'kayros_console_runs_in_progress',
  help: 'Missions console en cours d\'exécution dans ce processus.',
});
const consoleRunsInterrupted = getOrCreate(promClient.Counter, {
  name: 'kayros_console_runs_interrupted_total',
  help: 'Missions restées `running` au démarrage du processus et passées `failed` (redémarrage pendant l\'exécution).',
});

// Âge de la plus ancienne mission en cours, calculé à la collecte.
const runningStarts = new Map();
let runSeq = 0;
getOrCreate(promClient.Gauge, {
  name: 'kayros_console_run_oldest_running_seconds',
  help: 'Âge (s) de la plus ancienne mission console encore en cours dans ce processus (0 si aucune).',
  collect() {
    let oldest = 0;
    const now = Date.now();
    for (const startedAt of runningStarts.values()) oldest = Math.max(oldest, (now - startedAt) / 1000);
    this.set(oldest);
  },
});

const knownModels = new Set();
/** Label `model` borné : caractères sûrs, 64 car. max, 20 valeurs distinctes max. */
export function modelLabel(raw) {
  const value = String(raw || '').trim().slice(0, 64).replace(/[^A-Za-z0-9._:/-]/g, '_');
  if (!value) return 'default';
  if (knownModels.has(value)) return value;
  if (knownModels.size >= MAX_MODEL_LABELS) return 'other';
  knownModels.add(value);
  return value;
}

export function providerLabel(id) {
  const value = String(id || '').toLowerCase();
  return KNOWN_PROVIDERS.includes(value) ? value : 'other';
}

/** Issue normalisée d'un appel fournisseur en échec. */
export function classifyLlmError(error) {
  if (!error) return 'error';
  if (error.code === 'RATE_LIMITED' || Number(error.status) === 429) return 'rate_limited';
  if (error.code === 'NO_KEY') return 'not_configured';
  if (error.code === 'CIRCUIT_OPEN') return 'circuit_open';
  const name = String(error.name || '');
  const message = String(error.message || '');
  if (name === 'TimeoutError' || name === 'AbortError' || error.code === 'ETIMEDOUT' || error.code === 'UND_ERR_HEADERS_TIMEOUT'
    || /time(d)?\s?out|délai/i.test(message)) return 'timeout';
  return 'error';
}

function providerModel(provider, req) {
  try {
    if (typeof provider.resolveModel === 'function') return provider.resolveModel(req?.model);
  } catch { /* modèle non résoluble : défaut */ }
  return req?.model || provider.defaultModel || null;
}

/**
 * Instrumente chaque fournisseur (`complete`) : compteur par issue + durée.
 * Idempotent. Le fournisseur reste inchangé fonctionnellement.
 */
export function instrumentProviders(providers) {
  for (const [id, provider] of Object.entries(providers || {})) {
    if (!provider || typeof provider.complete !== 'function' || provider.__kayrosMetrics) continue;
    const original = provider.complete.bind(provider);
    const provLabel = providerLabel(id);
    provider.complete = async (req, ...rest) => {
      const t0 = process.hrtime.bigint();
      const seconds = () => Number(process.hrtime.bigint() - t0) / 1e9;
      try {
        const res = await original(req, ...rest);
        llmCalls.inc({ provider: provLabel, model: modelLabel(res?.model || providerModel(provider, req)), outcome: 'success' });
        llmCallDuration.observe({ provider: provLabel, outcome: 'success' }, seconds());
        return res;
      } catch (error) {
        const outcome = classifyLlmError(error);
        llmCalls.inc({ provider: provLabel, model: modelLabel(providerModel(provider, req)), outcome });
        llmCallDuration.observe({ provider: provLabel, outcome }, seconds());
        throw error;
      }
    };
    Object.defineProperty(provider, '__kayrosMetrics', { value: true });
  }
  return providers;
}

/** Instrumente la façade KayrosLLM : issue de bout en bout et replis (`degraded`). */
export function instrumentLlm(llm) {
  if (!llm || typeof llm.complete !== 'function' || llm.__kayrosMetrics) return llm;
  const original = llm.complete.bind(llm);
  llm.complete = async (...args) => {
    let res;
    try {
      res = await original(...args);
    } catch (error) {
      llmRequests.inc({ outcome: 'failed' });
      throw error;
    }
    recordLlmResult(res);
    return res;
  };
  Object.defineProperty(llm, '__kayrosMetrics', { value: true });
  return llm;
}

export function recordLlmResult(res) {
  const degraded = res?.degraded;
  if (!degraded) { llmRequests.inc({ outcome: 'success' }); return; }
  llmRequests.inc({ outcome: 'degraded' });
  const reason = degraded.reason === 'provider_fallback' || degraded.reason === 'quant_tag_unavailable' ? degraded.reason : 'other';
  // quant_tag_unavailable : même fournisseur, `from`/`to` sont des tags de modèle.
  const from = providerLabel(reason === 'quant_tag_unavailable' ? degraded.provider : degraded.from);
  const to = reason === 'quant_tag_unavailable' ? from : providerLabel(degraded.to);
  llmFallbacks.inc({ from, to, reason });
  if (to === 'mock') llmLastMockFallback.set(Date.now() / 1000);
}

/** Publie le fournisseur primaire effectif (cf. resolveLlmConfig). */
export function setLlmPrimary(llmConfig) {
  if (!llmConfig) return;
  llmPrimaryInfo.reset();
  const provider = providerLabel(llmConfig.provider);
  const model = provider === 'nvidia' ? llmConfig.nvidia?.model : llmConfig.models?.[provider];
  llmPrimaryInfo.set({ provider, model: modelLabel(model || 'default') }, 1);
}

// --- Missions console --------------------------------------------------------

function runKind(kind) { return kind === 'continue' ? 'continue' : 'message'; }

/** Statut final d'un fil → issue de métrique. */
export function runOutcomeFromThread(thread) {
  const status = thread?.status;
  if (status === 'needs_clarification') return 'needs_clarification';
  if (status === 'failed') return /délai maximal/i.test(String(thread?.error || '')) ? 'timeout' : 'failed';
  if (status === 'awaiting_arbitration' || status === 'resolved') return 'completed';
  return null; // fil repris par une autre exécution : non compté
}

/**
 * Observateur branché sur HybridAgentGateway (option `runObserver`).
 * `started()` renvoie un jeton passé à `finished()`.
 */
export const consoleRunObserver = Object.freeze({
  started({ kind } = {}) {
    const token = ++runSeq;
    runningStarts.set(token, Date.now());
    consoleRunsInProgress.inc();
    return { token, kind: runKind(kind) };
  },
  finished(handle, { thread = null, error = null } = {}) {
    if (!handle || !runningStarts.has(handle.token)) return;
    const startedAt = runningStarts.get(handle.token);
    runningStarts.delete(handle.token);
    consoleRunsInProgress.dec();
    let outcome = runOutcomeFromThread(thread);
    if (!outcome && error) outcome = /délai maximal/i.test(String(error?.message || '')) ? 'timeout' : 'failed';
    if (!outcome) return;
    const labels = { kind: handle.kind, outcome };
    consoleRuns.inc(labels);
    consoleRunDuration.observe(labels, (Date.now() - startedAt) / 1000);
  },
});

export function recordInterruptedRuns(count) {
  const n = Number(count) || 0;
  if (n > 0) consoleRunsInterrupted.inc(n);
}

// --- Accès à /metrics --------------------------------------------------------

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const PROXY_HEADERS = ['x-forwarded-for', 'x-real-ip', 'forwarded'];

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Hook onRequest protégeant /metrics :
 *   - METRICS_TOKEN défini → `Authorization: Bearer <jeton>` exigé (401 sinon) ;
 *   - sinon → loopback direct uniquement (403 pour toute requête distante ou
 *     relayée par le reverse proxy, qui ajoute X-Real-IP / X-Forwarded-For).
 */
export function metricsAccessHook({ token = '' } = {}) {
  const expected = String(token || '').trim();
  return async function metricsAccess(req, reply) {
    if (expected) {
      const header = String(req.headers.authorization || '');
      const match = /^Bearer\s+(.+)$/i.exec(header);
      if (!match || !safeEqual(match[1].trim(), expected)) {
        return reply.code(401).header('www-authenticate', 'Bearer').send({ error: 'non autorise' });
      }
      return undefined;
    }
    const remote = req.socket?.remoteAddress || req.raw?.socket?.remoteAddress || '';
    const proxied = PROXY_HEADERS.some((h) => req.headers[h] !== undefined);
    if (!LOOPBACK.has(remote) || proxied) {
      return reply.code(403).send({ error: 'metriques reservees au reseau local (definir METRICS_TOKEN pour un acces distant)' });
    }
    return undefined;
  };
}

/** Options `endpoint` de fastify-metrics avec le contrôle d'accès. */
export function metricsEndpoint(env = process.env) {
  return {
    url: '/metrics',
    method: 'GET',
    logLevel: 'warn',
    exposeHeadRoute: false,
    onRequest: metricsAccessHook({ token: env.METRICS_TOKEN }),
  };
}

export { register as metricsRegister };
