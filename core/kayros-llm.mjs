// KayrosLab — Abstraction LLM (KayrosLLM) + adaptateurs.
// Quant soft-fallback: strip quant suffix → retry → policy fallback (mock).

import { CircuitBreaker, withResilience } from './resilience.mjs';
import { resolveModelTag, recommendQuant, parseQuantFromTag, stripQuantFromTag } from './quant-guidance.mjs';

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
    if (!res.ok) { const e = new Error(`Ollama HTTP ${res.status}`); e.code = 'OLLAMA_HTTP'; throw e; }
    const data = await res.json();
    const text = data?.message?.content ?? '';
    return {
      text,
      usage: { tokensIn: data?.prompt_eval_count ?? 0, tokensOut: data?.eval_count ?? 0, costUsd: 0 },
      provider: this.id, latencyMs: data?.total_duration ? Math.round(data.total_duration / 1e6) : 0,
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
  } = {}) {
    this.roleModel = roleModel;
    this.defaultProvider = defaultProvider;
    this.fallback = fallback;
    this.roleQuant = roleQuant;
    this.defaultQuant = defaultQuant;
    this.preferHigherQuant = preferHigherQuant;
  }

  choose(req, opts = {}) {
    if (opts.provider) return opts.provider;
    if (opts.sovereignty === 'local') return 'ollama';
    return this.defaultProvider;
  }

  modelFor(req, opts = {}) {
    const base = req.model ?? this.roleModel[req.role] ?? undefined;
    if (!base) return undefined;

    if (parseQuantFromTag(base)) return base;

    const role = req.role || 'default';
    const prefer = this.roleQuant[role] || this.defaultQuant || opts.quant || null;
    if (!prefer && !this.preferHigherQuant) return base;

    const rec = recommendQuant({
      role,
      prefer,
      preferHigher: this.preferHigherQuant || !!opts.preferHigherQuant,
    });
    return resolveModelTag(base, rec.quant);
  }
}

export class KayrosLLM {
  constructor(providers, policy = new RoutingPolicy(), { breakerConfig } = {}) {
    this.providers = providers;
    this.policy = policy;
    this._breakers = new Map();
    this._breakerConfig = breakerConfig ?? { failureThreshold: 3, coolDownMs: 30000 };
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
      );
    };

    // 1) Primary provider + resolved model (often quant-suffixed)
    try {
      return await attempt(primaryId, model);
    } catch (primaryErr) {
      // 2) Soft quant fallback: strip quant suffix and retry same provider once
      const quant = model ? parseQuantFromTag(model) : null;
      if (quant && primaryId === 'ollama') {
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
          } catch { /* continue to policy fallback */ }
        }
      }

      // 3) Policy fallback (mock)
      const fb = this.policy.fallback;
      if (fb && fb !== primaryId && this.providers[fb]) {
        const res = await attempt(fb, model);
        return {
          ...res,
          degraded: {
            reason: 'provider_fallback',
            from: primaryId,
            to: fb,
            modelAttempted: model || null,
            error: primaryErr?.message || String(primaryErr),
          },
        };
      }
      throw primaryErr;
    }
  }
}
