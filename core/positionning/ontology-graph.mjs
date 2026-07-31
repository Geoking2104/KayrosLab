// Build Cytoscape-ready elements from ENTITY_TYPES + RELATIONSHIPS.

import { ENTITY_TYPES, RELATIONSHIPS } from './ontology.mjs';

/**
 * @param {{ group?: 'all'|'tech'|'business' }} [opts]
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function ontologyToCytoscape({ group = 'all' } = {}) {
  const ents = ENTITY_TYPES.filter((e) => group === 'all' || e.group === group);
  const ids = new Set(ents.map((e) => e.id));
  const nodes = ents.map((e) => ({
    data: {
      id: e.id,
      label: e.name,
      group: e.group,
      icon: e.icon,
      color: e.color,
      description: e.description,
      props: (e.properties || []).map((p) => p.name).join(', '),
    },
  }));
  const edges = RELATIONSHIPS
    .filter((r) => ids.has(r.from) && ids.has(r.to))
    .map((r) => ({
      data: {
        id: r.id,
        source: r.from,
        target: r.to,
        label: r.name,
        cardinality: r.cardinality,
        description: r.description,
      },
    }));
  return { nodes, edges, elements: [...nodes, ...edges] };
}

export function ontologyGraphStats(group = 'all') {
  const { nodes, edges } = ontologyToCytoscape({ group });
  return { nodeCount: nodes.length, edgeCount: edges.length, group };
}
