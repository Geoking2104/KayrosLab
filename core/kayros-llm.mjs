// KayrosLab — Abstraction LLM (`KayrosLLM`) + adaptateurs.
// Réf. specs techniques §5 (EF-24/25/26). Le code métier ne connaît jamais le fournisseur.

import { CircuitBreaker, withResilience } from './resilience.mjs';

/**
 * @typedef {{role:'system'|'user'|'assistant'|'tool', content:string}} LLMMessage
 * @typedef {{messages:LLMMessage[], model?:string, tools?:any[], temperature?:number, stream?:boolean, role?:string}} LLMRequest
 * @typedef {{text:string, toolCalls?:{name:string,input:any}[], usage:{tokensIn:number,tokensOut:number,costUsd:number}, provider:string, latencyMs:number}} LLMResponse
 */

const approxTokens = (s) => Math.max(1, Math.round((s || '').length / 4));

/** Adaptateur simulé, déterministe (aucun réseau). Sert de défaut et de fallback. */
export class MockProvider {
  constructor(id = 'mock') { this.id = id; }
  /** @param {LLMRequest} req @returns {Promise<LLMResponse>} */
  async complete(req) {
    const last = req.messages[req.messages.length - 1]?.content ?? '';
    const tokensIn = req.messages.reduce((n, m) => n + approxTokens(m.content), 0);
    const text = `【${this.id}】(${req.role ?? 'agent'}) réponse simulée à: ${last.slice(0, 120)}`;
    return {
      text,
      usage: { tokensIn, tokensOut: approxTokens(text), costUsd: 0 },
      provider: this.id,
      latencyMs: 1,
    };
  }
}

/** Squelette d'adaptateur Anthropic (à brancher en P2 côté backend, jamais de clé au client). */
export class AnthropicProvider {
  constructor({ callBackend } = {}) { this.id = 'anthropic'; this._callBackend = callBackend; }
  async complete(req) {
    if (!this._callBackend) { const e = new Error('AnthropicProvider non configuré (backend requis)'); e.code = 'NOT_CONFIGURED'; throw e; }
    return this._callBackend(req); // le backend proxie l'appel réel (clé côté serveur)
  }
}

/** Squelette d'adaptateur Ollama (local / souverain). */
export class OllamaProvider {
  constructor({ endpoint = 'http://localhost:11434', fetchImpl } = {}) {
    this.id = 'ollama'; this.endpoint = endpoint; this._fetch = fetchImpl;
  }
  async complete(req) {
    const f = this._fetch ?? (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) { const e = new Error('OllamaProvider: fetch indisponible'); e.code = 'NO_FETCH'; throw e; }
    const res = await f(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: req.model ?? 'llama3.1', messages: req.messages, stream: false }),
    });
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
 * Politique de routage : souveraineté > rôle > défaut, avec fallback.
 * EF-26 : `sovereignty:'local'` force Ollama.
 */
export class RoutingPolicy {
  constructor({ roleModel = {}, defaultProvider = 'anthropic', fallback = 'mock' } = {}) {
    this.roleModel = roleModel; this.defaultProvider = defaultProvider; this.fallback = fallback;
  }
  choose(req, opts = {}) {
    if (opts.sovereignty === 'local') return 'ollama';
    return this.defaultProvider;
  }
  modelFor(req) { return req.model ?? this.roleModel[req.role] ?? undefined; }
}

/** Façade unique. Le métier appelle `complete()` sans connaître le fournisseur. */
export class KayrosLLM {
  /** @param {Record<string, {complete:Function}>} providers @param {RoutingPolicy} policy */
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
  /** @param {LLMRequest} req @returns {Promise<LLMResponse>} */
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
