// Sélection du fournisseur LLM du serveur (fonction pure, testable sans réseau).
//
// Ordre de priorité :
//   1. LLM_PROVIDER forcé (nvidia | mistral | anthropic | ollama | mock) ;
//      `auto` ou vide = sélection automatique. Un provider forcé sans sa clé
//      reste forcé (avertissement au démarrage) : chaque appel part en repli
//      signalé, jamais en silence.
//   2. NVIDIA_API_KEY présente  → nvidia
//   3. MISTRAL_API_KEY présente → mistral
//   4. ANTHROPIC_API_KEY        → anthropic
//   5. sinon                    → mock
// Repli (LLM_FALLBACK, liste séparée par des virgules, sinon automatique) :
// mistral si sa clé est là et qu'il n'est pas primaire, puis mock. Tout repli
// est porté par `degraded` dans la réponse (ENF-09).
//
// Aucune clé n'est renvoyée par cette fonction : seulement des booléens.

/**
 * Modèle NVIDIA par défaut. « DeepSeek V4 Pro » n'est plus servi par l'API
 * hébergée NVIDIA (integrate.api.nvidia.com) : /v1/models répond 410 Gone pour
 * deepseek-ai/deepseek-v4-pro (fin de vie 2026-08-07) et
 * deepseek-ai/deepseek-v4-pro-0813 (fin de vie 2026-09-14). Le seul DeepSeek
 * génératif encore au catalogue est deepseek-ai/deepseek-v4.1-flash.
 * Surcharger avec NVIDIA_MODEL.
 */
export const NVIDIA_DEFAULT_MODEL = 'deepseek-ai/deepseek-v4.1-flash';
export const NVIDIA_DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
/** Délai par défaut d'un appel NVIDIA (ms). Surcharger avec NVIDIA_TIMEOUT_MS. */
export const NVIDIA_DEFAULT_TIMEOUT_MS = 180000;
export const MISTRAL_DEFAULT_MODEL = 'mistral-small-latest';
export const KNOWN_LLM_PROVIDERS = Object.freeze(['nvidia', 'mistral', 'anthropic', 'ollama', 'mock']);
const KEYED = { nvidia: 'NVIDIA_API_KEY', mistral: 'MISTRAL_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };

const num = (value, fallback, { min = -Infinity, max = Infinity, integer = false } = {}) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = integer ? Math.floor(n) : n;
  return Math.min(max, Math.max(min, v));
};

function parseJsonObject(raw, name, warnings) {
  if (!raw || !String(raw).trim()) return null;
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch { /* signalé ci-dessous */ }
  warnings.push(`${name} ignoré : objet JSON attendu`);
  return null;
}

export function resolveLlmConfig(env = {}) {
  const warnings = [];
  const has = {
    nvidia: !!String(env.NVIDIA_API_KEY || '').trim(),
    mistral: !!String(env.MISTRAL_API_KEY || '').trim(),
    anthropic: !!String(env.ANTHROPIC_API_KEY || '').trim(),
  };
  const forcedRaw = String(env.LLM_PROVIDER || '').trim().toLowerCase();
  let provider = null;
  let forced = false;
  if (forcedRaw && forcedRaw !== 'auto') {
    if (KNOWN_LLM_PROVIDERS.includes(forcedRaw)) {
      provider = forcedRaw; forced = true;
      if (KEYED[provider] && !has[provider]) {
        warnings.push(`LLM_PROVIDER=${provider} mais ${KEYED[provider]} est vide : réponses en repli (signalé)`);
      }
    } else {
      warnings.push(`LLM_PROVIDER=${forcedRaw} inconnu (attendu : ${KNOWN_LLM_PROVIDERS.join(', ')}, auto) : sélection automatique`);
    }
  }
  if (!provider) {
    provider = has.nvidia ? 'nvidia' : has.mistral ? 'mistral' : has.anthropic ? 'anthropic' : 'mock';
  }

  let fallback;
  const fbRaw = String(env.LLM_FALLBACK || '').trim();
  if (fbRaw) {
    fallback = [...new Set(fbRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))]
      .filter((id) => {
        if (KNOWN_LLM_PROVIDERS.includes(id)) return true;
        warnings.push(`LLM_FALLBACK : provider inconnu ignoré (${id})`);
        return false;
      })
      .filter((id) => id !== provider);
    if (!fallback.includes('mock')) fallback.push('mock');
  } else {
    fallback = [];
    if (has.mistral && provider !== 'mistral') fallback.push('mistral');
    fallback.push('mock');
  }
  if (provider === 'mock') fallback = fallback.filter((id) => id !== 'mock');

  const models = {
    nvidia: String(env.NVIDIA_MODEL || '').trim() || NVIDIA_DEFAULT_MODEL,
    mistral: String(env.MISTRAL_MODEL || '').trim() || MISTRAL_DEFAULT_MODEL,
    anthropic: String(env.ANTHROPIC_MODEL || '').trim() || 'claude-3-5-sonnet-latest',
    ollama: String(env.OLLAMA_MODEL || '').trim() || 'llama3.2',
    mock: null,
  };
  const temperatureRaw = String(env.NVIDIA_TEMPERATURE ?? '').trim();
  const nvidia = {
    baseUrl: String(env.NVIDIA_BASE_URL || '').trim().replace(/\/+$/, '') || NVIDIA_DEFAULT_BASE_URL,
    model: models.nvidia,
    configured: has.nvidia,
    // null = température de la requête (agents : 0.3), sinon valeur imposée.
    temperature: temperatureRaw === '' ? null : num(temperatureRaw, null, { min: 0, max: 2 }),
    maxTokens: num(env.NVIDIA_MAX_TOKENS, 4096, { min: 1, max: 1048576, integer: true }),
    // Délai par appel : 180 s laissent passer un modèle à raisonnement lent
    // (Kimi K3 ≈ 75 s par réponse d'agent, pointes > 120 s). Les missions
    // console étant asynchrones, ce délai n'est plus borné par le proxy (≈ 60 s).
    timeoutMs: num(env.NVIDIA_TIMEOUT_MS, NVIDIA_DEFAULT_TIMEOUT_MS, { min: 0, integer: true }),
    extraBody: parseJsonObject(env.NVIDIA_EXTRA_BODY, 'NVIDIA_EXTRA_BODY', warnings),
  };

  return {
    provider,
    forced,
    live: provider === 'ollama' || (KEYED[provider] ? has[provider] : false),
    model: models[provider],
    fallback,
    configured: has,
    models,
    nvidia,
    maxConcurrency: num(env.LLM_MAX_CONCURRENCY, 2, { min: 1, max: 32, integer: true }),
    retry: {
      maxRetries: num(env.LLM_MAX_RETRIES, 2, { min: 0, max: 10, integer: true }),
      baseMs: num(env.LLM_RETRY_BASE_MS, 1000, { min: 0, integer: true }),
      factor: 2,
      jitter: true,
      maxMs: num(env.LLM_RETRY_MAX_DELAY_MS, 20000, { min: 0, integer: true }),
      maxRetryAfterMs: num(env.LLM_RETRY_MAX_DELAY_MS, 20000, { min: 0, integer: true }),
    },
    warnings,
  };
}

/** Résumé sans secret pour /health et les logs de démarrage. */
export function describeLlmConfig(cfg) {
  return {
    provider: cfg.provider,
    forced: cfg.forced,
    live: cfg.live,
    model: cfg.model,
    fallback: cfg.fallback,
    baseUrl: cfg.provider === 'nvidia' ? cfg.nvidia.baseUrl : undefined,
    maxConcurrency: cfg.maxConcurrency,
    maxRetries: cfg.retry.maxRetries,
  };
}
