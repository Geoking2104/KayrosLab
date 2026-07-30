import { useMemo, useCallback } from 'react';
import { ReactFlow, Background, Controls, MiniMap, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import IdeaNode from '../components/IdeaNode.jsx';
import { SEUIL_ALERTE_NOEUDS } from './CanvasRenderer.js';

const typesNoeud = { idee: IdeaNode };

/** Couleur par relation. Le desaccord doit se voir sans lire l'etiquette. */
const COULEUR = {
  soutient: '#2f8f4e',
  contredit: '#c2401a',
  derive: '#6b7280',
  depend: '#7c3aed',
  remplace: '#b45309',
};

/**
 * Implementation React Flow du `CanvasRenderer`.
 * Seul fichier autorise a importer `@xyflow/react` : la bascule vers un moteur
 * WebGL (risque R1 du CDC) se fait en remplacant ce module.
 */
export default function ReactFlowRenderer({ ws, selection, onSelect, onMove, onConnect }) {
  const nodes = useMemo(() => (ws?.nodes ?? []).map((n) => ({
    id: n.id,
    type: 'idee',
    position: { x: n.x, y: n.y },
    data: { noeud: n },
    selected: n.id === selection,
    draggable: !n.pinned,          // EF-218 : un noeud fige ne bouge pas
  })), [ws, selection]);

  const edges = useMemo(() => (ws?.edges ?? []).map((e) => ({
    id: e.id, source: e.from, target: e.to, label: e.label ?? e.relation,
    animated: e.relation === 'contredit',
    style: { stroke: COULEUR[e.relation] ?? '#6b7280', strokeWidth: e.relation === 'contredit' ? 2 : 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: COULEUR[e.relation] ?? '#6b7280' },
  })), [ws]);

  const surDeplacement = useCallback((_, node) => onMove(node.id, node.position.x, node.position.y), [onMove]);
  const surConnexion = useCallback((c) => onConnect(c.source, c.target), [onConnect]);

  const surcharge = nodes.length > SEUIL_ALERTE_NOEUDS;

  return (
    <div className="canvas">
      {surcharge && (
        <div className="alerte-perf">
          {nodes.length} nœuds — au-delà de {SEUIL_ALERTE_NOEUDS} le rendu SVG se dégrade.
          Bascule vers un moteur WebGL à prévoir.
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={typesNoeud}
        onNodeClick={(_, n) => onSelect(n.id)}
        onPaneClick={() => onSelect(null)}
        onNodeDragStop={surDeplacement}
        onConnect={surConnexion}
        fitView
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={24} />
        <Controls />
        <MiniMap pannable zoomable nodeStrokeWidth={3} />
      </ReactFlow>
    </div>
  );
}
