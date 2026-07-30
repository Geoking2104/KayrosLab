import { useState, useEffect } from 'react';
import { useI18n } from '../i18n/I18nContext.jsx';
import { getApiBase } from '../collectors/scanner.js';

const STAGES = ['recueillir', 'ecouter', 'cartographier', 'construire', 'eprouver', 'arbitrer', 'projeter', 'realiser'];

const API_BASE = getApiBase();
const DASHBOARD_ENDPOINT = `${API_BASE}/v1/reporting/dashboard`;
const LEADERBOARD_ENDPOINT = `${API_BASE}/v1/reporting/leaderboard`;

const STAGE_LABELS = {
  recueillir: 'Collect', ecouter: 'Listen', cartographier: 'Map',
  construire: 'Build', eprouver: 'Test', arbitrer: 'Arbitrate',
  projeter: 'Project', realiser: 'Realize',
};

const STAGE_COLORS = [
  '#94a3b8', '#60a5fa', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#22c55e',
];

function r2(x) { return x === null || x === undefined ? '—' : Math.round(x * 100) / 100; }

async function fetchDashboard() {
  try {
    const res = await fetch(DASHBOARD_ENDPOINT);
    if (!res.ok) throw new Error(`Dashboard HTTP ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchLeaderboard() {
  try {
    const res = await fetch(LEADERBOARD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ critere: 'ki', sens: 'desc', top: 5 }),
    });
    if (!res.ok) throw new Error(`Leaderboard HTTP ${res.status}`);
    return await res.json();
  } catch {
    return { leaderboard: { items: [] } };
  }
}

export default function StrategicDashboard() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [topIdeas, setTopIdeas] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchDashboard(), fetchLeaderboard()]).then(([dash, lb]) => {
      if (cancelled) return;
      setData(dash);
      setTopIdeas(lb?.leaderboard?.items ?? []);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="dashboard">
        <div className="loading-bar">
          <div className="loading-fill" />
          <span>{t('app.analyzing')}</span>
        </div>
      </div>
    );
  }

  if (!data || !data.dashboard || data.dashboard.total === 0) {
    return (
      <div className="dashboard">
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <p>{t('app.dashboard.noData')}</p>
        </div>
      </div>
    );
  }

  const { dashboard: d, funnel: f, tempsParEtape: tpe } = data;
  const fin = d.portefeuilleFinancier;

  return (
    <div className="dashboard">
      <h2 className="dashboard-title">{t('app.dashboard.title')}</h2>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi-card"><span className="kpi-value">{d.total}</span><span className="kpi-label">{t('app.dashboard.total')}</span></div>
        <div className="kpi-card"><span className="kpi-value">{d.actives}</span><span className="kpi-label">{t('app.dashboard.active')}</span></div>
        <div className="kpi-card"><span className="kpi-value">{d.abandonnees}</span><span className="kpi-label">{t('app.dashboard.abandoned')}</span></div>
        <div className="kpi-card"><span className="kpi-value">{d.tauxAbandon !== null ? `${Math.round(d.tauxAbandon * 100)}%` : '—'}</span><span className="kpi-label">{t('app.dashboard.abandonRate')}</span></div>
        <div className="kpi-card"><span className="kpi-value">{d.kiMoyen !== null ? d.kiMoyen : '—'}</span><span className="kpi-label">{t('app.dashboard.avgKi')}</span></div>
      </div>

      {/* Two-column layout */}
      <div className="dashboard-columns">
        {/* Stage Distribution */}
        <div className="dashboard-card">
          <h3 className="card-title">{t('app.dashboard.stageDist')}</h3>
          <div className="bar-chart">
            {STAGES.map((s, i) => {
              const val = d.parEtape[s] ?? 0;
              const max = Math.max(...STAGES.map((st) => d.parEtape[st] ?? 0), 1);
              return (
                <div key={s} className="bar-row">
                  <span className="bar-label">{STAGE_LABELS[s] || s}</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(val / max) * 100}%`, background: STAGE_COLORS[i % STAGE_COLORS.length] }} />
                  </div>
                  <span className="bar-value">{val}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Financial Portfolio */}
        <div className="dashboard-card">
          <h3 className="card-title">{t('app.dashboard.financialTitle')}</h3>
          <div className="fin-grid">
            <div className="fin-item">
              <span className="fin-label">{t('app.dashboard.invested')}</span>
              <span className="fin-value">€{fin.investi.toLocaleString()}</span>
            </div>
            <div className="fin-item">
              <span className="fin-label">{t('app.dashboard.benefit')}</span>
              <span className="fin-value fin-positive">€{fin.beneficie.toLocaleString()}</span>
            </div>
            <div className="fin-item">
              <span className="fin-label">{t('app.dashboard.net')}</span>
              <span className={`fin-value ${fin.net >= 0 ? 'fin-positive' : 'fin-negative'}`}>
                €{fin.net.toLocaleString()}
              </span>
            </div>
            <div className="fin-item">
              <span className="fin-label">{t('app.dashboard.roi')}</span>
              <span className={`fin-value ${fin.roiAgrege !== null && fin.roiAgrege >= 0 ? 'fin-positive' : ''}`}>
                {fin.roiAgrege !== null ? `${Math.round(fin.roiAgrege * 100)}%` : '—'}
              </span>
            </div>
          </div>
          {fin.idesAvecImpact > 0 && (
            <div className="fin-note">Based on {fin.idesAvecImpact} idea(s) with financial data</div>
          )}
        </div>
      </div>

      {/* Funnel Table & Top Ideas */}
      <div className="dashboard-columns">
        <div className="dashboard-card">
          <h3 className="card-title">{t('app.dashboard.funnel')}</h3>
          <table className="funnel-table">
            <thead>
              <tr>
                <th>{t('app.dashboard.stage')}</th>
                <th>{t('app.dashboard.count')}</th>
                <th>{t('app.dashboard.conversion')}</th>
              </tr>
            </thead>
            <tbody>
              {(f?.etapes ?? []).map((e) => (
                <tr key={e.stage}>
                  <td>{STAGE_LABELS[e.stage] || e.stage}</td>
                  <td>{e.atteintes}</td>
                  <td>{e.conversion !== null ? `${Math.round(e.conversion * 100)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="dashboard-card">
          <h3 className="card-title">{t('app.dashboard.topIdeas')}</h3>
          <div className="top-ideas">
            {topIdeas.map((idea, i) => (
              <div key={idea.id} className="top-idea-row">
                <span className="top-rank">#{i + 1}</span>
                <span className="top-title">{idea.titre}</span>
                <span className="top-ki">{idea.ki ?? idea.score}</span>
              </div>
            ))}
            {topIdeas.length === 0 && <div className="empty-hint">{t('app.dashboard.noData')}</div>}
          </div>
        </div>
      </div>

      {/* Stage Timing */}
      <div className="dashboard-card">
        <h3 className="card-title">{t('app.dashboard.timing')}</h3>
        <table className="funnel-table">
          <thead>
            <tr>
              <th>{t('app.dashboard.stage')}</th>
              <th>{t('app.dashboard.timing')} ({t('app.dashboard.days')})</th>
            </tr>
          </thead>
          <tbody>
            {(tpe ?? []).map((s) => (
              <tr key={s.stage}>
                <td>{STAGE_LABELS[s.stage] || s.stage}</td>
                <td>{s.moyenneJours !== null ? r2(s.moyenneJours) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
