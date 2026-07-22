import { getNeuron } from '../data/ontology.js';

export default function GapAnalysis({ gaps }) {
  if (!gaps || gaps.length === 0) return null;

  return (
    <div className="gap-section">
      <h3>Écarts de différenciation</h3>
      <div className="gap-list">
        {gaps.map((g) => {
          const neuron = getNeuron(g.neuronId);
          return (
            <span key={g.neuronId} className={`gap-chip ${g.type}`}>
              {g.type === 'advantage' ? '🟢' : g.type === 'disadvantage' ? '🔴' : '🟡'}
              {neuron?.label || g.neuronId}
              <span style={{ fontWeight: 700 }}>{g.diff > 0 ? `+${g.diff}` : g.diff}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
