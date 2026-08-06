import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLangfuseObserver,
  createNoopObserver,
  loadLangfuseConfig,
} from './langfuse.mjs';
import { ToolRegistry } from '../tool-registry.mjs';
import { fromAsyncFn } from './langchain-tools.mjs';

describe('loadLangfuseConfig', () => {
  it('disabled without keys', () => {
    assert.equal(loadLangfuseConfig({}).enabled, false);
  });
  it('enabled with both keys', () => {
    const c = loadLangfuseConfig({
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
      LANGFUSE_BASE_URL: 'http://localhost:3000',
    });
    assert.equal(c.enabled, true);
    assert.equal(c.baseUrl, 'http://localhost:3000');
  });
});

describe('noop observer', () => {
  it('wraps without changing behavior', async () => {
    const obs = createNoopObserver();
    assert.equal(obs.enabled, false);
    const llm = { async complete() { return { text: 'ok', provider: 'mock' }; } };
    const r = await obs.wrapLlm(llm).complete({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.text, 'ok');
    await obs.flush();
  });
});

describe('createLangfuseObserver', () => {
  it('returns noop without keys', async () => {
    const obs = await createLangfuseObserver({ forceNoop: true });
    assert.equal(obs.enabled, false);
  });

  it('uses injected client for generation + span', async () => {
    const generations = [];
    const spans = [];
    const client = {
      trace: (o) => ({ id: 't1', ...o, generation: (g) => generations.push(g), span: (s) => spans.push(s) }),
      generation: (g) => generations.push(g),
      span: (s) => spans.push(s),
      async flushAsync() {},
    };
    const obs = await createLangfuseObserver({ publicKey: 'pk', secretKey: 'sk', client });
    assert.equal(obs.enabled, true);

    const llm = {
      async complete() {
        return { text: 'hello', provider: 'mock', usage: { tokensIn: 1, tokensOut: 2 } };
      },
    };
    await obs.wrapLlm(llm, { ideaId: 'idea-1', stage: 'construire' }).complete({
      messages: [{ role: 'user', content: 'ping' }],
      model: 'test-model',
    });
    assert.ok(generations.length >= 1);
    assert.equal(generations[0].metadata.ideaId, 'idea-1');
    assert.equal(generations[0].metadata.stage, 'construire');

    const reg = new ToolRegistry();
    reg.register(fromAsyncFn({
      name: 'search_web',
      inputKeys: ['q'],
      fn: async ({ q }) => ({ results: [q] }),
    }));
    await obs.wrapTools(reg, { ideaId: 'idea-1', stage: 'positionner' }).call('search_web', { q: 'kayros' }, { ideaId: 'idea-1' });
    const toolSpan = spans.find((s) => s.name === 'tool.search_web');
    assert.ok(toolSpan);
    assert.equal(toolSpan.metadata.ideaId, 'idea-1');
  });
});
