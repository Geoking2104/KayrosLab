import { usePositioning } from './hooks/usePositioning.js';
import Header from './components/Header.jsx';
import IdeaInput from './components/IdeaInput.jsx';
import CollectorPanel from './components/CollectorPanel.jsx';
import PositioningDashboard from './components/PositioningDashboard.jsx';
import './styles/positioning.css';

export default function App() {
  const { status, progress, baseline, competitors, gaps, error, run } = usePositioning();
  const loading = status === 'collecting';

  return (
    <div className="app">
      <Header />
      <IdeaInput onAnalyze={run} loading={loading} />
      <CollectorPanel progress={progress} visible={loading} />

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '12px 16px', marginBottom: 24, fontSize: 13, color: '#991b1b' }}>
          {error}
        </div>
      )}

      <PositioningDashboard baseline={baseline} competitors={competitors} gaps={gaps} />
    </div>
  );
}
