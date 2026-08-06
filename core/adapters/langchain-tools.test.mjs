import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toKayrosTool,
  registerLangChainTools,
  extractInputKeys,
  inferSideEffect,
  normalizeLcResult,
  fromAsyncFn,
} from './langchain-tools.mjs';
import { ToolRegistry } from '../tool-registry.mjs';

describe('extractInputKeys', () => {
  it('reads Zod-like shape', () => {
    assert.deepEqual(extractInputKeys({ shape: { q: {}, limit: {} } }), ['q', 'limit']);
  });
  it('reads JSON Schema properties', () => {
    assert.deepEqual(extractInputKeys({ type: 'object', properties: { url: {}, depth: {} } }), ['url', 'depth']);
  });
  it('reads string array', () => {
    assert.deepEqual(extractInputKeys(['a', 'b']), ['a', 'b']);
  });
});

describe('inferSideEffect', () => {
  it('detects write', () => {
    assert.equal(inferSideEffect({ name: 'send_email', description: 'Send a message' }), 'write');
  });
  it('detects read', () => {
    assert.equal(inferSideEffect({ name: 'search_web', description: 'Search the web' }), 'read');
  });
});

describe('normalizeLcResult', () => {
  it('parses ToolMessage-like JSON content', () => {
    assert.deepEqual(
      normalizeLcResult({ content: '{\"ok\":true}', tool_call_id: '1', name: 't' }),
      { ok: true },
    );
  });
  it('passes through plain objects', () => {
    assert.deepEqual(normalizeLcResult({ x: 1 }), { x: 1 });
  });
});

describe('toKayrosTool + registry', () => {
  it('wraps a mock LC structured tool', async () => {
    const lcTool = {
      name: 'search_docs',
      description: 'Search internal docs',
      schema: { type: 'object', properties: { q: { type: 'string' } } },
      async invoke(input) {
        return { hits: [`result for ${input.q}`] };
      },
    };
    const def = toKayrosTool(lcTool);
    assert.equal(def.name, 'search_docs');
    assert.equal(def.sideEffect, 'read');
    assert.deepEqual(def.inputKeys, ['q']);
    assert.equal(def.source, 'langchain');

    const reg = new ToolRegistry();
    registerLangChainTools(reg, [lcTool]);
    const out = await reg.call('search_docs', { q: 'kayros' });
    assert.deepEqual(out, { hits: ['result for kayros'] });
  });

  it('marks write tools with gate by default', () => {
    const lcTool = {
      name: 'create_ticket',
      description: 'Create a ticket in tracker',
      schema: { properties: { title: {} } },
      async invoke() { return { id: 1 }; },
    };
    const def = toKayrosTool(lcTool);
    assert.equal(def.sideEffect, 'write');
    assert.equal(def.gate, true);
  });

  it('supports prefix and skipExisting', () => {
    const reg = new ToolRegistry();
    const lcTool = {
      name: 'ping',
      description: 'Ping',
      async invoke() { return 'pong'; },
    };
    registerLangChainTools(reg, [lcTool], { prefix: 'lc_' });
    assert.ok(reg.get('lc_ping'));
    const names = registerLangChainTools(reg, [lcTool], { prefix: 'lc_', skipExisting: true });
    assert.deepEqual(names, []);
  });
});

describe('fromAsyncFn', () => {
  it('registers without LangChain', async () => {
    const reg = new ToolRegistry();
    reg.register(fromAsyncFn({
      name: 'add',
      inputKeys: ['a', 'b'],
      fn: async ({ a, b }) => a + b,
    }));
    assert.equal(await reg.call('add', { a: 2, b: 3 }), 5);
  });
});
