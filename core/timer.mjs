// KayrosLab — Stage Timer : deadlines automatiques par etape
// Chaque etape du processus (ou hackathon) peut avoir une duree max.
// Un depassement declenche un gate d'alerte pour le role approprie.

import { STAGES } from './model.mjs';

const HOUR_MS = 3_600_000;

/** Seuils par defaut (hackathon : temps courts, processus strategic : longs). */
export const DEFAULT_STAGE_LIMITS = {
  recueillir:    { maxHours: 24,  autoGate: 'expert_review',    warningAt: 0.8 },
  ecouter:       { maxHours: 12,  autoGate: null,               warningAt: 0.8 },
  cartographier: { maxHours: 12,  autoGate: null,               warningAt: 0.8 },
  construire:    { maxHours: 48,  autoGate: 'expert_review',    warningAt: 0.8 },
  eprouver:      { maxHours: 24,  autoGate: 'red_team_veto',    warningAt: 0.75 },
  arbitrer:      { maxHours: 12,  autoGate: 'comex_arbitrage',  warningAt: 0.75 },
  projeter:      { maxHours: 24,  autoGate: null,               warningAt: 0.8 },
  realiser:      { maxHours: null, autoGate: null,              warningAt: null },
};

export class StageTimer {
  /**
   * @param {{governance?:(opts:any)=>any, limits?:object, onDeadline?:(ideaId:string, stage:string, ev:object)=>any}} [opts]
   */
  constructor({ governance = null, limits = DEFAULT_STAGE_LIMITS, onDeadline = null } = {}) {
    this._deadlines = new Map();
    this._limits = { ...DEFAULT_STAGE_LIMITS, ...limits };
    this.governance = governance;
    this.onDeadline = onDeadline;
  }

  /**
   * Fixe ou prolonge la deadline d'une idee a son etape courante.
   * @param {string} ideaId
   * @param {string} stage
   * @param {{maxHours?:number, deadline?:string, etapeFlexible?:boolean}} [opts]
   */
  setDeadline(ideaId, stage, { maxHours, deadline, etapeFlexible } = {}) {
    const limit = this._limits[stage];
    if (!limit) return;
    const h = maxHours ?? limit.maxHours;
    if (h == null) return;
    const d = deadline ? new Date(deadline) : new Date(Date.now() + h * HOUR_MS);
    this._deadlines.set(ideaId, {
      stage, deadline: d, warned: false,
      flexible: etapeFlexible ?? false,
      startedAt: new Date(),
    });
  }

  /** Supprime le timer d'une idee. */
  clear(ideaId) { this._deadlines.delete(ideaId); }

  /** Prolonge la deadline d'une idee (ex: mentor accorde du temps supplementaire). */
  prolong(ideaId, extraHours = 2) {
    const rec = this._deadlines.get(ideaId);
    if (!rec) return false;
    rec.deadline = new Date(rec.deadline.getTime() + extraHours * HOUR_MS);
    return true;
  }

  /**
   * Verifie les depassements. Retourne les idees en alerte.
   * @returns {{overdue:object[], warning:object[], ok:string[]}}
   */
  check() {
    const now = new Date();
    const overdue = [], warning = [], ok = [];
    for (const [ideaId, rec] of this._deadlines) {
      const limit = this._limits[rec.stage];
      const elapsed = (now - rec.startedAt) / HOUR_MS;
      const max = limit?.maxHours;
      if (max == null) { ok.push(ideaId); continue; }
      if (now >= rec.deadline) {
        overdue.push({ ideaId, stage: rec.stage, deadline: rec.deadline, elapsed, max });
      } else if (elapsed >= max * (limit.warningAt ?? 0.8)) {
        warning.push({ ideaId, stage: rec.stage, deadline: rec.deadline, elapsed, max });
      } else {
        ok.push(ideaId);
      }
    }
    return { overdue, warning, ok };
  }

  /**
   * Tick : verifie les deadines, ouvre des gates pour les depassements,
   * emet des evenements warning pour les seuils d'alerte.
   * @param {{now?:Date, opener?:{ideaId:string, type:string, requiredRole:string, payload:string}}} [ctx]
   * @returns {Promise<{gates:object[], warnings:object[]}>}
   */
  async tick(ctx = {}) {
    const { overdue, warning } = this.check();
    const gates = [], warnings = [];
    const now = ctx?.now ?? new Date();
    for (const ev of overdue) {
      if (this.onDeadline) {
        try { await this.onDeadline(ev.ideaId, ev.stage, ev); } catch { /* non bloquant */ }
      }
      if (this.governance) {
        const limit = this._limits[ev.stage];
        const gateType = limit?.autoGate ?? 'expert_review';
        const requiredRole = gateType === 'comex_arbitrage' ? 'comex' : (gateType === 'red_team_veto' ? 'red_team' : 'facilitateur');
        try {
          const { gateId } = this.governance.open({
            ideaId: ev.ideaId, type: gateType, requiredRole,
            payload: `Deadline dépassée pour l'étape "${ev.stage}" (${Math.round(ev.elapsed - ev.max)}h de retard)`,
          });
          gates.push({ gateId, ideaId: ev.ideaId, stage: ev.stage, type: gateType });
        } catch { /* non bloquant */ }
      }
    }
    for (const ev of warning) {
      warnings.push(ev);
    }
    return { gates, warnings };
  }

  /**
   * Etat courant pour le monitoring.
   */
  status() {
    const { overdue, warning, ok } = this.check();
    const total = this._deadlines.size;
    const parStage = {};
    for (const [id, rec] of this._deadlines) {
      parStage[rec.stage] = (parStage[rec.stage] ?? 0) + 1;
    }
    return {
      total, enAlarme: overdue.length, enAlerte: warning.length, ok: ok.length,
      pourcentageAlarme: total ? Math.round((overdue.length / total) * 100) : 0,
      parStage,
    };
  }
}
