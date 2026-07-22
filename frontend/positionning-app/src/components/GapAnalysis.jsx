import { getEntity } from '../data/ontology.js';

export default function GapAnalysis({ gaps }) {
  if (!gaps || gaps.length === 0) return null;

  return (
    <div className="gap-section">
      <h3>Écarts de différenciation</h3>
      <p className="gap-subtitle">Baseline vs moyenne des concurrents (seuil ≥ 5 pts)</p>
      <div className="gap-list">
        {gaps.map((g) => {
          const entity = getEntity(g.neuronId);
          return (
            <span key={g.neuronId} className={`gap-chip ${g.type}`}>
              {g.type === 'advantage' ? '🟢' : '🔴'}
              {(entity?.icon || '') + ' ' + (entity?.name || g.neuronId)}
              <span className="gap-value">{g.diff > 0 ? `+${g.diff}` : g.diff}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
