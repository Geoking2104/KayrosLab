import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ontologyToCytoscape, ontologyGraphStats } from './ontology-graph.mjs';

describe('ontology graph', () => {
  it('builds nodes and edges', () => {
    const g = ontologyToCytoscape();
    assert.ok(g.nodes.length >= 10);
    assert.ok(g.edges.length >= 5);
    assert.equal(g.elements.length, g.nodes.length + g.edges.length);
  });

  it('filters tech group', () => {
    const g = ontologyToCytoscape({ group: 'tech' });
    assert.ok(g.nodes.every((n) => n.data.group === 'tech'));
    assert.ok(g.edges.every((e) =>
      g.nodes.some((n) => n.data.id === e.data.source)
      && g.nodes.some((n) => n.data.id === e.data.target),
    ));
  });

  it('stats', () => {
    const s = ontologyGraphStats('business');
    assert.ok(s.nodeCount > 0);
    assert.equal(s.group, 'business');
  });
});
