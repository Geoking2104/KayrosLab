import { useState, useCallback, useEffect } from 'react';
import { ENTITY_TYPES } from './data/ontology.js';
import { searchCompetitors, analyzeIdea } from './collectors/scanner.js';
import { useI18n } from './i18n/I18nContext.jsx';
import { ToastProvider, useToast } from './components/Toast.jsx';
import { SkeletonGraph, SkeletonTabs, SkeletonChips } from './components/Skeleton.jsx';
import OntologyGraph from './components/OntologyGraph.jsx';
import InspectorPanel from './components/InspectorPanel.jsx';
import QueryPlayground from './components/QueryPlayground.jsx';
import GapAnalysis from './components/GapAnalysis.jsx';
import { loadSettings, saveSettings, applyTheme } from './data/settingsStore.js';
import OWLExporter from './components/OWLExporter.jsx';
import PdfExport from './components/PdfExport.jsx';
import StrategicDashboard from './components/StrategicDashboard.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import IdeaInput from './components/IdeaInput.jsx';
import CampaignList from './components/CampaignList.jsx';
import CampaignDetail from './components/CampaignDetail.jsx';
import HistoryList from './components/HistoryList.jsx';
import HistoryCompare from './components/HistoryCompare.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import MultiIdeaAnalysis from './components/MultiIdeaAnalysis.jsx';
import OnboardingTour from './components/OnboardingTour.jsx';
import { isTourCompleted } from './data/tourStore.js';
import { addHistoryEntry, getHistoryEntry } from './data/historyStore.js';
import { sendToSlack } from './utils/slack.js';
import IdeaKanban from './components/IdeaKanban.jsx';
import './styles/tokens.css';
import './styles/positioning.css';
import './styles/kanban.css';

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

function computeGaps(baseline, competitors, threshold = 5) {
  const gaps = [];
  for (const et of ENTITY_TYPES) {
    const ours = baseline[et.id] || 50;
    const scores = competitors.map((c) => c.scores?.[et.id] || 50);
    const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 50;
    const diff = ours - avg;
    if (Math.abs(diff) >= threshold) {
      gaps.push({ neuronId: et.id, diff, type: diff > 0 ? 'advantage' : 'disadvantage' });
    }
  }
  gaps.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return gaps;
}

function averageScore(scores) {
  const values = Object.values(scores);
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function createDemoAnalysis() {
  const idea = 'KayrosLab : outil de génération et management d’idées hybride IA + équipes pour entreprises';
  const baseline = {
    architecture: 84, stack: 81, data_layer: 86, security: 88, ia_ml: 92, scale_perf: 78, api_surface: 82,
    business_model: 84, pricing: 72, go_to_market: 76, icp: 86, revenue_model: 78, customer_success: 81, unit_economics: 74,
  };
  const makeCompetitor = (name, url, scores, kpis, colorIndex) => ({
    name,
    url,
    scores,
    kpis,
    avgScore: averageScore(scores),
    color: COMPETITOR_COLORS[colorIndex % COMPETITOR_COLORS.length],
  });
  const competitors = [
    makeCompetitor('Aha! Ideas', 'https://www.aha.io/software/idea-management-software', {
      architecture: 76, stack: 70, data_layer: 72, security: 82, ia_ml: 46, scale_perf: 80, api_surface: 74,
      business_model: 88, pricing: 76, go_to_market: 86, icp: 90, revenue_model: 84, customer_success: 86, unit_economics: 80,
    }, {
      web: { sources: 9, mentions: 42, freshness: '6 j' },
      github: { stars: 1180, forks: 148, contributors: 31, commits90: 64, issues: 42, freshness: '3 j' },
      gitlab: { stars: 86, forks: 11, contributors: 8, commits90: 12, issues: 7, freshness: '16 j' },
    }, 0),
    makeCompetitor('Klaxoon', 'https://klaxoon.com/klaxoon-difference/', {
      architecture: 72, stack: 68, data_layer: 70, security: 76, ia_ml: 52, scale_perf: 74, api_surface: 62,
      business_model: 82, pricing: 68, go_to_market: 88, icp: 84, revenue_model: 78, customer_success: 80, unit_economics: 70,
    }, {
      web: { sources: 8, mentions: 36, freshness: '4 j' },
      github: { stars: 420, forks: 54, contributors: 14, commits90: 24, issues: 18, freshness: '9 j' },
      gitlab: { stars: 63, forks: 7, contributors: 5, commits90: 9, issues: 4, freshness: '21 j' },
    }, 1),
    makeCompetitor('Accept Mission', 'https://www.acceptmission.com/idea-management-software/', {
      architecture: 70, stack: 66, data_layer: 68, security: 74, ia_ml: 55, scale_perf: 70, api_surface: 64,
      business_model: 80, pricing: 74, go_to_market: 78, icp: 82, revenue_model: 76, customer_success: 78, unit_economics: 72,
    }, {
      web: { sources: 7, mentions: 29, freshness: '8 j' },
      github: { stars: 260, forks: 37, contributors: 10, commits90: 17, issues: 11, freshness: '14 j' },
      gitlab: { stars: 41, forks: 5, contributors: 4, commits90: 6, issues: 3, freshness: '24 j' },
    }, 2),
    makeCompetitor('Miro AI', 'https://miro.com/', {
      architecture: 82, stack: 78, data_layer: 80, security: 84, ia_ml: 76, scale_perf: 86, api_surface: 80,
      business_model: 86, pricing: 78, go_to_market: 90, icp: 86, revenue_model: 86, customer_success: 82, unit_economics: 82,
    }, {
      web: { sources: 10, mentions: 58, freshness: '2 j' },
      github: { stars: 2120, forks: 284, contributors: 47, commits90: 96, issues: 68, freshness: '1 j' },
      gitlab: { stars: 132, forks: 19, contributors: 11, commits90: 18, issues: 10, freshness: '12 j' },
    }, 3),
  ];
  return {
    idea,
    baseline,
    competitors,
    gaps: computeGaps(baseline, competitors, 5),
    kayrosIndex: 82,
  };
}

function shouldShowTour() {
  try {
    return new URLSearchParams(window.location.search).has('tour') && !isTourCompleted();
  } catch {
    return false;
  }
}

const DEMO_ANALYSIS = createDemoAnalysis();

function AppInner() {
  const { t, locale, setLocale, available } = useI18n();
  const toast = useToast();
  const [idea, setIdea] = useState(DEMO_ANALYSIS.idea);
  const [competitors, setCompetitors] = useState(DEMO_ANALYSIS.competitors);
  const [gaps, setGaps] = useState(DEMO_ANALYSIS.gaps);
  const [baseline, setBaseline] = useState(DEMO_ANALYSIS.baseline);
  const [ki, setKi] = useState(DEMO_ANALYSIS.kayrosIndex);
  const [loading, setLoading] = useState(false);
  const [inspectedEntity, setInspectedEntity] = useState(() => ENTITY_TYPES.find((entity) => entity.id === 'ia_ml') || ENTITY_TYPES[0]);
  const [selectedComp, setSelectedComp] = useState(DEMO_ANALYSIS.competitors[0]);
  const [activeTab, setActiveTab] = useState('graph');
  const [campaignView, setCampaignView] = useState(null);
  const [compareIds, setCompareIds] = useState(null);
  const [settings, setSettings] = useState(() => loadSettings());
  const [showTour, setShowTour] = useState(() => shouldShowTour());

  useEffect(() => { applyTheme(settings.theme); }, [settings.theme]);
  useEffect(() => { if (settings.locale && settings.locale !== locale) setLocale(settings.locale); }, [settings.locale, locale, setLocale]);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') setInspectedEntity(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const runAnalysis = useCallback(async (ideaText, { gapThreshold, apiKey } = {}) => {
    const opts = apiKey ? { headers: { 'X-API-Key': apiKey } } : {};
    const analysisResult = await analyzeIdea(ideaText, opts);
    if (analysisResult) {
      const colorMapped = (analysisResult.competitors || []).map((c, i) => ({
        ...c, color: COMPETITOR_COLORS[i % COMPETITOR_COLORS.length],
      }));
      return { baseline: analysisResult.baseline, competitors: colorMapped, gaps: analysisResult.gaps || [], kayrosIndex: analysisResult.kayrosIndex ?? null };
    }
    const webResults = await searchCompetitors(ideaText);
    const comps = computeCompetitorScores(ideaText, webResults);
    const base = computeBaseline(ideaText);
    const gapList = computeGaps(base, comps, gapThreshold || 5);
    return { baseline: base, competitors: comps, gaps: gapList, kayrosIndex: null };
  }, []);

  const handleAnalyze = useCallback(async (ideaText) => {
    setLoading(true);
    setIdea(ideaText);
    setInspectedEntity(null);
    try {
      const result = await runAnalysis(ideaText, { gapThreshold: settings.gapThreshold, apiKey: settings.apiKey });
      setBaseline(result.baseline);
      setCompetitors(result.competitors);
      setGaps(result.gaps);
      setKi(result.kayrosIndex);
      addHistoryEntry({ idea: ideaText, ki: result.kayrosIndex, baseline: result.baseline, competitors: result.competitors, gaps: result.gaps });
      if (settings.slackWebhookUrl && settings.slackAutoSend) {
        sendToSlack(settings.slackWebhookUrl, { idea: ideaText, ki: result.kayrosIndex, competitors: result.competitors, gaps: result.gaps }).catch(() => {});
      }
      toast(result.kayrosIndex !== null ? t('app.toast.analysisComplete') : t('app.toast.analysisLocal'), { type: 'success' });
    } catch (e) {
      toast(`${t('app.toast.error')}: ${e.message || t('app.toast.analysisImpossible')}`, { type: 'error', duration: 6000 });
    } finally {
      setLoading(false);
    }
  }, [runAnalysis, settings, toast]);

  const handleNodeClick = useCallback((entity) => {
    setInspectedEntity(entity);
  }, []);

  const allInstances = [
    ...(baseline ? [{ name: 'Notre idée', color: '#6366f1', isBaseline: true, scores: baseline }] : []),
    ...competitors,
  ];
  const hasData = baseline || competitors.length > 0;
  const activeEvidence = selectedComp?.kpis || competitors[0]?.kpis || null;
  const evidenceLabels = locale === 'fr'
    ? {
        demo: 'Analyse de démonstration préchargée',
        agents: 'Agents : Positionneur · Ontology Designer · Query Engine',
        deliverable: 'Livrable : Ontologie + Graphe + Gap Analysis + Export OWL',
        web: 'Scraping web',
        github: 'GitHub KPIs',
        gitlab: 'GitLab KPIs',
        owl: 'OWL / RDF/XML',
        sources: 'sources',
        mentions: 'mentions',
        freshness: 'fraîcheur',
        stars: 'stars',
        forks: 'forks',
        contributors: 'contributeurs',
        commits: 'commits 90j',
        issues: 'issues',
        ontology: '14 types · 13 relations orientées',
        playground: 'Compatible Microsoft Ontology Playground',
      }
    : {
        demo: 'Preloaded demonstration analysis',
        agents: 'Agents: Positioner · Ontology Designer · Query Engine',
        deliverable: 'Deliverable: Ontology + Graph + Gap Analysis + OWL Export',
        web: 'Web scraping',
        github: 'GitHub KPIs',
        gitlab: 'GitLab KPIs',
        owl: 'OWL / RDF/XML',
        sources: 'sources',
        mentions: 'mentions',
        freshness: 'freshness',
        stars: 'stars',
        forks: 'forks',
        contributors: 'contributors',
        commits: '90d commits',
        issues: 'issues',
        ontology: '14 types · 13 oriented relationships',
        playground: 'Microsoft Ontology Playground compliant',
      };

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
              <button key={code} className={`locale-btn ${locale === code ? 'active' : ''}`} onClick={() => { setLocale(code); saveSettings({ ...settings, locale: code }); setSettings({ ...settings, locale: code }); }}>{label}</button>
            ))}
          </div>
        </div>
      </header>

      <div className="main-layout">
        <div className="main-content">
          <ErrorBoundary>
          <IdeaInput onAnalyze={handleAnalyze} loading={loading} />

          {loading && (
            <div className="loading-skeleton">
              <SkeletonChips />
              <SkeletonTabs />
              <SkeletonGraph />
            </div>
          )}

          {!loading && hasData && (
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

              {activeEvidence && (
                <section className="positioning-evidence" aria-label="Positioning analysis evidence">
                  <div className="evidence-intro">
                    <span className="evidence-demo">{evidenceLabels.demo}</span>
                    <strong>{evidenceLabels.agents}</strong>
                    <span>{evidenceLabels.deliverable}</span>
                  </div>
                  <div className="evidence-grid">
                    <article className="evidence-card">
                      <span className="evidence-card-title">🌐 {evidenceLabels.web}</span>
                      <strong>{activeEvidence.web.sources} {evidenceLabels.sources}</strong>
                      <span>{activeEvidence.web.mentions} {evidenceLabels.mentions} · {evidenceLabels.freshness} {activeEvidence.web.freshness}</span>
                    </article>
                    <article className="evidence-card">
                      <span className="evidence-card-title">⭐ {evidenceLabels.github}</span>
                      <strong>{activeEvidence.github.stars} {evidenceLabels.stars} · {activeEvidence.github.forks} {evidenceLabels.forks}</strong>
                      <span>{activeEvidence.github.contributors} {evidenceLabels.contributors} · {activeEvidence.github.commits90} {evidenceLabels.commits} · {activeEvidence.github.issues} {evidenceLabels.issues}</span>
                    </article>
                    <article className="evidence-card">
                      <span className="evidence-card-title">🦊 {evidenceLabels.gitlab}</span>
                      <strong>{activeEvidence.gitlab.stars} {evidenceLabels.stars} · {activeEvidence.gitlab.forks} {evidenceLabels.forks}</strong>
                      <span>{activeEvidence.gitlab.contributors} {evidenceLabels.contributors} · {activeEvidence.gitlab.commits90} {evidenceLabels.commits} · {evidenceLabels.freshness} {activeEvidence.gitlab.freshness}</span>
                    </article>
                    <article className="evidence-card">
                      <span className="evidence-card-title">🏷️ {evidenceLabels.owl}</span>
                      <strong>{evidenceLabels.ontology}</strong>
                      <span>{evidenceLabels.playground}</span>
                    </article>
                  </div>
                </section>
              )}

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
                <button className={`tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => { setActiveTab('history'); setCompareIds(null); }}>
                  📋 {t('app.tabs.history')}
                </button>
                <button className={`tab ${activeTab === 'multi' ? 'active' : ''}`} onClick={() => setActiveTab('multi')}>
                  📊 {t('app.tabs.multi')}
                </button>
                <button className={`tab ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
                  ⚙️ {t('app.tabs.settings')}
                </button>
                <button className={`tab ${activeTab === 'pipeline' ? 'active' : ''}`} onClick={() => setActiveTab('pipeline')}>
                  📋 {t('kanban.tab')}
                </button>
                <button className={`tab ${activeTab === 'campaigns' ? 'active' : ''}`} onClick={() => { setActiveTab('campaigns'); setCampaignView('list'); }}>
                  🏆 {t('app.tabs.campaigns')}
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
                  <>
                    <PdfExport idea={idea} competitors={competitors} baseline={baseline} ki={ki} gaps={gaps} />
                    {settings.slackWebhookUrl && (
                      <div className="export-bar">
                        <button className="btn btn-outline" onClick={async () => {
                          try {
                            await sendToSlack(settings.slackWebhookUrl, { idea, ki, competitors, gaps });
                            toast(t('app.toast.slackSent'), { type: 'success' });
                          } catch { toast(t('app.toast.slackFailed'), { type: 'error' }); }
                        }}>
                          📤 {t('app.toast.shareSlack')}
                        </button>
                      </div>
                    )}
                    <OWLExporter competitorList={competitors} baseline={baseline} />
                  </>
                )}

                {activeTab === 'pipeline' && (
                  <div className="pipeline-container">
                    <IdeaKanban />
                  </div>
                )}

                {activeTab === 'campaigns' && (
                  <div className="campaigns-container">
                    {campaignView === 'list' ? (
                      <CampaignList onSelect={(c) => setCampaignView(c.id)} />
                    ) : (
                      <CampaignDetail
                        campaignId={campaignView}
                        onBack={() => setCampaignView('list')}
                        onAnalyze={(idea) => runAnalysis(idea, { gapThreshold: settings.gapThreshold, apiKey: settings.apiKey })}
                      />
                    )}
                  </div>
                )}

                {activeTab === 'multi' && (
                  <div className="multi-container">
                    <MultiIdeaAnalysis
                      runAnalysis={runAnalysis}
                      gapThreshold={settings.gapThreshold}
                      apiKey={settings.apiKey}
                      toast={toast}
                    />
                  </div>
                )}

                {activeTab === 'settings' && (
                  <div className="settings-container">
                    <SettingsPage
                      analysisData={{ idea, ki, competitors, gaps }}
                      onSettingsChange={(s) => {
                        setSettings(s);
                        if (s.locale !== locale) setLocale(s.locale);
                      }}
                    />
                  </div>
                )}

                {activeTab === 'history' && (
                  <div className="history-container">
          {compareIds ? (
            <HistoryCompare
              entries={compareIds.map((id) => ({ id, ...getHistoryEntry(id) || {} })).filter((e) => e)}
              onClose={() => setCompareIds(null)}
            />
          ) : (
                      <HistoryList
                        onRestore={(entry) => {
                          setBaseline(entry.baseline);
                          setCompetitors(entry.competitors);
                          setGaps(entry.gaps);
                          setKi(entry.ki);
                          setIdea(entry.idea);
                          setActiveTab('graph');
                          toast(t('app.toast.restored'), { type: 'info' });
                        }}
                        onCompare={(ids) => setCompareIds(ids)}
                      />
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {!loading && !hasData && (
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

      {showTour && <OnboardingTour onFinish={() => setShowTour(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
