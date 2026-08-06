import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapGraphStateToKayros,
  runLangGraphStep,
  createMockResearchGraph,
  createResearchGraph,
} from './langgraph-runner.mjs';
import { ToolRegistry } from '../tool-registry.mjs';
import { fromAsyncFn } from './langchain-tools.mjs';

describe('mapGraphStateToKayros', () => {
  it('prefers summary field', () => {
    const r = mapGraphStateToKayros({ summary: 'hello', findings: [{ text: 'x' }] });
    assert.equal(r.summary, 'hello');
  });
  it('maps findings to signals', () => {
    const r = mapGraphStateToKayros({
      findings: [{ id: 'f1', text: 'signal A' }],
    });
    assert.equal(r.signals.length, 1);
    assert.equal(r.signals[0].contenu, 'signal A');
  });
});

describe('runLangGraphStep + mock graph', () => {
  it('invokes mock research and returns Kayros shape', async () => {
    const reg = new ToolRegistry();
    reg.register(fromAsyncFn({
      name: 'search_docs',
      inputKeys: ['q'],
      fn: async ({ q }) => ({ hits: [q + ' result'] }),
    }));
    const graph = createMockResearchGraph({ tools: reg });
    const result = await runLangGraphStep(graph, { idea: 'KayrosLab novelty' });
    assert.ok(result.summary.includes('KayrosLab') || result.summary.includes('result'));
    assert.ok(result.signals.length >= 1);
    assert.equal(graph.id, 'mock-research');
  });

  it('rejects graphs without invoke', async () => {
    await assert.rejects(() => runLangGraphStep({}, { idea: 'x' }), /invoke/);
  });
});

describe('createResearchGraph', () => {
  it('falls back to mock when LangGraph is not installed', async () => {
    const graph = await createResearchGraph({ forceMock: true });
    assert.equal(graph.id, 'mock-research');
    const out = await graph.invoke({ idea: 'test' });
    assert.ok(out.summary);
  });
});
