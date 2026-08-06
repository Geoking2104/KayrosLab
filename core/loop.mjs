// KayrosLab — Boucle Projeter -> Ecouter (EF-43).
// Evalue periodiquement les KPIs de suivi ; si un seuil est franchi, produit des signaux
// a re-injecter dans le corpus d'Ecouter et propose un re-arbitrage.
// V16: also surfaces KPI drift alerts via kpi-drift.mjs.
// Ordonnanceur injectable => testable sans timers reels.

import { evaluateKpiDrifts, driftsToSignals } from './kpi-drift.mjs';

/** Compare une valeur a un seuil selon un comparateur. */
function compare(v, cmp, t) {
  switch (cmp) {
    case 'lte': return v <= t;
    case 'lt': return v < t;
    case 'gte': return v >= t;
    case 'gt': return v > t;
    case 'eq': return v === t;
    default: return false;
  }
}

/**
 * Evalue les KPIs face aux relevés. Deterministe et pur.
 * @param {{id:string, name?:string, threshold:number, comparator?:'lte'|'lt'|'gte'|'gt'|'eq'}[]} kpis
 * @param {{kpiId?:string, id?:string, value:number}[]} readings
 * @returns {{alerts:any[], ok:any[]}}
 */
export function evaluateKpis(kpis = [], readings = []) {
  const byId = new Map(readings.map((r) => [r.kpiId ?? r.id, r.value]));
  const alerts = [], ok = [];
  for (const k of kpis) {
    const value = byId.get(k.id);
    if (value === undefined) continue;
    const cmp = k.comparator ?? 'lte';
    const row = { kpiId: k.id, name: k.name ?? k.id, value, threshold: k.threshold, comparator: cmp };
    (compare(value, cmp, k.threshold) ? alerts : ok).push(row);
  }
  return { alerts, ok };
}

/** Transforme des alertes KPI en signaux re-injectables dans Ecouter. */
export function alertsToSignals(alerts = [], { ideaId = 'idea', now } = {}) {
  const ts = typeof now === 'function' ? now : () => new Date().toISOString();
  return alerts.map((a, i) => ({
    id: `${ideaId}:loop:${a.kpiId}:${i}`,
    source: 'projeter-loop',
    date: ts(),
    contenu: `Seuil KPI "${a.name}" franchi (${a.value} ${a.comparator} ${a.threshold}) — a re-surveiller.`,
    kpiId: a.kpiId,
  }));
}

/**
 * Combined threshold + drift evaluation for a monitoring tick (V16).
 * @param {Object[]} kpis
 * @param {{value:number, ts?:string, kpiId?:string}[]} readings
 * @param {{ideaId?:string}} [opts]
 * @returns {{ alerts:any[], drifts:any[], signals:any[], ok:any[] }}
 */
export function evaluateKpisWithDrift(kpis = [], readings = [], opts = {}) {
  const { alerts, ok } = evaluateKpis(kpis, readings);
  const { drifts } = evaluateKpiDrifts(kpis, readings);
  const thresholdSignals = alertsToSignals(alerts, opts);
  const driftSignals = driftsToSignals(drifts, opts);
  return {
    alerts,
    drifts,
    ok,
    signals: [...thresholdSignals, ...driftSignals],
  };
}

const defaultScheduler = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h),
};

/** Boucle de surveillance a intervalle. `scheduler` injectable pour les tests. */
export class MonitoringLoop {
  constructor({ task, scheduler = defaultScheduler } = {}) {
    if (typeof task !== 'function') throw new Error('MonitoringLoop: task (fonction) requis');
    this.task = task; this.scheduler = scheduler; this._handle = null; this.running = false;
  }
  async tick() { return this.task(); }
  start(intervalMs = 3600000) {
    if (this.running) return this;
    this.running = true;
    this._handle = this.scheduler.setInterval(() => { Promise.resolve(this.tick()).catch(() => {}); }, intervalMs);
    return this;
  }
  stop() {
    if (this._handle != null) this.scheduler.clearInterval(this._handle);
    this._handle = null; this.running = false; return this;
  }
}
