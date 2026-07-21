// KayrosLab — Scorecards parametrables (KI multi-grilles).
// Le KI reste le MOTEUR ; ce module rend criteres/poids/echelle configurables,
// avec une grille distincte par etape (screening leger vs evaluation approfondie).

/** Grille d'evaluation parametrable. */
export class Scorecard {
  /** @param {{id:string, stage:string, label?:string, scale?:number, criteria:{id:string,label?:string,weight?:number}[]}} cfg */
  constructor({ id, stage, label = null, scale = 10, criteria = [] } = {}) {
    if (!id) throw new Error('Scorecard: id requis');
    if (!Array.isArray(criteria) || !criteria.length) throw new Error('Scorecard: criteria requis');
    this.id = id; this.stage = stage; this.label = label ?? id; this.scale = scale;
    this.criteria = criteria.map((c) => ({ weight: 1, label: c.id, ...c }));
  }
  get totalWeight() { return this.criteria.reduce((n, c) => n + (Number(c.weight) || 0), 0); }

  /**
   * Calcule le score. `values` = { critereId: note } (note dans [0, scale]).
   * Renvoie total pondere, note normalisee 0..100, detail, et couverture.
   */
  score(values = {}) {
    const detail = [];
    let sum = 0, usedWeight = 0;
    for (const c of this.criteria) {
      const raw = values[c.id];
      if (typeof raw !== 'number' || Number.isNaN(raw)) { detail.push({ id: c.id, note: null, poids: c.weight }); continue; }
      const note = Math.max(0, Math.min(this.scale, raw));
      sum += note * c.weight; usedWeight += c.weight;
      detail.push({ id: c.id, note, poids: c.weight });
    }
    const evalues = detail.filter((d) => d.note !== null).length;
    const total = usedWeight > 0 ? sum / usedWeight : null;          // sur l'echelle de la grille
    const normalise = total === null ? null : Math.round((total / this.scale) * 10000) / 100; // 0..100
    return { scorecardId: this.id, stage: this.stage, echelle: this.scale, total: total === null ? null : Math.round(total * 100) / 100, normalise, detail, couverture: Math.round((evalues / this.criteria.length) * 100) / 100, evalue: evalues > 0 };
  }
}

/** Registre : plusieurs grilles, indexees par etape. */
export class ScorecardRegistry {
  constructor(cards = []) { this._byId = new Map(); cards.forEach((c) => this.register(c)); }
  register(card) {
    const sc = card instanceof Scorecard ? card : new Scorecard(card);
    this._byId.set(sc.id, sc); return this;
  }
  get(id) { return this._byId.get(id) ?? null; }
  list() { return [...this._byId.values()]; }
  /** Grilles applicables a une etape. */
  forStage(stage) { return this.list().filter((c) => c.stage === stage); }
  /** Score une idee avec la (premiere) grille de son etape. */
  scoreForStage(stage, values) {
    const card = this.forStage(stage)[0];
    if (!card) return null;
    return card.score(values);
  }
}

/**
 * Grilles par defaut, alignees sur les 5 dimensions strategiques du KI.
 * - screening : leger, echelle 10 (tri rapide en amont)
 * - evaluation : approfondi, echelle 100 (avant arbitrage)
 */
export function defaultScorecards() {
  return new ScorecardRegistry([
    new Scorecard({
      id: 'screening', stage: 'ecouter', label: 'Screening (tri rapide)', scale: 10,
      criteria: [
        { id: 'fit', label: 'Fit stratégique', weight: 2 },
        { id: 'desirabilite', label: 'Désirabilité', weight: 1 },
        { id: 'faisabilite', label: 'Faisabilité', weight: 1 },
      ],
    }),
    new Scorecard({
      id: 'evaluation', stage: 'arbitrer', label: 'Évaluation approfondie', scale: 100,
      criteria: [
        { id: 'fit', label: 'Fit stratégique', weight: 2 },
        { id: 'desirabilite', label: 'Désirabilité', weight: 2 },
        { id: 'faisabilite', label: 'Faisabilité', weight: 1.5 },
        { id: 'viabilite', label: 'Viabilité', weight: 2 },
        { id: 'adaptabilite', label: 'Adaptabilité', weight: 1 },
      ],
    }),
  ]);
}
