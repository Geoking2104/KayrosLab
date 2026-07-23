import { useState, useCallback } from 'react';
import { ENTITY_TYPES } from './data/ontology.js';
import { searchCompetitors, searchGitHub, searchArXiv, analyzeIdea } from './collectors/scanner.js';
import { useI18n } from './i18n/I18nContext.jsx';
import OntologyGraph from './components/OntologyGraph.jsx';
import InspectorPanel from './components/InspectorPanel.jsx';
import QueryPlayground from './components/QueryPlayground.jsx';
import GapAnalysis from './components/GapAnalysis.jsx';
import OWLExporter from './components/OWLExporter.jsx';
import StrategicDashboard from './components/StrategicDashboard.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import IdeaInput from './components/IdeaInput.jsx';
import './styles/positioning.css';

const COMPETITOR_COLORS = ['#ef4444', '#f97316', '#8b5cf6', '#06b6d4', '#ec4899'];

function computeBaseline(text) {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 2);
  const wordCount = words.length;
  const scores = {};
  for (const et of ENTITY_TYPES) {
    const keywordMatches = words.filter((w) => (et.name + ' ' + et.description).toLowerCase().includes(w.toLowerCase())).length;
    const heuristic = 40 + Math.min(wordCount * 2, 40) + keywordMatches * 3;
    scores[et.id] = Math.max(10, Math.min(100, heuristic));
  }
  return scores;
}

function computeCompetitorScores(idea, webResults) {
  const terms = idea.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return webResults.map((r, i) => {
    const text = (r.snippet + ' ' + r.name).toLowerCase();
    const scores = {};
    for (const et of ENTITY_TYPES) {
      let matches = 0;
      for (const kw of terms) {
        if (text.includes(kw)) matches++;
      }
      const base = et.group === 'tech' ? 55 : 45;
      const position = Math.max(0, (5 - i) * 2);
      scores[et.id] = Math.max(5, Math.min(95, base + matches * 4 + position));
    }
    const avgScore = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length);
    return { name: r.name, url: r.url, avgScore, scores, color: COMPETITOR_COLORS[i % COMPETITOR_COLORS.length] };
  });
}

function computeGaps(baseline, competitors) {
  const gaps = [];
  for (const et of ENTITY_TYPES) {
    const ours = baseline[et.id] || 50;
    const scores = competitors.map((c) => c.scores?.[et.id] || 50);
    const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 50;
    const diff = ours - avg;
    if (Math.abs(diff) >= 5) {
      gaps.push({ neuronId: et.id, diff, type: diff > 0 ? 'advantage' : 'disadvantage' });
    }
  }
  gaps.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return gaps;
}

export default function App() {
  const { t, locale, setLocale, available } = useI18n();
  const [idea, setIdea] = useState('');
  const [competitors, setCompetitors] = useState([]);
  const [gaps, setGaps] = useState([]);
  const [baseline, setBaseline] = useState(null);
  const [ki, setKi] = useState(null);
  const [loading, setLoading] = useState(false);
  const [inspectedEntity, setInspectedEntity] = useState(null);
  const [selectedComp, setSelectedComp] = useState(null);
  const [activeTab, setActiveTab] = useState('graph');

  const handleAnalyze = useCallback(async (ideaText) => {
    setLoading(true);
    setIdea(ideaText);
    setInspectedEntity(null);
    try {
      const analysisResult = await analyzeIdea(ideaText);
      if (analysisResult) {
        setBaseline(analysisResult.baseline);
        const colorMapped = (analysisResult.competitors || []).map((c, i) => ({
          ...c, color: COMPETITOR_COLORS[i % COMPETITOR_COLORS.length],
        }));
        setCompetitors(colorMapped);
        setGaps(analysisResult.gaps || []);
        setKi(analysisResult.kayrosIndex ?? null);
      } else {
        const webResults = await searchCompetitors(ideaText);
        const comps = computeCompetitorScores(ideaText, webResults);
        const base = computeBaseline(ideaText);
        const gapList = computeGaps(base, comps);
        setBaseline(base);
        setCompetitors(comps);
        setGaps(gapList);
        setKi(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleNodeClick = useCallback((entity) => {
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
            <h1 className="header-title">{t('app.title')}</h1>
            <span className="header-sub">{t('app.subtitle')}</span>
          </div>
        </div>
        <div className="header-right">
          <span className="header-badge beta">{t('app.beta')}</span>
          <span className="header-badge ontology">{t('app.ontology')}</span>
          <div className="locale-switcher">
            {Object.entries(available).map(([code, label]) => (
              <button key={code} className={`locale-btn ${locale === code ? 'active' : ''}`} onClick={() => setLocale(code)}>{label}</button>
            ))}
          </div>
        </div>
      </header>

      <div className="main-layout">
        <div className="main-content">
          <ErrorBoundary>
          <IdeaInput onAnalyze={handleAnalyze} loading={loading} />

          {loading && (
            <div className="loading-bar">
              <div className="loading-fill" />
              <span>{t('app.analyzing')}</span>
            </div>
          )}

          {(baseline || competitors.length > 0) && (
            <>
              {ki !== null && (
                <div className="ki-banner">
                  <span className="ki-label">Kayros Index</span>
                  <span className="ki-value">{ki}/100</span>
                </div>
              )}

              <div className="competitor-selector">
                <label>{t('app.activeCompetitor')}</label>
                <div className="comp-chips">
                  {allInstances.map((c) => (
                    <button
                      key={c.name}
                      className={`comp-chip ${selectedComp?.name === c.name ? 'active' : ''} ${c.isBaseline ? 'baseline' : ''}`}
                      style={{ '--comp-color': c.color }}
                      onClick={() => setSelectedComp(c)}
                    >
                      {c.isBaseline ? `🏠 ${t('app.ourIdea')}` : c.name} <span className="comp-score">({c.avgScore || '—'})</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="tabs">
                <button className={`tab ${activeTab === 'graph' ? 'active' : ''}`} onClick={() => setActiveTab('graph')}>
                  🕸️ {t('app.tabs.graph')}
                </button>
                <button className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
                  📊 {t('app.dashboard.tab')}
                </button>
                <button className={`tab ${activeTab === 'query' ? 'active' : ''}`} onClick={() => setActiveTab('query')}>
                  🔍 {t('app.tabs.query')}
                </button>
                <button className={`tab ${activeTab === 'gaps' ? 'active' : ''}`} onClick={() => setActiveTab('gaps')}>
                  📉 {t('app.tabs.gaps')}
                </button>
                <button className={`tab ${activeTab === 'export' ? 'active' : ''}`} onClick={() => setActiveTab('export')}>
                  📥 {t('app.tabs.export')}
                </button>
              </div>

              <div className="tab-content">
                {activeTab === 'dashboard' && (
                  <StrategicDashboard />
                )}
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
              <p>{t('app.emptyTitle')} <strong>{t('app.analyze')}</strong> {t('app.emptyDesc')}</p>
              <div className="empty-features">
                {t('app.features').map((f, i) => <span key={i}>{f}</span>)}
              </div>
            </div>
          )}
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
