import NeuronCard from './NeuronCard.jsx';

export default function NeuronGrid({ side, neurons, baseline, competitors, sideLabel, sideColor }) {
  return (
    <div className="neuron-panel">
      <div className="neuron-panel-title" style={{ color: sideColor }}>{sideLabel}</div>
      <div className="neuron-panel-desc">7 dimensions {side === 'tech' ? 'techniques' : 'business'}</div>
      <div className="neuron-list">
        {neurons.map((n) => (
          <NeuronCard key={n.id} neuron={n} baseline={baseline} competitors={competitors} />
        ))}
      </div>
    </div>
  );
}
