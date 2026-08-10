// KayrosLab — Dossier de capitalisation No-Go (EF-44).
// Archive les apprentissages, les conditions de reactivation et les signaux a
// re-surveiller. Rendu structuré, immuable, journalise par l'API. Les idees
// non_poursuivi sont dormantes et reactivables (voir model.reactivate).

const nowIso = () => new Date().toISOString();

/** Normalise un apprentissage : string -> { contenu, categorie?, ts }. */
function normApprentissage(a, ts) {
  if (typeof a === 'string') return { contenu: a, ts };
  return { contenu: a.contenu ?? '', categorie: a.categorie ?? null, ts: a.ts ?? ts };
}

/** Normalise une condition de reactivation. */
function normCondition(c, ts) {
  if (typeof c === 'string') return { condition: c, ts };
  return { condition: c.condition ?? c.contenu ?? '', signaux: c.signaux ?? [], ts: c.ts ?? ts };
}

/** Normalise un signal a re-surveiller. */
function normSignal(s, ts) {
  if (typeof s === 'string') return { libelle: s, ts };
  return { libelle: s.libelle ?? s.contenu ?? '', categorie: s.categorie ?? null, ts: s.ts ?? ts };
}

/**
 * Construit le dossier de capitalisation No-Go.
 * @param {{apprentissages?:any[], reactivation?:any, signaux?:any[], motif?:string|null}} [entree]
 * @returns {{type:string, motif:string|null, apprentissages:Object[], reactivation:{conditions:Object[], delai:string|null, signaux:string[]}, signaux:Object[], ts:string}}
 */
export function buildCapitalisation({ apprentissages = [], reactivation = null, signaux = [], motif = null } = {}) {
  const ts = nowIso();
  const normReactivation = () => {
    if (reactivation == null) return { conditions: [], delai: null, signaux: [] };
    if (typeof reactivation === 'string') return { conditions: [normCondition(reactivation, ts)], delai: null, signaux: [] };
    const conds = Array.isArray(reactivation.conditions) ? reactivation.conditions.map((c) => normCondition(c, ts))
      : (reactivation.condition ? [normCondition(reactivation.condition, ts)] : []);
    return {
      conditions: conds,
      delai: reactivation.delai ?? null,
      signaux: Array.isArray(reactivation.signaux) ? reactivation.signaux.map((s) => normSignal(s, ts)) : [],
    };
  };
  return {
    type: 'capitalisation',
    motif: motif ?? null,
    apprentissages: apprentissages.map((a) => normApprentissage(a, ts)),
    reactivation: normReactivation(),
    signaux: signaux.map((s) => normSignal(s, ts)),
    ts,
  };
}

/** Ajoute un apprentissage au dossier (immuable). */
export function addApprentissage(dossier, contenu) {
  const d = dossier ?? buildCapitalisation();
  const ts = nowIso();
  const item = typeof contenu === 'string' ? { contenu, ts } : { ...contenu, ts: contenu.ts ?? ts };
  return { ...d, apprentissages: [...d.apprentissages, item], ts };
}

/**
 * Verifie si les conditions de reactivation sont satisfaites face aux signaux constates.
 * @param {Object} dossier
 * @param {{contexteSignaux?:string[]}} [opts]
 * @returns {{prete:boolean, satisfaites:string[], manquantes:string[], raisons:string[]}}
 */
export function reactivationReady(dossier, { contexteSignaux = [] } = {}) {
  const conds = dossier?.reactivation?.conditions ?? [];
  const dossSignaux = (dossier?.reactivation?.signaux ?? []).map((s) => String(s.libelle ?? s));
  const ctx = contexteSignaux.map((s) => String(s));
  const satisfaites = [], manquantes = [];
  for (const c of conds) {
    const signaux = c.signaux?.length ? c.signaux.map((s) => String(s)) : dossSignaux;
    const cibles = signaux.length ? signaux : [c.condition];
    const hit = cibles.some((s) => ctx.some((x) => x.toLowerCase().includes(s.toLowerCase())));
    (hit ? satisfaites : manquantes).push(c.condition);
  }
  const prete = conds.length > 0 && manquantes.length === 0;
  const raisons = prete
    ? ['Conditions de reactivation satisfaites']
    : manquantes.map((m) => `Condition non satisfaite : ${m}`);
  return { prete, satisfaites, manquantes, raisons };
}

/** Synthese lisible du dossier pour affichage / export. */
export function resumeCapitalisation(dossier) {
  const d = dossier ?? buildCapitalisation();
  const nb = d.apprentissages.length;
  const conditions = d.reactivation.conditions.length;
  return {
    type: d.type,
    nbApprentissages: nb,
    nbConditionsReactivation: conditions,
    nbSignaux: d.signaux.length,
    titre: `Capitalisation No-Go (${nb} apprentissage${nb > 1 ? 's' : ''}, ${conditions} condition${conditions > 1 ? 's' : ''} de reactivation)`,
  };
}
