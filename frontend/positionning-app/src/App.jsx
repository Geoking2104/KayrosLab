import { useState, useCallback, useEffect } from 'react';
import { ENTITY_TYPES } from './data/ontology.js';
import { analyzeIdea } from './collectors/scanner.js';
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

function averageScore(scores) {
  const values = Object.values(scores);
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function shouldShowTour() {
  try {
    return new URLSearchParams(window.location.search).has('tour') && !isTourCompleted();
  } catch {
    return false;
  }
}

function AppInner() {
  const { t, locale, setLocale, available } = useI18n();
  const toast = useToast();
  const [idea, setIdea] = useState('');
  const [competitors, setCompetitors] = useState([]);
  const [gaps, setGaps] = useState([]);
  const [baseline, setBaseline] = useState(null);
  const [ki, setKi] = useState(null);
  const [analysisMeta, setAnalysisMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [inspectedEntity, setInspectedEntity] = useState(() => ENTITY_TYPES.find((entity) => entity.id === 'ia_ml') || ENTITY_TYPES[0]);
  const [selectedComp, setSelectedComp] = useState(null);
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
    const opts = {
      gapThreshold,
      headers: apiKey ? { 'X-Kayros-Secret': apiKey } : {},
    };
    const analysisResult = await analyzeIdea(ideaText, opts);
    const colorMapped = (analysisResult.competitors || []).map((c, i) => ({
      ...c,
      color: COMPETITOR_COLORS[i % COMPETITOR_COLORS.length],
    }));
    const normalizedGaps = (analysisResult.gaps || []).map((gap) => ({
      ...gap,
      neuronId: gap.neuronId ?? gap.entityId,
    }));
    return {
      baseline: analysisResult.baseline,
      competitors: colorMapped,
      gaps: normalizedGaps,
      kayrosIndex: analysisResult.kayrosIndex ?? null,
      meta: {
        refinedIdea: analysisResult.refinedIdea || '',
        positioningSummary: analysisResult.positioningSummary || '',
        differentiationHypotheses: analysisResult.differentiationHypotheses || [],
        sourceCoverage: analysisResult.sourceCoverage || analysisResult.summary?.sourceCoverage || [],
        providerMode: analysisResult.providerMode || '',
      },
    };
  }, []);

  const handleAnalyze = useCallback(async (ideaText) => {
    setLoading(true);
    setIdea(ideaText);
    setInspectedEntity(null);
    setAnalysisMeta(null);
    try {
      const result = await runAnalysis(ideaText, { gapThreshold: settings.gapThreshold, apiKey: settings.apiKey });
      setBaseline(result.baseline);
      setCompetitors(result.competitors);
      setGaps(result.gaps);
      setKi(result.kayrosIndex);
      setAnalysisMeta(result.meta);
      setSelectedComp(result.competitors[0] || null);
      addHistoryEntry({ idea: ideaText, ki: result.kayrosIndex, baseline: result.baseline, competitors: result.competitors, gaps: result.gaps });
      if (settings.slackWebhookUrl && settings.slackAutoSend) {
        sendToSlack(settings.slackWebhookUrl, { idea: ideaText, ki: result.kayrosIndex, competitors: result.competitors, gaps: result.gaps }).catch(() => {});
      }
      toast(result.kayrosIndex !== null ? t('app.toast.analysisComplete') : t('app.toast.analysisLocal'), { type: 'success' });
    } catch (e) {
      setAnalysisMeta(null);
      toast(`${t('app.toast.error')}: ${e.message || t('app.toast.analysisImpossible')}`, { type: 'error', duration: 6000 });
    } finally {
      setLoading(false);
    }
  }, [runAnalysis, settings, toast]);

  const handleNodeClick = useCallback((entity) => {
    setInspectedEntity(entity);
  }, []);

  const allInstances = [
    ...(baseline ? [{ name: 'Notre idée', color: '#6366f1', isBaseline: true, scores: baseline, avgScore: averageScore(baseline) }] : []),
    ...competitors,
  ];
  const hasData = baseline || competitors.length > 0;
  const activeEvidence = selectedComp?.kpis || competitors[0]?.kpis || null;
  const evidenceLabels = locale === 'fr'
    ? {
        demo: 'Recherche contextuelle Mistral selon la saisie',
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
        refinedIdea: 'Idée finetunée',
        summary: 'Synthèse',
        sourcesCompared: 'Bases comparées',
      }
    : {
        demo: 'Mistral contextual search based on the prompt',
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
        refinedIdea: 'Fine-tuned idea',
        summary: 'Summary',
        sourcesCompared: 'Compared bases',
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
                  {analysisMeta && (
                    <div className="positioning-meta">
                      {analysisMeta.refinedIdea && (
                        <div>
                          <strong>{evidenceLabels.refinedIdea}</strong>
                          <span>{analysisMeta.refinedIdea}</span>
                        </div>
                      )}
                      {analysisMeta.positioningSummary && (
                        <div>
                          <strong>{evidenceLabels.summary}</strong>
                          <span>{analysisMeta.positioningSummary}</span>
                        </div>
                      )}
                      {analysisMeta.sourceCoverage?.length > 0 && (
                        <div className="source-coverage">
                          <strong>{evidenceLabels.sourcesCompared}</strong>
                          <span>{analysisMeta.sourceCoverage.map((source) => `${source.label}: ${source.count}`).join(' · ')}</span>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="evidence-grid">
                    <article className="evidence-card">
                      <span className="evidence-card-title">🌐 {evidenceLabels.web}</span>
                      <strong>{activeEvidence.web?.sources ?? 'n/a'} {evidenceLabels.sources}</strong>
                      <span>{activeEvidence.web?.mentions ?? 'n/a'} {evidenceLabels.mentions} · {evidenceLabels.freshness} {activeEvidence.web?.freshness ?? 'n/a'}</span>
                    </article>
                    <article className="evidence-card">
                      <span className="evidence-card-title">⭐ {evidenceLabels.github}</span>
                      <strong>{activeEvidence.github?.stars ?? 'n/a'} {evidenceLabels.stars} · {activeEvidence.github?.forks ?? 'n/a'} {evidenceLabels.forks}</strong>
                      <span>{activeEvidence.github?.contributors ?? 'n/a'} {evidenceLabels.contributors} · {activeEvidence.github?.commits90 ?? 'n/a'} {evidenceLabels.commits} · {activeEvidence.github?.issues ?? 'n/a'} {evidenceLabels.issues}</span>
                    </article>
                    <article className="evidence-card">
                      <span className="evidence-card-title">🦊 {evidenceLabels.gitlab}</span>
                      <strong>{activeEvidence.gitlab?.stars ?? 'n/a'} {evidenceLabels.stars} · {activeEvidence.gitlab?.forks ?? 'n/a'} {evidenceLabels.forks}</strong>
                      <span>{activeEvidence.gitlab?.contributors ?? 'n/a'} {evidenceLabels.contributors} · {activeEvidence.gitlab?.commits90 ?? 'n/a'} {evidenceLabels.commits} · {evidenceLabels.freshness} {activeEvidence.gitlab?.freshness ?? 'n/a'}</span>
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
                          setSelectedComp(entry.competitors?.[0] || null);
                          setAnalysisMeta(null);
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
