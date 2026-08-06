import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchToolDefs,
  registerSearchTools,
  loadSearchConfigFromEnv,
  ConfigurableWebSearch,
} from './search-tools.mjs';
import { ToolRegistry } from '../tool-registry.mjs';

describe('loadSearchConfigFromEnv', () => {
  it('reads keys', () => {
    const c = loadSearchConfigFromEnv({
      TAVILY_API_KEY: 'tvly-x',
      KAYROS_SEARCH_PROVIDER: 'tavily',
      KAYROS_SEARCH_LIMIT: '3',
    });
    assert.equal(c.tavilyApiKey, 'tvly-x');
    assert.equal(c.preferredWebProvider, 'tavily');
    assert.equal(c.defaultLimit, 3);
  });
});

describe('registerSearchTools', () => {
  it('registers search_web and search_docs', () => {
    const reg = new ToolRegistry();
    const names = registerSearchTools(reg, { preferredWebProvider: 'duckduckgo' });
    assert.ok(names.includes('search_web'));
    assert.ok(names.includes('search_docs'));
    assert.ok(names.includes('search_github'));
    assert.ok(reg.get('search_web'));
  });
});

describe('ConfigurableWebSearch with mock Tavily', () => {
  it('uses Tavily when key present', async () => {
    const fetchImpl = async (url, opts) => {
      assert.ok(String(url).includes('tavily') || opts?.method === 'POST');
      return {
        ok: true,
        json: async () => ({
          results: [{ title: 'A', url: 'https://a.test', content: 'snippet A' }],
        }),
      };
    };
    const web = new ConfigurableWebSearch({
      tavilyApiKey: 'tvly-test',
      preferredWebProvider: 'tavily',
      fetchImpl,
    });
    const results = await web.search('kayros');
    assert.equal(results.length, 1);
    assert.equal(results[0].source, 'tavily');
  });
});

describe('buildSearchToolDefs handler shape', () => {
  it('search_web returns { results }', async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        results: [{ title: 'X', url: 'https://x', content: 'y' }],
      }),
    });
    const defs = buildSearchToolDefs({
      tavilyApiKey: 'tvly',
      preferredWebProvider: 'tavily',
      fetchImpl,
    });
    const searchWeb = defs.find((d) => d.name === 'search_web');
    const out = await searchWeb.handler({ q: 'test' });
    assert.equal(out.count, 1);
    assert.equal(out.results[0].name, 'X');
  });
});
