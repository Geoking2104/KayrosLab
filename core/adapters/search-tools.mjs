// KayrosLab — Configurable search tools (V16).
// Providers: Google CSE, DuckDuckGo (default free), Brave, Tavily.

import { WebScanner } from '../positionning/scanner-web.mjs';

export function loadSearchConfigFromEnv(env = typeof process !== 'undefined' ? process.env : {}) {
  return {
    googleApiKey: env.GOOGLE_API_KEY || '',
    googleCx: env.GOOGLE_CX || '',
    braveApiKey: env.BRAVE_API_KEY || '',
    tavilyApiKey: env.TAVILY_API_KEY || '',
    githubToken: env.GITHUB_TOKEN || '',
    gitlabToken: env.GITLAB_TOKEN || '',
    gitlabBaseUrl: env.GITLAB_BASE_URL || 'https://gitlab.com',
    preferredWebProvider: env.KAYROS_SEARCH_PROVIDER || 'auto',
    defaultLimit: Number(env.KAYROS_SEARCH_LIMIT || 5) || 5,
  };
}

export class ConfigurableWebSearch {
  constructor(cfg = {}) {
    this.cfg = { ...loadSearchConfigFromEnv(), ...cfg };
    this._fetch = cfg.fetchImpl ?? globalThis.fetch;
    this.webScanner = new WebScanner({
      googleApiKey: this.cfg.googleApiKey,
      googleCx: this.cfg.googleCx,
      fetchImpl: this._fetch,
    });
  }

  async search(query, opts = {}) {
    const q = String(query ?? '').trim();
    if (!q) return [];
    const limit = opts.limit ?? this.cfg.defaultLimit ?? 5;
    const provider = opts.provider || this.cfg.preferredWebProvider || 'auto';

    const tryOrder = provider === 'auto'
      ? ['tavily', 'brave', 'google', 'duckduckgo']
      : [provider];

    const errors = [];
    for (const p of tryOrder) {
      try {
        if (p === 'tavily' && this.cfg.tavilyApiKey) {
          return await this._searchTavily(q, limit);
        }
        if (p === 'brave' && this.cfg.braveApiKey) {
          return await this._searchBrave(q, limit);
        }
        if (p === 'google' && this.cfg.googleApiKey && this.cfg.googleCx) {
          return await this.webScanner.search(q, { limit, provider: 'google' });
        }
        if (p === 'duckduckgo') {
          return await this.webScanner.search(q, { limit, provider: 'duckduckgo' });
        }
      } catch (e) {
        errors.push(`${p}: ${e.message || e}`);
        if (provider !== 'auto') throw e;
      }
    }
    try {
      return await this.webScanner.search(q, { limit });
    } catch (e) {
      errors.push(`duckduckgo: ${e.message || e}`);
      const err = new Error(`search failed: ${errors.join('; ')}`);
      err.code = 'SEARCH_FAILED';
      err.details = errors;
      throw err;
    }
  }

  async _searchBrave(q, limit) {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${Math.min(limit, 20)}`;
    const res = await this._fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': this.cfg.braveApiKey,
      },
    });
    if (!res.ok) throw new Error(`Brave Search API: ${res.status}`);
    const data = await res.json();
    return (data.web?.results || []).slice(0, limit).map((item) => ({
      name: item.title,
      url: item.url,
      snippet: item.description || '',
      source: 'brave',
    }));
  }

  async _searchTavily(q, limit) {
    const res = await this._fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.cfg.tavilyApiKey,
        query: q,
        max_results: Math.min(limit, 10),
        search_depth: 'basic',
        include_answer: false,
      }),
    });
    if (!res.ok) throw new Error(`Tavily Search API: ${res.status}`);
    const data = await res.json();
    return (data.results || []).slice(0, limit).map((item) => ({
      name: item.title,
      url: item.url,
      snippet: item.content || '',
      source: 'tavily',
    }));
  }
}

export function buildSearchToolDefs(cfg = {}) {
  const config = { ...loadSearchConfigFromEnv(), ...cfg };
  const limit0 = config.defaultLimit ?? 5;
  const web = new ConfigurableWebSearch(config);

  return [
    {
      name: 'search_web',
      description: 'Recherche web multi-provider (Tavily / Brave / Google / DuckDuckGo)',
      inputKeys: ['q'],
      sideEffect: 'read',
      gate: false,
      source: 'search-tools',
      handler: async ({ q, limit, provider }) => {
        const results = await web.search(q, { limit: limit ?? limit0, provider });
        return { query: q, count: results.length, results };
      },
    },
    {
      name: 'search_docs',
      description: 'Alias search_web — recherche documentaire / web pour research graphs',
      inputKeys: ['q'],
      sideEffect: 'read',
      gate: false,
      source: 'search-tools',
      handler: async ({ q, limit }) => {
        const results = await web.search(q, { limit: limit ?? limit0 });
        return { query: q, count: results.length, results };
      },
    },
    {
      name: 'search_competitors',
      description: 'Recherche concurrents web (même stack multi-provider)',
      inputKeys: ['q'],
      sideEffect: 'read',
      gate: false,
      source: 'search-tools',
      handler: async ({ q, limit }) => {
        const results = await web.search(q, { limit: limit ?? limit0 });
        return results;
      },
    },
    {
      name: 'search_github',
      description: 'Recherche de dépôts GitHub (stars, forks, fraîcheur)',
      inputKeys: ['q'],
      sideEffect: 'read',
      gate: false,
      source: 'search-tools',
      handler: async ({ q, limit, token }) => {
        const { GitHubScanner } = await import('../positionning/scanner-github.mjs');
        const scanner = new GitHubScanner({
          token: token || config.githubToken,
          fetchImpl: config.fetchImpl,
        });
        return scanner.search(q, { limit: limit ?? limit0 });
      },
    },
    {
      name: 'search_arxiv',
      description: 'Recherche d’articles académiques sur ArXiv',
      inputKeys: ['q'],
      sideEffect: 'read',
      gate: false,
      source: 'search-tools',
      handler: async ({ q, limit }) => {
        const { ArXivScanner } = await import('../positionning/scanner-arxiv.mjs');
        const scanner = new ArXivScanner({ fetchImpl: config.fetchImpl });
        return scanner.search(q, { limit: limit ?? limit0 });
      },
    },
    {
      name: 'search_all',
      description: 'Recherche parallèle web + GitHub + ArXiv',
      inputKeys: ['q'],
      sideEffect: 'read',
      gate: false,
      source: 'search-tools',
      handler: async ({ q, limit }) => {
        const lim = limit ?? limit0;
        const { GitHubScanner } = await import('../positionning/scanner-github.mjs');
        const { ArXivScanner } = await import('../positionning/scanner-arxiv.mjs');
        const gh = new GitHubScanner({ token: config.githubToken, fetchImpl: config.fetchImpl });
        const arxiv = new ArXivScanner({ fetchImpl: config.fetchImpl });
        const [webResults, ghResults, arxivResults] = await Promise.all([
          web.search(q, { limit: lim }).catch((e) => ({ error: String(e.message || e) })),
          gh.search(q, { limit: lim }).catch((e) => ({ error: String(e.message || e) })),
          arxiv.search(q, { limit: lim }).catch((e) => ({ error: String(e.message || e) })),
        ]);
        return { query: q, web: webResults, github: ghResults, arxiv: arxivResults };
      },
    },
  ];
}

export function registerSearchTools(registry, cfg = {}) {
  if (!registry || typeof registry.register !== 'function') {
    throw new Error('registerSearchTools: registry invalide');
  }
  const defs = buildSearchToolDefs(cfg);
  const names = [];
  for (const def of defs) {
    registry.register(def);
    names.push(def.name);
  }
  return names;
}
