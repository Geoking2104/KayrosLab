import { useState, useCallback, useRef } from 'react';
import { ENTITY_TYPES, RELATIONSHIPS } from './data/ontology.js';
import { searchCompetitors } from './collectors/scanner.js';
import OntologyGraph from './components/OntologyGraph.jsx';
import InspectorPanel from './components/InspectorPanel.jsx';
import QueryPlayground from './components/QueryPlayground.jsx';
import GapAnalysis from './components/GapAnalysis.jsx';
import OWLExporter from './components/OWLExporter.jsx';
import IdeaInput from './components/IdeaInput.jsx';
import './styles/positioning.css';

const COMPETITOR_COLORS = ['#ef4444', '#f97316', '#8b5cf6', '#06b6d4', '#ec4899'];

function computeIdeaBaseline(text) {
  const scores = {};
  for (const et of ENTITY_TYPES) {
    const heuristic = 40 + (text.split(' ').length * 2);
    scores[et.id] = Math.min(100, Math.max(10, heuristic));
  }
  return scores;
}

function computeCompetitorScores(idea, webResults) {
  const terms = idea.toLowerCase().split(' ');
  return webResults.map((r, i) => {
    const text = (r.snippet + ' ' + r.name).toLowerCase();
    const scores = {};
    for (const et of ENTITY_TYPES) {
      let matches = 0;
      for (const kw of terms) {
        if (text.includes(kw)) matches++;
      }
      const base = (et.group === 'tech' ? 55 : 45);
      scores[et.id] = Math.min(95, Math.max(5, base + matches * 4 - i * 3 + Math.floor(Math.random() * 10)));
    }
    const avg = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length);
    return {
      name: r.name,
      url: r.url,
      avgScore: avg,
      color: COMPETITOR_COLORS[i % COMPETITOR_COLORS.length],
      scores,
    };
  });
}

function computeGaps(baseline, competitors) {
  const gaps = [];
  for (const et of ENTITY_TYPES) {
    const ours = baseline[et.id] || 50;
    const avg = competitors.length > 0
      ? Math.round(competitors.reduce((s, c) => s + (c.scores[et.id] || 50), 0) / competitors.length)
      : 50;
    const diff = ours - avg;
    if (Math.abs(diff) >= 5) {
      gaps.push({ neuronId: et.id, diff, type: diff > 0 ? 'advantage' : 'disadvantage' });
    }
  }
  gaps.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return gaps;
}

export default function App() {
  const [idea, setIdea] = useState('');
  const [baseline, setBaseline] = useState(null);
  const [competitors, setCompetitors] = useState([]);
  const [gaps, setGaps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [inspectedEntity, setInspectedEntity] = useState(null);
  const [selectedComp, setSelectedComp] = useState(null);
  const [activeTab, setActiveTab] = useState('graph');

  const handleAnalyze = useCallback(async (ideaText) => {
    setLoading(true);
    setIdea(ideaText);
    setInspectedEntity(null);
    try {
      const webResults = await searchCompetitors(ideaText);
      const comps = computeCompetitorScores(ideaText, webResults);
      const base = computeIdeaBaseline(ideaText);
      const gapList = computeGaps(base, comps);
      setBaseline(base);
      setCompetitors(comps);
      setGaps(gapList);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleNodeClick = useCallback((entity, comp) => {
    setInspectedEntity(entity);
  }, []);

  const allInstances = [
    ...(baseline ? [{ name: 'Notre idée', color: '#6366f1', isBaseline: true, scores: baseline }] : []),
    ...competitors,
  ];

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="header-logo">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <rect width="28" height="28" rx="6" fill="#D83B01" />
              <text x="14" y="19" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff">K</text>
            </svg>
          </div>
          <div>
            <h1 className="header-title">Positionner</h1>
            <span className="header-sub">Analyse concurrentielle ontologique</span>
          </div>
        </div>
        <div className="header-right">
          <span className="header-badge beta">Bêta</span>
          <span className="header-badge ontology">Ontology Playground</span>
        </div>
      </header>

      <div className="main-layout">
        <div className="main-content">
          <IdeaInput onAnalyze={handleAnalyze} loading={loading} />

          {loading && (
            <div className="loading-bar">
              <div className="loading-fill" />
              <span>Collecte et scoring en cours...</span>
            </div>
          )}

          {(baseline || competitors.length > 0) && (
            <>
              <div className="competitor-selector">
                <label>Concurrent actif :</label>
                <div className="comp-chips">
                  {allInstances.map((c) => (
                    <button
                      key={c.name}
                      className={`comp-chip ${selectedComp?.name === c.name ? 'active' : ''} ${c.isBaseline ? 'baseline' : ''}`}
                      style={{ '--comp-color': c.color }}
                      onClick={() => setSelectedComp(c)}
                    >
                      {c.isBaseline ? '🏠' : ''} {c.name} <span className="comp-score">({c.avgScore || '—'})</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="tabs">
                <button className={`tab ${activeTab === 'graph' ? 'active' : ''}`} onClick={() => setActiveTab('graph')}>
                  🕸️ Graphe
                </button>
                <button className={`tab ${activeTab === 'query' ? 'active' : ''}`} onClick={() => setActiveTab('query')}>
                  🔍 Query Playground
                </button>
                <button className={`tab ${activeTab === 'gaps' ? 'active' : ''}`} onClick={() => setActiveTab('gaps')}>
                  📊 Gap Analysis
                </button>
                <button className={`tab ${activeTab === 'export' ? 'active' : ''}`} onClick={() => setActiveTab('export')}>
                  📥 Export
                </button>
              </div>

              <div className="tab-content">
                {activeTab === 'graph' && (
                  <div className="graph-inspector-layout">
                    <div className="graph-area">
                      <OntologyGraph
                        selectedCompetitor={selectedComp}
                        onNodeClick={handleNodeClick}
                      />
                    </div>
                    <div className="inspector-area">
                      <InspectorPanel
                        entity={inspectedEntity}
                        competitor={selectedComp}
                        competitorList={competitors}
                        baseline={baseline}
                        onClose={() => setInspectedEntity(null)}
                      />
                    </div>
                  </div>
                )}

                {activeTab === 'query' && (
                  <QueryPlayground competitorList={competitors} baseline={baseline} />
                )}

                {activeTab === 'gaps' && (
                  <GapAnalysis gaps={gaps} />
                )}

                {activeTab === 'export' && (
                  <OWLExporter competitorList={competitors} baseline={baseline} />
                )}
              </div>
            </>
          )}

          {!baseline && competitors.length === 0 && !loading && (
            <div className="empty-state">
              <div className="empty-icon">🔍</div>
              <p>Entrez une idée et cliquez sur <strong>Analyser</strong> pour explorer l'ontologie de positionnement concurrentiel.</p>
              <div className="empty-features">
                <span>🏗️ 14 types d'entités</span>
                <span>🔗 13 relations orientées</span>
                <span>🕸️ Graphe Cytoscape.js</span>
                <span>🔍 Query Playground</span>
                <span>🏷️ Export OWL RDF/XML</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
