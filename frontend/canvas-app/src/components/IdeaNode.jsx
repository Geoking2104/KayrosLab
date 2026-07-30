import { Handle, Position } from '@xyflow/react';

/** Un type de noeud = une couleur + une pastille. EF-211. */
const STYLE = {
  idee: { fond: '#eef2ff', bord: '#4f46e5', pastille: '💡' },
  question: { fond: '#ecfeff', bord: '#0891b2', pastille: '❓' },
  hypothese: { fond: '#fefce8', bord: '#ca8a04', pastille: '🔬' },
  preuve: { fond: '#f0fdf4', bord: '#16a34a', pastille: '📎' },
  critique: { fond: '#fef2f2', bord: '#dc2626', pastille: '⚠️' },
  decision: { fond: '#faf5ff', bord: '#9333ea', pastille: '⚖️' },
  groupe: { fond: '#f8fafc', bord: '#64748b', pastille: '🗂️' },
};

export default function IdeaNode({ data, selected }) {
  const n = data.noeud;
  const s = STYLE[n.type] ?? STYLE.idee;
  // EF-201 / EF-207 : une source retiree n'etaye plus rien, et ca se voit.
  const retracte = n.provenance?.retracted;
  const source = n.provenance && !retracte;

  return (
    <div
      className={`noeud${selected ? ' selectionne' : ''}`}
      style={{ background: s.fond, borderColor: selected ? '#111827' : s.bord }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="noeud-entete">
        <span>{s.pastille} {n.type}</span>
        <span className="noeud-badges">
          {n.pinned && <span title="Figé — le layout ne le déplace pas">📌</span>}
          {n.authorKind === 'agent' && <span title={`Produit par ${n.authorId}`}>🤖</span>}
          {source && <span title="Assertion sourcée">🔗</span>}
          {retracte && <span className="retracte" title="Source retirée — assertion non étayée">⛓️‍💥</span>}
        </span>
      </div>
      <div className="noeud-titre">{n.titre}</div>
      {n.corps && <div className="noeud-corps">{n.corps.slice(0, 140)}</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
