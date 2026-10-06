// KayrosLab — Abstraction LLM (KayrosLLM) + adaptateurs.
// Quant soft-fallback: strip quant suffix → retry → policy fallback (mock).

import { CircuitBreaker, withResilience, parseRetryAfter } from './resilience.mjs';
import {
  resolveModelTag, recommendQuant, parseQuantFromTag, stripQuantFromTag, normalizeRole,
} from './quant-guidance.mjs';

const approxTokens = (s) => Math.max(1, Math.round((s || '').length / 4));

export class MockProvider {
  constructor(id = 'mock') { this.id = id; }
  async complete(req) {
    const last = req.messages[req.messages.length - 1]?.content ?? '';
    const tokensIn = req.messages.reduce((n, m) => n + approxTokens(m.content), 0);
    const text = `[${this.id}] (${req.role ?? 'agent'}) reponse simulee a: ${last.slice(0, 120)}`;
    return { text, usage: { tokensIn, tokensOut: approxTokens(text), costUsd: 0 }, provider: this.id, latencyMs: 1 };
  }
}

export class AnthropicProvider {
  constructor({ callBackend } = {}) { this.id = 'anthropic'; this._callBackend = callBackend; }
  async complete(req) {
    if (!this._callBackend) { const e = new Error('AnthropicProvider non configure (backend requis)'); e.code = 'NOT_CONFIGURED'; throw e; }
    return this._callBackend(req);
  }
}

export class OllamaProvider {
  constructor({ endpoint = 'http://localhost:11434', defaultModel = 'llama3.2', fetchImpl } = {}) {
    this.id = 'ollama'; this.endpoint = endpoint; this.defaultModel = defaultModel; this._fetch = fetchImpl;
  }
  _f() {
    const f = this._fetch ?? (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) { const e = new Error('OllamaProvider: fetch indisponible (fournir fetchImpl)'); e.code = 'NO_FETCH'; throw e; }
    return f;
  }
  async listModels() {
    const res = await this._f()(`${this.endpoint}/api/tags`);
    const data = await res.json();
    return (data?.models ?? []).map((m) => m.name);
  }
  async complete(req) {
    const res = await this._f()(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: req.model ?? this.defaultModel,
        messages: req.messages,
        stream: false,
        ...(typeof req.think === 'boolean' ? { think: req.think } : {}),
        options: typeof req.temperature === 'number' ? { temperature: req.temperature } : undefined,
      }),
    });
    if (!res.ok) {
      const e = new Error(`Ollama HTTP ${res.status}`); e.code = res.status === 429 ? 'RATE_LIMITED' : 'OLLAMA_HTTP'; e.status = res.status;
      const ra = parseRetryAfter(res.headers?.get?.('retry-after')); if (ra !== null) e.retryAfterMs = ra;
      throw e;
    }
    const data = await res.json();
    const text = data?.message?.content ?? '';
    return {
      text,
      usage: { tokensIn: data?.prompt_eval_count ?? 0, tokensOut: data?.eval_count ?? 0, costUsd: 0 },
      provider: this.id, latencyMs: data?.total_duration ? Math.round(data.total_duration / 1e6) : 0,
    };
  }
}

const REASONING_TAGS = 'think|thinking|reasoning';

/**
 * Retire les blocs de raisonnement (`<think>…</think>`, `<thinking>`,
 * `<reasoning>`) d'une complétion avant tout parsing (verdict JSON du swarm).
 * Gère aussi la balise fermante orpheline (gabarit qui ouvre `<think>` côté
 * prompt) et la balise ouvrante non refermée (sortie tronquée). Sans balise,
 * le texte est rendu tel quel.
 */
export function stripReasoning(text) {
  const src = String(text ?? '');
  if (!new RegExp(`</?(?:${REASONING_TAGS})>`, 'i').test(src)) return src;
  let out = src.replace(new RegExp(`<(${REASONING_TAGS})>[\\s\\S]*?</\\1>`, 'gi'), '');
  const closeRe = new RegExp(`</(?:${REASONING_TAGS})>`, 'gi');
  let lastClose = null; let m;
  while ((m = closeRe.exec(out))) lastClose = m;
  if (lastClose) out = out.slice(lastClose.index + lastClose[0].length);
  const open = new RegExp(`<(?:${REASONING_TAGS})>`, 'i').exec(out);
  if (open) out = out.slice(0, open.index);
  return out.trim();
}

/**
 * Provider générique « chat/completions » compatible OpenAI (NVIDIA NIM,
 * Mistral…). La clé n'est jamais journalisée ni recopiée dans une erreur.
 * Un 429 lève `{ status: 429, code: 'RATE_LIMITED', retryAfterMs }` :
 * KayrosLLM/withResilience relance alors avec backoff + Retry-After.
 * `reasoning_content` (modèles à raisonnement) est ignoré, et les blocs
 * `<think>` éventuels sont retirés de `content`.
 */
export class OpenAICompatibleProvider {
  constructor({
    id = 'openai-compatible', baseUrl, apiKey = '', apiKeyEnv = 'API_KEY', defaultModel,
    temperature = null, defaultTemperature = 0.4, maxTokens = 1200, extraBody = null,
    timeoutMs = 0, fetchImpl, acceptsModel = null,
  } = {}) {
    if (!baseUrl) throw new Error(`${id}: baseUrl requis`);
    this.id = id;
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.defaultModel = defaultModel;
    this.temperature = temperature;
    this.defaultTemperature = defaultTemperature;
    this.maxTokens = maxTokens;
    this.extraBody = extraBody && typeof extraBody === 'object' ? extraBody : null;
    this.timeoutMs = Number(timeoutMs) || 0;
    this._apiKeyEnv = apiKeyEnv;
    this._fetch = fetchImpl;
    // Les agents de l'orchestrateur portent un tag Ollama quantifié
    // (`llama3.2:q5_K_M`) : un fournisseur distant le refuserait (400/404) et
    // tout partirait en repli. Un modèle non reconnu cède la place au défaut.
    this._acceptsModel = typeof acceptsModel === 'function' ? acceptsModel : (m) => !String(m).includes(':');
    // Non énumérable : la clé n'apparaît ni dans un JSON.stringify ni dans un log de l'objet.
    Object.defineProperty(this, '_apiKey', { value: String(apiKey || ''), enumerable: false });
  }
  get configured() { return !!this._apiKey; }
  _f() {
    const f = this._fetch ?? (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) { const e = new Error(`${this.id}: fetch indisponible (fournir fetchImpl)`); e.code = 'NO_FETCH'; throw e; }
    return f;
  }
  resolveModel(model) {
    return model && this._acceptsModel(model) ? model : this.defaultModel;
  }
  buildBody(req) {
    const messages = (req.messages || []).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
      content: String(m.content ?? ''),
    }));
    const temperature = typeof this.temperature === 'number'
      ? this.temperature
      : (typeof req.temperature === 'number' ? req.temperature : this.defaultTemperature);
    return {
      ...(this.extraBody || {}),
      model: this.resolveModel(req.model),
      messages,
      temperature,
      max_tokens: this.maxTokens,
      stream: false,
    };
  }
  async complete(req) {
    if (!this._apiKey) { const e = new Error(`${this._apiKeyEnv} non configuree`); e.code = 'NO_KEY'; throw e; }
    const body = this.buildBody(req);
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${this._apiKey}` },
      body: JSON.stringify(body),
    };
    if (this.timeoutMs > 0 && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      init.signal = AbortSignal.timeout(this.timeoutMs);
    }
    const t0 = Date.now();
    const res = await this._f()(`${this.baseUrl}/chat/completions`, init);
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const e = new Error(`${this.id} http ${res.status}`);
      e.status = res.status;
      e.code = res.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_HTTP';
      const ra = parseRetryAfter(res.headers?.get?.('retry-after'));
      if (ra !== null) e.retryAfterMs = ra;
      e.detail = data;
      throw e;
    }
    const choice = data?.choices?.[0] || {};
    const rawContent = choice.message?.content;
    const content = typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent) ? rawContent.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('') : '';
    const text = stripReasoning(content);
    const reasoning = choice.message?.reasoning_content ?? choice.message?.reasoning ?? null;
    if (!text.trim() && reasoning) {
      // Le budget de jetons a été consommé par le raisonnement : relancer à
      // l'identique ne changerait rien, le repli (signalé) prend la main.
      const e = new Error(`${this.id}: réponse vide (raisonnement seul, finish_reason=${choice.finish_reason || 'n/a'})`);
      e.code = 'EMPTY_COMPLETION';
      e.retryable = false;
      throw e;
    }
    return {
      text,
      provider: this.id,
      model: data?.model || body.model,
      finishReason: choice.finish_reason || null,
      latencyMs: Date.now() - t0,
      usage: {
        tokensIn: data?.usage?.prompt_tokens ?? 0,
        tokensOut: data?.usage?.completion_tokens ?? 0,
        costUsd: 0,
      },
    };
  }
}

export class HttpBackendProvider {
  constructor({ url, provider = 'anthropic', secret, fetchImpl } = {}) {
    if (!url) throw new Error('HttpBackendProvider: url requis');
    this.id = 'backend'; this.url = url; this.provider = provider; this.secret = secret; this._fetch = fetchImpl;
  }
  _f() {
    const f = this._fetch ?? (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) { const e = new Error('HttpBackendProvider: fetch indisponible'); e.code = 'NO_FETCH'; throw e; }
    return f;
  }
  async complete(req) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.secret) headers['X-Kayros-Secret'] = this.secret;
    const res = await this._f()(this.url, {
      method: 'POST', headers,
      body: JSON.stringify({ messages: req.messages, model: req.model, provider: req.provider ?? this.provider, role: req.role, temperature: req.temperature }),
    });
    if (!res.ok) { const e = new Error(`Backend HTTP ${res.status}`); e.code = 'BACKEND_HTTP'; throw e; }
    const d = await res.json();
    if (d?.error) { const e = new Error(`Backend: ${d.error}`); e.code = 'BACKEND_ERROR'; throw e; }
    return {
      text: d.text ?? '',
      usage: { tokensIn: d.usage?.tokensIn ?? 0, tokensOut: d.usage?.tokensOut ?? 0, costUsd: d.usage?.costUsd ?? 0 },
      provider: d.provider ?? this.id, latencyMs: d.latencyMs ?? 0,
    };
  }
}

export class RoutingPolicy {
  constructor({
    roleModel = {},
    defaultProvider = 'anthropic',
    fallback = 'mock',
    roleQuant = {},
    defaultQuant = null,
    preferHigherQuant = false,
    availableModels = null,
  } = {}) {
    this.roleModel = roleModel;
    this.defaultProvider = defaultProvider;
    this.fallback = fallback;
    this.roleQuant = roleQuant;
    this.defaultQuant = defaultQuant;
    this.preferHigherQuant = preferHigherQuant;
    this.availableModels = availableModels;
  }

  choose(req, opts = {}) {
    if (opts.provider) return opts.provider;
    if (opts.sovereignty === 'local') return 'ollama';
    return this.defaultProvider;
  }

  modelFor(req, opts = {}) {
    const base = req.model ?? this.roleModel[req.role] ?? this.roleModel[normalizeRole(req.role)] ?? undefined;
    if (!base) return undefined;

    if (parseQuantFromTag(base)) return base;

    const role = normalizeRole(req.role || 'default');
    const prefer = this.roleQuant[role]
      || this.roleQuant[req.role]
      || this.defaultQuant
      || opts.quant
      || null;
    if (!prefer && !this.preferHigherQuant) return base;

    const rec = recommendQuant({
      role,
      prefer,
      preferHigher: this.preferHigherQuant || !!opts.preferHigherQuant,
    });
    const available = opts.availableModels || this.availableModels || null;
    return resolveModelTag(base, rec.quant, available);
  }
}

export class KayrosLLM {
  constructor(providers, policy = new RoutingPolicy(), { breakerConfig, retry } = {}) {
    this.providers = providers;
    this.policy = policy;
    this._breakers = new Map();
    this._breakerConfig = breakerConfig ?? { failureThreshold: 3, coolDownMs: 30000 };
    // Politique de relance (backoff exponentiel + jitter, Retry-After des 429)
    // appliquée à chaque provider ; undefined = défauts de withResilience.
    this.retry = retry;
  }
  _breakerFor(id) {
    if (!this._breakers.has(id)) this._breakers.set(id, new CircuitBreaker(this._breakerConfig));
    return this._breakers.get(id);
  }

  async complete(req, opts = {}) {
    const primaryId = this.policy.choose(req, opts);
    const model = this.policy.modelFor(req, opts);
    const attempt = async (id, modelOverride) => {
      const p = this.providers[id];
      if (!p) { const e = new Error(`Provider inconnu: ${id}`); e.code = 'UNKNOWN_PROVIDER'; throw e; }
      const breaker = this._breakerFor(id);
      return withResilience(
        () => p.complete({ ...req, model: modelOverride !== undefined ? modelOverride : model }),
        breaker,
        this.retry,
      );
    };

    try {
      return await attempt(primaryId, model);
    } catch (primaryErr) {
      const quant = model ? parseQuantFromTag(model) : null;
      // Strip quant for any provider that might reject unknown tags (ollama + backend)
      if (quant) {
        const baseTag = stripQuantFromTag(model);
        if (baseTag && baseTag !== model) {
          try {
            const res = await attempt(primaryId, baseTag);
            return {
              ...res,
              degraded: {
                reason: 'quant_tag_unavailable',
                from: model,
                to: baseTag,
                provider: primaryId,
              },
            };
          } catch { /* continue */ }
        }
      }

      // Chaîne de repli : un id (historique) ou une liste ordonnée, ex.
      // ['mistral', 'mock'] quand NVIDIA est primaire. Tout repli est signalé.
      const chain = Array.isArray(this.policy.fallback) ? this.policy.fallback : [this.policy.fallback];
      const errors = [{ provider: primaryId, error: primaryErr?.message || String(primaryErr) }];
      for (const fb of chain) {
        if (!fb || fb === primaryId || !this.providers[fb]) continue;
        try {
          // Le modèle demandé appartient au primaire : un provider de repli
          // (autre fournisseur) prend son propre modèle par défaut.
          const res = await attempt(fb, fb === 'mock' ? model : undefined);
          return {
            ...res,
            degraded: {
              reason: 'provider_fallback',
              from: primaryId,
              to: fb,
              modelAttempted: model || null,
              error: primaryErr?.message || String(primaryErr),
              ...(errors.length > 1 ? { chain: errors } : {}),
            },
          };
        } catch (fbErr) {
          errors.push({ provider: fb, error: fbErr?.message || String(fbErr) });
        }
      }
      throw primaryErr;
    }
  }
}
