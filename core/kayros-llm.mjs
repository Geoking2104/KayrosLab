// KayrosLab — Abstraction LLM (KayrosLLM) + adaptateurs.
// Ref. specs techniques §5 (EF-24/25/26). Le code metier ne connait jamais le fournisseur.

import { CircuitBreaker, withResilience } from './resilience.mjs';

/**
 * @typedef {{role:'system'|'user'|'assistant'|'tool', content:string}} LLMMessage
 * @typedef {{messages:LLMMessage[], model?:string, tools?:any[], temperature?:number, stream?:boolean, role?:string}} LLMRequest
 * @typedef {{text:string, toolCalls?:{name:string,input:any}[], usage:{tokensIn:number,tokensOut:number,costUsd:number}, provider:string, latencyMs:number}} LLMResponse
 */

const approxTokens = (s) => Math.max(1, Math.round((s || '').length / 4));

/** Adaptateur simule, deterministe (aucun reseau). Sert de defaut et de fallback. */
export class MockProvider {
  constructor(id = 'mock') { this.id = id; }
  async complete(req) {
    const last = req.messages[req.messages.length - 1]?.content ?? '';
    const tokensIn = req.messages.reduce((n, m) => n + approxTokens(m.content), 0);
    const text = `[${this.id}] (${req.role ?? 'agent'}) reponse simulee a: ${last.slice(0, 120)}`;
    return { text, usage: { tokensIn, tokensOut: approxTokens(text), costUsd: 0 }, provider: this.id, latencyMs: 1 };
  }
}

/** Squelette d'adaptateur Anthropic (a brancher cote backend, jamais de cle au client). */
export class AnthropicProvider {
  constructor({ callBackend } = {}) { this.id = 'anthropic'; this._callBackend = callBackend; }
  async complete(req) {
    if (!this._callBackend) { const e = new Error('AnthropicProvider non configure (backend requis)'); e.code = 'NOT_CONFIGURED'; throw e; }
    return this._callBackend(req);
  }
}

/** Adaptateur Ollama (local / souverain). Fonctionne contre un vrai serveur Ollama. */
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

/**
 * Adaptateur backend HTTP : le navigateur (ou tout client) appelle le proxy KayrosLab
 * (PHP mutualise OU Fastify) qui detient la cle et relaie vers Claude/Ollama.
 * POST { messages, model, provider, role, temperature } -> { text, provider, usage }.
 */
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

/**
 * Politique de routage : override explicite > souverainete > defaut, avec fallback.
 * EF-26 : sovereignty='local' force Ollama ; opts.provider force un fournisseur precis.
 */
export class RoutingPolicy {
  constructor({ roleModel = {}, defaultProvider = 'anthropic', fallback = 'mock' } = {}) {
    this.roleModel = roleModel; this.defaultProvider = defaultProvider; this.fallback = fallback;
  }
  choose(req, opts = {}) {
    if (opts.provider) return opts.provider;
    if (opts.sovereignty === 'local') return 'ollama';
    return this.defaultProvider;
  }
  modelFor(req) { return req.model ?? this.roleModel[req.role] ?? undefined; }
}

/** Facade unique. Le metier appelle complete() sans connaitre le fournisseur. */
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
    const model = this.policy.modelFor(req);
    const attempt = async (id) => {
      const p = this.providers[id];
      if (!p) { const e = new Error(`Provider inconnu: ${id}`); e.code = 'UNKNOWN_PROVIDER'; throw e; }
      const breaker = this._breakerFor(id);
      return withResilience(() => p.complete({ ...req, model }), breaker);
    };
    try {
      return await attempt(primaryId);
    } catch (e) {
      const fb = this.policy.fallback;
      if (fb && fb !== primaryId && this.providers[fb]) return attempt(fb);
      throw e;
    }
  }
}
