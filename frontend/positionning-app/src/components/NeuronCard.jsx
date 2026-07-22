import { useState } from 'react';
import ScoreBar from './ScoreBar.jsx';
import CompetitorTraces from './CompetitorTraces.jsx';

export default function NeuronCard({ neuron, baseline, competitors }) {
  const [expanded, setExpanded] = useState(false);
  const ourScore = baseline?.[neuron.id] ?? null;
  const traces = {};
  for (const c of competitors) {
    if (c.neurons[neuron.id] !== undefined) {
      traces[c.name] = c.neurons[neuron.id];
    }
  }

  return (
    <div className="neuron-card" onClick={() => setExpanded(!expanded)}>
      <div className="neuron-card-header">
        <span className="neuron-card-label">{neuron.label}</span>
        <span className="neuron-card-score" style={{ color: neuron.color }}>
          {ourScore !== null ? ourScore : '--'}
        </span>
      </div>
      {expanded && <div className="neuron-card-desc">{neuron.description}</div>}
      <ScoreBar score={ourScore ?? 0} color={neuron.color} />
      <CompetitorTraces traces={traces} competitors={competitors} />
    </div>
  );
}
