import { useRef, useEffect } from 'react';
import cytoscape from 'cytoscape';
import { ENTITY_TYPES, RELATIONSHIPS } from '../data/ontology.js';

export default function OntologyGraph({ selectedCompetitor, onNodeClick, onEdgeClick }) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || cyRef.current) return;

    const elements = [];
    for (const et of ENTITY_TYPES) {
      elements.push({
        data: {
          id: et.id,
          label: `${et.icon} ${et.name}`,
          desc: et.description,
          color: et.color,
          properties: et.properties,
          entityType: et,
        },
      });
    }

    for (const rel of RELATIONSHIPS) {
      elements.push({
        data: {
          id: rel.id,
          source: rel.from,
          target: rel.to,
          label: rel.name,
          cardinality: rel.cardinality,
          description: rel.description,
        },
      });
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#e2e8f0',
            label: 'data(label)',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'font-size': '11px',
            'font-weight': '600',
            'text-margin-y': 6,
            width: 64,
            height: 64,
            'border-width': 3,
            'border-color': '#94a3b8',
            'transition-property': 'background-color, border-color, width, height',
            'transition-duration': 250,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2,
            'line-color': '#94a3b8',
            'target-arrow-color': '#94a3b8',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-size': '9px',
            'text-rotation': 'autorotate',
            'text-margin-x': 6,
            color: '#64748b',
          },
        },
      ],
      layout: { name: 'fcose', animate: true, animationDuration: 500, fit: true, padding: 40 },
      minZoom: 0.5,
      maxZoom: 2.5,
      wheelSensitivity: 0.3,
    });

    for (const et of ENTITY_TYPES) {
      const node = cy.getElementById(et.id);
      node.style('background-color', et.color);
      node.style('border-color', et.color);
      node.data('color', et.color);
    }

    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      const et = node.data('entityType');
      if (et && onNodeClick) onNodeClick(et, selectedCompetitor);
    });
    cy.on('tap', 'edge', (evt) => {
      const edge = evt.target;
      if (onEdgeClick) onEdgeClick(edge.data());
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    for (const node of cy.nodes()) {
      const baseColor = node.data('color') || '#e2e8f0';
      node.style('background-color', baseColor);
      node.style('border-color', baseColor);
    }
  }, [selectedCompetitor]);

  return (
    <div
      ref={containerRef}
      className="ontology-graph"
      style={{
        width: '100%',
        height: 480,
        background: '#f8fafc',
        borderRadius: 12,
        border: '1px solid #e2e8f0',
        cursor: 'grab',
      }}
    />
  );
}
