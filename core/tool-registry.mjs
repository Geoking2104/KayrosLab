// KayrosLab — Tool Registry (outils déclaratifs pour l'orchestrateur / function calling).
// Réf. specs techniques §4.

/**
 * @typedef {{name:string, description:string, inputKeys?:string[], sideEffect?:'none'|'read'|'write', gate?:boolean, handler:(input:any,ctx?:any)=>Promise<any>}} ToolDef
 */

export class ToolRegistry {
  constructor() { this._tools = new Map(); }

  /** @param {ToolDef} tool */
  register(tool) {
    if (!tool || !tool.name || typeof tool.handler !== 'function') {
      throw new Error('ToolDef invalide : name + handler requis');
    }
    this._tools.set(tool.name, { sideEffect: 'none', gate: false, inputKeys: [], ...tool });
    return this;
  }

  get(name) { return this._tools.get(name); }
  list() { return [...this._tools.values()]; }

  /** Validation minimale des entrées (clés requises présentes). */
  validate(name, input) {
    const t = this.get(name);
    if (!t) throw new Error(`Outil inconnu: ${name}`);
    const missing = (t.inputKeys || []).filter((k) => !(input && k in input));
    if (missing.length) throw new Error(`Entrée invalide pour ${name}: clés manquantes ${missing.join(', ')}`);
    return true;
  }

  /** Exécute un outil (après validation). Les outils `write` peuvent exiger un gate côté orchestrateur. */
  async call(name, input, ctx) {
    this.validate(name, input);
    return this.get(name).handler(input, ctx);
  }

  /** Export au format "function calling" générique (adaptable par provider). */
  toLLMSpec() {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: { type: 'object', required: t.inputKeys || [] },
    }));
  }
}

/** Outils de démonstration (déterministes). */
export function demoTools() {
  const reg = new ToolRegistry();
  reg.register({
    name: 'search_regulatory_risks', description: 'Recherche de risques réglementaires',
    inputKeys: ['domaine'], sideEffect: 'read',
    handler: async ({ domaine }) => ({ risques: [`Risque réglementaire type pour ${domaine}`] }),
  });
  reg.register({
    name: 'calculate_ki_impact', description: 'Impact estimé d’un changement sur le KI',
    inputKeys: ['ideaId', 'changement'], sideEffect: 'read',
    handler: async ({ changement }) => ({ delta_KI: Math.min(2, (changement?.length || 0) / 50) }),
  });
  return reg;
}
