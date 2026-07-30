// KayrosLab — Canvas : workflows declaratifs.
// EF-248 (DSL YAML), EF-249 (declencheurs), EF-250 (actions),
// EF-251 (un workflow ne franchit jamais un gate et ne decide jamais).
//
// Transposition B3 de Buzz. La difference tient a EF-251 : chez Buzz un
// workflow peut approuver ; ici il prepare et notifie, jamais il ne tranche.

import { canAct } from './identity.mjs';

// ---------------------------------------------------------------------------
// Parseur YAML — sous-ensemble
// ---------------------------------------------------------------------------

/**
 * SOUS-ENSEMBLE SUPPORTE : mappings, sequences, scalaires (chaine, nombre,
 * booleen, null), imbrication par indentation, commentaires `#`, chaines
 * quotees, sequences en ligne `[a, b]`.
 *
 * NON SUPPORTE : ancres et alias (`&`/`*`), multi-documents (`---`), blocs
 * litteraux (`|`, `>`), cles complexes, tags.
 *
 * Ecrire un parseur YAML complet serait une erreur ; en importer un ferait
 * sauter la contrainte zero dependance du coeur. Un DSL de workflow n'a pas
 * besoin de tout YAML — et ce qui n'est pas supporte leve une erreur explicite
 * plutot que d'etre mal interprete.
 */
export function parseYAML(texte) {
  const lignes = String(texte ?? '').split('\n');
  const propres = [];
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i];
    if (/^\s*(#.*)?$/.test(l)) continue;                       // vide ou commentaire
    if (/^\s*---\s*$/.test(l)) { if (propres.length) throw new Error('parseYAML: multi-documents non supporte'); continue; }
    // L'ancre suit generalement la cle (`a: &nom valeur`), pas le debut de
    // ligne : la tester en tete la laissait passer et produisait la chaine
    // "&nom valeur" comme si de rien n'etait.
    if (/(^|:\s+)[&*][A-Za-z_]/.test(l)) throw new Error(`parseYAML: ancres/alias non supportes (ligne ${i + 1})`);
    if (/:\s*[|>]\s*$/.test(l)) throw new Error(`parseYAML: blocs litteraux non supportes (ligne ${i + 1})`);
    if (l.includes('\t')) throw new Error(`parseYAML: tabulation interdite en YAML (ligne ${i + 1})`);
    propres.push({ n: i + 1, indent: l.match(/^ */)[0].length, texte: l.trim() });
  }
  if (!propres.length) return null;
  const [valeur, suivant] = bloc(propres, 0, propres[0].indent);
  if (suivant < propres.length) throw new Error(`parseYAML: indentation incoherente (ligne ${propres[suivant].n})`);
  return valeur;
}

function scalaire(brut) {
  const s = String(brut).trim();
  if (s === '') return null;
  if (/^(null|~)$/i.test(s)) return null;
  if (/^true$/i.test(s)) return true;
  if (/^false$/i.test(s)) return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d*\.\d+$/.test(s)) return Number(s);
  if (/^"(.*)"$/.test(s)) return s.slice(1, -1).replace(/\\"/g, '"');
  if (/^'(.*)'$/.test(s)) return s.slice(1, -1);
  if (/^\[.*\]$/.test(s)) {
    const dedans = s.slice(1, -1).trim();
    return dedans ? dedans.split(',').map((x) => scalaire(x)) : [];
  }
  return s;
}

function bloc(lignes, i, indent) {
  if (i >= lignes.length) return [null, i];
  if (lignes[i].texte.startsWith('- ') || lignes[i].texte === '-') {
    const out = [];
    while (i < lignes.length && lignes[i].indent === indent && (lignes[i].texte.startsWith('- ') || lignes[i].texte === '-')) {
      const reste = lignes[i].texte.slice(1).trim();
      if (!reste) {
        const [v, j] = bloc(lignes, i + 1, lignes[i + 1]?.indent ?? indent + 2);
        out.push(v); i = j;
      } else if (reste.includes(':') && !/^["'[]/.test(reste)) {
        // Element de sequence qui est lui-meme un mapping en ligne.
        const virtuel = [{ ...lignes[i], texte: reste, indent: indent + 2 }];
        let j = i + 1;
        while (j < lignes.length && lignes[j].indent > indent) { virtuel.push(lignes[j]); j++; }
        const [v] = bloc(virtuel, 0, indent + 2);
        out.push(v); i = j;
      } else { out.push(scalaire(reste)); i++; }
    }
    return [out, i];
  }
  const obj = {};
  while (i < lignes.length && lignes[i].indent === indent) {
    const m = lignes[i].texte.match(/^([^:]+):\s*(.*)$/);
    if (!m) throw new Error(`parseYAML: ligne ${lignes[i].n} invalide ("${lignes[i].texte}")`);
    const cle = scalaire(m[1]);
    const valeurEnLigne = m[2].trim();
    if (valeurEnLigne) { obj[cle] = scalaire(valeurEnLigne); i++; continue; }
    const suivant = lignes[i + 1];
    if (suivant && suivant.indent > indent) {
      const [v, j] = bloc(lignes, i + 1, suivant.indent);
      obj[cle] = v; i = j;
    } else { obj[cle] = null; i++; }
  }
  return [obj, i];
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** EF-249 : declencheurs supportes. */
export const DECLENCHEURS = Object.freeze([
  'node.created', 'node.updated', 'cluster.entered', 'score.threshold',
  'gate.opened', 'gate.resolved', 'schedule', 'webhook',
]);

/** EF-250 : actions supportees. */
export const ACTIONS = Object.freeze([
  'swarm', 'red-team', 'node.create', 'notify', 'gate.open', 'promote', 'framework',
]);

/**
 * EF-251 : actions qu'un workflow ne peut PAS declencher.
 * `gate.open` reste permis — ouvrir un gate, c'est convoquer une decision
 * humaine, pas la prendre. Le fermer est une autre affaire.
 */
export const ACTIONS_INTERDITES_WORKFLOW = Object.freeze([
  'gate.resolve', 'veto', 'decision.apply', 'moderation.reject', 'moderation.approve',
]);

/**
 * Valide un workflow. Renvoie les erreurs plutot que de lever : un fichier de
 * workflow contient souvent plusieurs fautes, et les livrer une par une
 * rendrait la mise au point penible.
 */
export function validateWorkflow(wf) {
  const erreurs = [];
  if (!wf || typeof wf !== 'object') return { ok: false, erreurs: ['workflow vide ou illisible'] };
  if (!wf.nom) erreurs.push('champ "nom" requis');
  if (!wf.declencheur) erreurs.push('champ "declencheur" requis');
  else {
    const t = wf.declencheur.type;
    if (!DECLENCHEURS.includes(t)) erreurs.push(`declencheur inconnu "${t}" (attendus : ${DECLENCHEURS.join(', ')})`);
    if (t === 'schedule' && !wf.declencheur.cron) erreurs.push('declencheur "schedule" : champ "cron" requis');
    if (t === 'score.threshold' && typeof wf.declencheur.seuil !== 'number') erreurs.push('declencheur "score.threshold" : champ "seuil" numerique requis');
  }
  const actions = Array.isArray(wf.actions) ? wf.actions : [];
  if (!actions.length) erreurs.push('au moins une action requise');
  actions.forEach((a, i) => {
    if (!a?.type) { erreurs.push(`action ${i + 1} : champ "type" requis`); return; }
    if (ACTIONS_INTERDITES_WORKFLOW.includes(a.type)) {
      erreurs.push(`action ${i + 1} : "${a.type}" interdite — un workflow prepare une decision, il ne la prend pas (EF-251)`);
      return;
    }
    if (!ACTIONS.includes(a.type)) erreurs.push(`action ${i + 1} : type inconnu "${a.type}"`);
  });
  return { ok: erreurs.length === 0, erreurs };
}

/** Charge un workflow depuis du YAML, en validant. */
export function loadWorkflow(yaml) {
  const wf = parseYAML(yaml);
  const v = validateWorkflow(wf);
  if (!v.ok) { const e = new Error(`workflow invalide :\n- ${v.erreurs.join('\n- ')}`); e.code = 'WORKFLOW_INVALIDE'; e.erreurs = v.erreurs; throw e; }
  return wf;
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/** Lit un chemin `a.b.c` dans un objet. */
function lire(obj, chemin) {
  return String(chemin).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

const OPERATEURS = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  gt: (a, b) => Number(a) > Number(b),
  gte: (a, b) => Number(a) >= Number(b),
  lt: (a, b) => Number(a) < Number(b),
  lte: (a, b) => Number(a) <= Number(b),
  contient: (a, b) => String(a ?? '').toLowerCase().includes(String(b).toLowerCase()),
  dans: (a, b) => (Array.isArray(b) ? b : [b]).includes(a),
};

/**
 * Evalue les conditions d'un workflow.
 * Une condition portant sur un champ ABSENT est fausse, jamais vraie par
 * defaut : un workflow ne doit pas se declencher parce qu'une donnee manque.
 */
export function evaluerConditions(conditions, contexte) {
  if (!conditions) return { ok: true, details: [] };
  const liste = Array.isArray(conditions) ? conditions : [conditions];
  const details = liste.map((c) => {
    const op = OPERATEURS[c.operateur ?? 'eq'];
    if (!op) return { champ: c.champ, ok: false, motif: `operateur inconnu "${c.operateur}"` };
    const valeur = lire(contexte, c.champ);
    if (valeur === undefined) return { champ: c.champ, ok: false, motif: 'champ absent du contexte' };
    return { champ: c.champ, valeur, ok: Boolean(op(valeur, c.valeur)), motif: null };
  });
  return { ok: details.every((d) => d.ok), details };
}

// ---------------------------------------------------------------------------
// Moteur
// ---------------------------------------------------------------------------

/**
 * Moteur de workflows. Les actions sont INJECTEES : le moteur ne sait pas
 * lancer un swarm, il sait decider qu'il faut en lancer un. Cela le rend
 * testable sans LLM, sans reseau et sans base.
 */
export class WorkflowEngine {
  constructor({ actions = {}, onAudit = null } = {}) {
    this.actions = actions;
    this.onAudit = onAudit;
    this._wf = [];
  }

  register(wf) {
    const v = validateWorkflow(wf);
    if (!v.ok) throw new Error(`register: workflow invalide — ${v.erreurs.join(' ; ')}`);
    this._wf.push(wf);
    return this;
  }
  registerYAML(yaml) { return this.register(loadWorkflow(yaml)); }
  list() { return [...this._wf]; }

  /** Workflows dont le declencheur correspond a l'evenement. */
  correspondants(evenement) {
    return this._wf.filter((w) => w.declencheur.type === evenement.type && (w.actif ?? true));
  }

  /**
   * Traite un evenement : selectionne, evalue, execute.
   * @returns {Promise<{declenches:object[], ignores:object[]}>}
   */
  async traiter(evenement, contexte = {}) {
    const declenches = []; const ignores = [];
    const ctx = { ...contexte, evenement, ...evenement.donnees };

    for (const wf of this.correspondants(evenement)) {
      const cond = evaluerConditions(wf.conditions, ctx);
      if (!cond.ok) {
        ignores.push({ workflow: wf.nom, motif: 'conditions non remplies', details: cond.details });
        continue;
      }
      const resultats = [];
      for (const action of wf.actions) {
        // EF-251 : double barriere. La validation refuse deja les actions
        // interdites, mais un workflow enregistre par programme contournerait
        // le chargement YAML. Le controle est refait a l'execution.
        const permis = canAct({ id: wf.nom, kind: 'workflow' }, action.type === 'gate.open' ? 'notify' : action.type.replace('-', '.'));
        if (ACTIONS_INTERDITES_WORKFLOW.includes(action.type)) {
          resultats.push({ action: action.type, ok: false, motif: 'action interdite a un workflow (EF-251)' });
          continue;
        }
        const impl = this.actions[action.type];
        if (!impl) { resultats.push({ action: action.type, ok: false, motif: `action non branchee "${action.type}"` }); continue; }
        try {
          const r = await impl({ ...action, _contexte: ctx, _workflow: wf.nom });
          resultats.push({ action: action.type, ok: true, resultat: r, permis: permis.autorise });
        } catch (e) {
          // L'echec d'une action n'annule pas les suivantes : un workflow qui
          // notifie ET ouvre un gate ne doit pas taire l'alerte parce que le
          // webhook est tombe.
          resultats.push({ action: action.type, ok: false, motif: e.message });
        }
      }
      const trace = { workflow: wf.nom, evenement: evenement.type, resultats, ts: new Date().toISOString() };
      declenches.push(trace);
      if (this.onAudit) { try { this.onAudit(trace); } catch { /* l'audit ne casse pas l'execution */ } }
    }
    return { declenches, ignores };
  }
}

/** Exemple documente, utilise comme reference dans les tests. */
export const WORKFLOW_EXEMPLE = `
nom: Red Team sur idee a fort impact
actif: true
declencheur:
  type: score.threshold
  seuil: 8
conditions:
  - champ: noeud.type
    operateur: eq
    valeur: idee
  - champ: score.impact
    operateur: gte
    valeur: 8
actions:
  - type: red-team
    cible: "{{noeud.id}}"
  - type: notify
    canal: webhook
    message: "Idee a fort impact detectee — Red Team lancee"
  - type: gate.open
    motif: "Arbitrage requis apres Red Team"
`;
