import { NEURONS } from '../data/ontology.js';
import NeuronGrid from './NeuronGrid.jsx';
import GapAnalysis from './GapAnalysis.jsx';
import Legend from './Legend.jsx';
import ExportButtons from './ExportButton.jsx';

export default function PositioningDashboard({ baseline, competitors, gaps }) {
  if (!baseline && (!competitors || competitors.length === 0)) {
    return (
      <div className="empty-state">
        <div className="icon">🔍</div>
        <p>Entrez une idée et cliquez sur Analyser pour générer la matrice de positionnement concurrentiel.</p>
      </div>
    );
  }

  return (
    <>
      <Legend competitors={competitors} />

      <div className="dashboard-grid">
        <NeuronGrid
          side="tech"
          sideLabel="TECH"
          sideColor="#6366f1"
          neurons={NEURONS.tech}
          baseline={baseline}
          competitors={competitors}
        />
        <NeuronGrid
          side="business"
          sideLabel="BUSINESS"
          sideColor="#ec4899"
          neurons={NEURONS.business}
          baseline={baseline}
          competitors={competitors}
        />
      </div>

      <GapAnalysis gaps={gaps} />
      <ExportButtons idea={null} competitors={competitors} gaps={gaps} />
    </>
  );
}
