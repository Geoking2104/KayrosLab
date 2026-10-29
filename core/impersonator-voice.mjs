// KayrosLab — voix d'un impersonator : provenance/confiance du profil, consignes de
// voix injectées dans le contexte, et aperçu déterministe « ainsi je parlerais ».
// Règle : une estimation (style d'écriture) n'est jamais présentée comme CrystalKnows.
import { normalizeHumanProfile } from './personality.mjs';
import { canonicalDisc, descriptifFromDisc } from './personality-descriptif.mjs';

export const ESTIMATE_CONFIDENCE_CAP = 0.6;
const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

/**
 * Provenance du DISC : `crystalknows` (fiche CrystalKnows : page publique, export ou API),
 * `estimate` (heuristique de style, confiance plafonnée), `disc_template` (type saisi),
 * `manual`, ou `none`.
 */
export function profileConfidence(input = {}) {
  const p = normalizeHumanProfile(input || {});
  const d = p.descriptif || {};
  const sources = [...new Set(list(p.profile_sources).map((s) => s.source))];
  const crystalSource = list(p.profile_sources).find((s) => s.source === 'crystalknows');
  let kind = 'none';
  if (d.source === 'enriched' || (d.confidence != null && d.source !== 'crystalknows' && d.source !== 'crystalknows_public')) kind = 'estimate';
  else if (d.source === 'crystalknows' || d.source === 'crystalknows_public' || (crystalSource && p.disc_type)) kind = 'crystalknows';
  else if (d.source === 'disc_template') kind = 'disc_template';
  else if (p.disc_type) kind = 'manual';
  const confidence = kind === 'estimate' ? Math.min(ESTIMATE_CONFIDENCE_CAP, d.confidence ?? ESTIMATE_CONFIDENCE_CAP) : null;
  const mode = crystalSource?.import_mode || null;
  const label = {
    crystalknows: `CrystalKnows${mode === 'public_profile_page' ? ' (page publique)' : mode ? ` (${mode})` : ''}`,
    estimate: `Estimation depuis le style d’écriture (confiance ${Math.round((confidence ?? 0) * 100)} %) — pas une fiche CrystalKnows`,
    disc_template: 'Type DISC saisi (modèle générique)',
    manual: 'Saisie manuelle',
    none: 'Aucun DISC',
  }[kind];
  return { kind, disc_type: p.disc_type || d.disc_type || null, archetype: p.behavioral_archetype || d.archetype || null, confidence, label, sources };
}

function avgWords(directives) {
  const m = directives.join(' ').match(/(\d+)\s*(sentences|phrases|mots|words)/i);
  return m ? Number(m[1]) : null;
}

/** Synthèse de la voix : comment la persona parle, ce qu'elle surveille, comment lui écrire. */
export function personaVoice(input = {}) {
  const p = normalizeHumanProfile(input || {});
  const d = p.descriptif || {};
  const disc = canonicalDisc(p.disc_type || d.disc_type) || null;
  const tpl = disc ? descriptifFromDisc(disc) : null;
  const sec = (id) => list(d.sections?.[id]).length ? d.sections[id] : list(tpl?.sections?.[id]);
  const style = p.communication_style || {};
  const directives = list(style.communication_directives);
  const primary = disc ? disc[0].toUpperCase() : null;
  const register = { D: 'direct, bref, orienté résultat', I: 'chaleureux, enthousiaste, imagé', S: 'posé, rassurant, attentif aux personnes', C: 'précis, factuel, structuré' }[primary] || 'neutre';
  return {
    disc, archetype: p.behavioral_archetype || d.archetype || null, register,
    tone: style.tone || null,
    max_sentences: avgWords(directives) || (primary === 'D' ? 3 : primary === 'C' ? 6 : 4),
    speaks: [...directives, ...sec('emails')].slice(0, 6),
    priorities: [...list(p.core_motivators), ...sec('motivation')].slice(0, 4),
    objections: [...list(style.objection_patterns), ...sec('negotiating')].slice(0, 4),
    blindspots: sec('blindspots').slice(0, 3),
    drainers: [...list(style.stress_triggers), ...sec('drainers')].slice(0, 3),
    write_to_them: sec('emails').slice(0, 4),
    do: sec('do').slice(0, 3), dont: sec('dont').slice(0, 3),
    confidence: profileConfidence(p),
  };
}

/** Bloc de contexte « voix » pour les tours d'impersonation. */
export function voiceContext(input = {}) {
  const v = personaVoice(input);
  if (!v.disc && !v.speaks.length) return '';
  return [
    'VOIX DE LA PERSONA (à incarner à chaque tour) :',
    `- Registre : ${v.register}${v.tone ? ` ; ton ${v.tone}` : ''} ; ${v.max_sentences} phrases maximum par intervention.`,
    v.disc ? `- DISC ${v.disc}${v.archetype ? ` (${v.archetype})` : ''} — provenance : ${v.confidence.label}.` : null,
    v.speaks.length ? `- Façon d’écrire : ${v.speaks.join(' ; ')}` : null,
    v.priorities.length ? `- Ce qui compte pour elle : ${v.priorities.join(' ; ')}` : null,
    v.objections.length ? `- Objections typiques : ${v.objections.join(' ; ')}` : null,
    v.blindspots.length ? `- Angles morts (à laisser transparaître, sans les nommer) : ${v.blindspots.join(' ; ')}` : null,
    v.drainers.length ? `- Agacements : ${v.drainers.join(' ; ')}` : null,
    v.write_to_them.length ? `- Pour la convaincre, lui écrire ainsi : ${v.write_to_them.join(' ; ')}` : null,
    '- Rédiger `simulated_stakeholder_feedback` à la première personne, dans cette voix, préfixé « Simulation — ».',
  ].filter(Boolean).join('\n');
}

const OPENERS = {
  D: (idea) => [`Simulation — Sur « ${idea} » : quel gain, et pour quand ?`, 'Donnez-moi une recommandation, pas des options.', 'Si le chiffre tient, on y va.'],
  I: (idea) => [`Simulation — « ${idea} », j’adore l’énergie !`, 'Qui d’autre embarque-t-on avec nous ?', 'Montrez-moi un exemple concret et on en parle à l’équipe.'],
  S: (idea) => [`Simulation — « ${idea} » m’intéresse, mais allons-y pas à pas.`, 'Comment l’équipe vivra-t-elle ce changement ?', 'J’ai besoin d’un plan de transition rassurant avant de m’engager.'],
  C: (idea) => [`Simulation — Concernant « ${idea} », sur quelles données vous appuyez-vous ?`, 'Je veux voir les hypothèses, les risques et la méthode de mesure.', 'Envoyez-moi le détail par écrit, je reviendrai vers vous.'],
};

/**
 * Aperçu déterministe « ainsi je parlerais » (sans LLM) : réaction courte à une idée,
 * dans le registre DISC et selon les consignes d'écriture du profil.
 */
export function speakAs(input = {}, idea = '') {
  const v = personaVoice(input);
  const subject = String(idea || 'cette proposition').trim().replace(/\s+/g, ' ').slice(0, 140);
  const primary = v.disc ? v.disc[0].toUpperCase() : 'C';
  const lines = [...OPENERS[primary](subject)];
  if (v.objections[0]) lines.push(`Ma condition : ${v.objections[0].charAt(0).toLowerCase()}${v.objections[0].slice(1).replace(/\.$/, '')}.`);
  const sentences = lines.slice(0, Math.max(2, Math.min(v.max_sentences, lines.length)));
  return {
    message: sentences.join(' '),
    voice: v,
    confidence: v.confidence,
    notice: v.confidence.kind === 'estimate'
      ? 'Aperçu fondé sur une estimation du style, pas sur une fiche CrystalKnows.'
      : 'Aperçu déterministe : en mission, le modèle reformule dans cette voix.',
  };
}
