// Descriptif de personnalité d'un agent personnifié : type DISC, archétype, vue
// d'ensemble, traits comportementaux 0–100 et sections éditables (communication,
// confiance, motivation, passage à l'action, énergie, angles morts, réunions…).
// Prérempli depuis la Data API v4 de Crystal quand un profil réel est importé,
// sinon depuis les modèles DISC ci-dessous (textes originaux KayrosLab, tendances
// génériques du modèle DISC — aucun texte Crystal n'est repris comme modèle).
// Module sans dépendance : importé par core/ et par la console (frontend).

export const DESCRIPTIF_TRAITS = Object.freeze([
  { id: 'risk_aversion', low: 'Prend des risques', high: 'Évite le risque' },
  { id: 'skepticism', low: 'Fait confiance', high: 'Sceptique' },
  { id: 'pragmatism', low: 'Optimiste', high: 'Pragmatique' },
  { id: 'pace', low: 'Posé', high: 'Rapide' },
  { id: 'expressiveness', low: 'Factuel', high: 'Expressif' },
  { id: 'social', low: 'Autonome', high: 'Collaboratif' },
  { id: 'dominance', low: 'Accommodant', high: 'Dominant' },
  { id: 'leniency', low: 'Exigeant', high: 'Indulgent' },
]);

// `crystal` : clés du contenu Crystal v4 (`data.content.<clé>`) qui alimentent la section.
export const DESCRIPTIF_SECTIONS = Object.freeze([
  { id: 'communication', label: 'Comment lui parler', crystal: ['communication'] },
  { id: 'building_trust', label: 'Gagner sa confiance', crystal: ['building_trust'] },
  { id: 'motivation', label: 'Ses moteurs', crystal: ['motivation'] },
  { id: 'driving_action', label: 'Déclencher la décision', crystal: ['driving_action', 'drive_action'] },
  { id: 'energizers', label: 'Ce qui lui donne de l’énergie', crystal: ['behavior'] },
  { id: 'drainers', label: 'Ce qui l’épuise', crystal: ['drainer'] },
  { id: 'strengths', label: 'Points forts', crystal: ['strengths'] },
  { id: 'blindspots', label: 'Angles morts', crystal: ['blindspots'] },
  { id: 'working_together', label: 'Travailler ensemble', crystal: ['working_together'] },
  { id: 'meetings', label: 'En réunion', crystal: ['meeting'] },
  { id: 'emails', label: 'Par écrit (e-mails, notes)', crystal: [] },
  { id: 'following_up', label: 'Relancer', crystal: ['following_up'] },
  { id: 'negotiating', label: 'Négocier', crystal: ['negotiating'] },
  { id: 'proposal', label: 'Présenter une proposition', crystal: ['first_impressions', 'selling', 'product_demo', 'pricing'] },
  { id: 'do', label: 'À faire', crystal: [] },
  { id: 'dont', label: 'À éviter', crystal: [] },
]);
const SECTION_IDS = DESCRIPTIF_SECTIONS.map((section) => section.id);
const MAX_ITEMS = 12;

// Roue DISC : 16 positions dans le sens horaire, D en haut à gauche.
export const DISC_WHEEL = Object.freeze(['D', 'Di', 'DI', 'Id', 'I', 'Is', 'IS', 'Si', 'S', 'Sc', 'SC', 'Cs', 'C', 'Cd', 'CD', 'Dc']);
const STYLE_NAMES = { D: 'Décideur', I: 'Fédérateur', S: 'Soutien', C: 'Analyste' };

const TEMPLATES = {
  D: {
    overview: 'Va droit au résultat : tranche vite, assume les décisions difficiles et attend des interlocuteurs qu’ils viennent avec une recommandation plutôt qu’avec une liste de questions.',
    qualities: ['Résolu', 'Direct', 'Compétitif'],
    sections: {
      communication: ['Commencer par la conclusion, détailler ensuite si on le demande', 'Formuler des affirmations nettes, sans précautions oratoires', 'Proposer deux ou trois options chiffrées plutôt qu’une analyse ouverte'],
      building_trust: ['Montrer que l’on tient ses engagements, délais compris', 'Défendre son point de vue quand il est contesté', 'Reconnaître une erreur rapidement et proposer la correction'],
      motivation: ['Obtenir des résultats visibles et mesurables', 'Garder la main sur les arbitrages', 'Relever des défis que d’autres jugent difficiles'],
      driving_action: ['Fixer une échéance courte et explicite', 'Montrer le coût de l’inaction', 'Laisser la décision finale entre ses mains'],
      energizers: ['Les situations à fort enjeu', 'Les marges de manœuvre larges', 'Les gains rapides'],
      drainers: ['Les réunions sans décision', 'Les validations en cascade', 'Les détails sans lien avec l’objectif'],
      strengths: ['Tranche sous incertitude', 'Porte les sujets jusqu’au bout', 'Assume la responsabilité du résultat'],
      blindspots: ['Peut décider avant d’avoir écouté toutes les parties', 'Sous-estime l’effet de son ton sur l’équipe', 'Néglige parfois les risques de mise en œuvre'],
      working_together: ['Lui confier des objectifs, pas des procédures', 'Signaler tôt les blocages, avec une solution', 'Respecter son temps : ordre du jour serré'],
      meetings: ['Annoncer d’emblée la décision attendue', 'Limiter la réunion à l’essentiel', 'Conclure par les responsables et les dates'],
      emails: ['Objet explicite et demande dans la première phrase', 'Trois puces maximum', 'Une seule question fermée par message'],
      following_up: ['Relancer brièvement en rappelant l’enjeu', 'Proposer une date de décision', 'Éviter les relances sans élément nouveau'],
      negotiating: ['Afficher clairement sa position et ses limites', 'Échanger des concessions contre des engagements', 'Lui laisser le sentiment de mener la négociation'],
      proposal: ['Ouvrir sur l’impact attendu', 'Chiffrer le gain et le délai', 'Montrer ce qui distingue la proposition des alternatives'],
      do: ['Être concis et préparé', 'Assumer une recommandation', 'Parler résultats'],
      dont: ['Tourner autour du sujet', 'Multiplier les réserves', 'Lui imposer une décision sans lui laisser la main'],
    },
  },
  I: {
    overview: 'Avance à l’enthousiasme et à la relation : décide volontiers sur une vision partagée, entraîne les autres et se lasse vite des démonstrations trop arides.',
    qualities: ['Enthousiaste', 'Sociable', 'Persuasif'],
    sections: {
      communication: ['Raconter l’histoire derrière les chiffres', 'Garder un ton chaleureux et énergique', 'Laisser de la place à l’échange plutôt qu’au monologue'],
      building_trust: ['S’intéresser à ses idées et les reprendre', 'Partager ses propres convictions', 'Valoriser publiquement ses contributions'],
      motivation: ['La reconnaissance et la visibilité', 'Les projets nouveaux et inspirants', 'L’adhésion de son entourage'],
      driving_action: ['Montrer qui d’autre soutient déjà le projet', 'Projeter le succès et ce qu’il rendra possible', 'Proposer un premier pas simple et immédiat'],
      energizers: ['Les échanges en groupe', 'Les idées neuves', 'Les occasions de convaincre'],
      drainers: ['Le travail solitaire et répétitif', 'Les procédures lourdes', 'Les ambiances froides ou conflictuelles'],
      strengths: ['Crée de l’adhésion autour d’un projet', 'Débloque les relations entre équipes', 'Rebondit vite après un échec'],
      blindspots: ['Peut s’engager sans avoir vérifié les détails', 'Surestime parfois le soutien réel', 'Évite les sujets qui fâchent'],
      working_together: ['Lui donner un rôle visible', 'Formaliser par écrit ce qui a été décidé à l’oral', 'Prévoir des points courts et fréquents'],
      meetings: ['Prévoir un temps d’échange informel', 'Utiliser des visuels et des exemples', 'Récapituler les engagements à la fin'],
      emails: ['Ton cordial, phrases courtes', 'Un exemple concret plutôt qu’un tableau', 'Une action claire à la fin'],
      following_up: ['Relancer de façon personnelle, pas automatique', 'Rappeler l’enthousiasme exprimé', 'Proposer un échange plutôt qu’un document'],
      negotiating: ['Insister sur le bénéfice commun', 'Préserver la relation même en cas de désaccord', 'Fixer par écrit les points obtenus'],
      proposal: ['Ouvrir sur la vision et l’histoire', 'Citer des références connues', 'Garder les détails techniques en annexe'],
      do: ['Être chaleureux', 'Partager la vision', 'Reconnaître ses idées'],
      dont: ['Noyer le message dans les détails', 'Être froid ou distant', 'Le critiquer devant le groupe'],
    },
  },
  S: {
    overview: 'Privilégie la stabilité et l’harmonie : prend le temps de mesurer l’effet d’une décision sur les personnes et préfère les changements préparés aux ruptures.',
    qualities: ['Fiable', 'Patient', 'Coopératif'],
    sections: {
      communication: ['Adopter un ton calme et bienveillant', 'Expliquer le pourquoi et les étapes', 'Laisser le temps de réfléchir avant de demander un avis'],
      building_trust: ['Être constant dans ses comportements', 'Tenir les petites promesses', 'Montrer de l’attention aux personnes concernées'],
      motivation: ['La sécurité et la prévisibilité', 'Un collectif soudé', 'Le sentiment d’être utile'],
      driving_action: ['Présenter un plan de transition progressif', 'Montrer que l’équipe est accompagnée', 'Réduire les risques perçus avec des garanties'],
      energizers: ['Un cadre clair et stable', 'L’entraide', 'Les relations de long terme'],
      drainers: ['Les changements brusques', 'Les conflits ouverts', 'L’urgence permanente'],
      strengths: ['Assure la continuité et la qualité de service', 'Apaise les tensions', 'Écoute réellement'],
      blindspots: ['Peut retarder une décision nécessaire', 'Dit oui pour éviter le conflit', 'Sous-exprime ses désaccords'],
      working_together: ['Annoncer les changements à l’avance', 'Demander explicitement son avis', 'Préciser les rôles de chacun'],
      meetings: ['Envoyer l’ordre du jour en amont', 'Solliciter son avis directement mais avec tact', 'Laisser du temps pour les questions'],
      emails: ['Ton courtois et posé', 'Contexte et étapes suivantes explicites', 'Pas d’urgence artificielle'],
      following_up: ['Relancer avec patience et régularité', 'Proposer de l’aide pour avancer', 'Rappeler les garanties prévues'],
      negotiating: ['Avancer pas à pas', 'Rassurer sur les engagements de long terme', 'Éviter les ultimatums'],
      proposal: ['Montrer l’effet sur les équipes', 'Détailler l’accompagnement', 'Présenter les références stables et durables'],
      do: ['Rassurer', 'Être patient', 'Expliquer le plan de transition'],
      dont: ['Brusquer', 'Créer une urgence artificielle', 'Ignorer l’impact humain'],
    },
  },
  C: {
    overview: 'Décide sur des faits vérifiés : examine les hypothèses, cherche les failles et ne s’engage qu’une fois la démonstration solide et documentée.',
    qualities: ['Rigoureux', 'Réservé', 'Méthodique'],
    sections: {
      communication: ['Appuyer chaque affirmation sur une donnée ou une source', 'Exposer la méthode avant la conclusion', 'Rester précis et sobre, sans superlatifs'],
      building_trust: ['Annoncer les limites et les incertitudes', 'Fournir les détails demandés sans délai', 'Corriger rapidement une erreur factuelle'],
      motivation: ['La qualité et l’exactitude', 'Des règles claires et respectées', 'Comprendre en profondeur avant d’agir'],
      driving_action: ['Fournir une analyse complète des risques', 'Laisser le temps d’étudier les documents', 'Répondre à toutes les objections par écrit'],
      energizers: ['Les problèmes complexes à résoudre', 'Le travail approfondi sans interruption', 'Les données fiables'],
      drainers: ['L’improvisation', 'Les affirmations non étayées', 'Les changements de cap sans justification'],
      strengths: ['Repère les incohérences', 'Sécurise la conformité et la qualité', 'Documente ses décisions'],
      blindspots: ['Peut retarder la décision en cherchant plus d’informations', 'Paraît distant ou trop critique', 'Sous-estime les arguments relationnels'],
      working_together: ['Partager les documents à l’avance', 'Définir les critères de qualité', 'Respecter les processus convenus'],
      meetings: ['Ordre du jour précis et pièces jointes', 'Prévoir du temps pour les questions techniques', 'Formaliser les décisions par écrit'],
      emails: ['Structure claire avec titres', 'Chiffres, sources et hypothèses explicites', 'Pièces justificatives jointes'],
      following_up: ['Apporter un élément nouveau à chaque relance', 'Proposer de répondre aux questions en suspens', 'Respecter le délai d’analyse demandé'],
      negotiating: ['Justifier chaque condition', 'Comparer les options sur des critères objectifs', 'Éviter la pression émotionnelle'],
      proposal: ['Présenter la méthode et les preuves', 'Détailler les coûts et les risques', 'Prévoir une annexe technique complète'],
      do: ['Être précis', 'Documenter', 'Laisser le temps de l’analyse'],
      dont: ['Exagérer', 'Presser la décision', 'Rester vague sur les chiffres'],
    },
  },
};
const TRAIT_DEFAULTS = {
  D: { risk_aversion: 25, skepticism: 60, pragmatism: 60, pace: 80, expressiveness: 55, social: 35, dominance: 85, leniency: 30 },
  I: { risk_aversion: 25, skepticism: 25, pragmatism: 25, pace: 80, expressiveness: 85, social: 75, dominance: 55, leniency: 65 },
  S: { risk_aversion: 70, skepticism: 35, pragmatism: 45, pace: 25, expressiveness: 35, social: 80, dominance: 25, leniency: 75 },
  C: { risk_aversion: 80, skepticism: 80, pragmatism: 85, pace: 30, expressiveness: 15, social: 35, dominance: 45, leniency: 35 },
};

function strings(value, max = MAX_ITEMS) {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(list.map((item) => String(item ?? '').trim()).filter(Boolean))].slice(0, max);
}
function score(value) { if (value == null || value === '') return null; const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null; }

/** « dc », « DI », « Sc » → forme canonique de la roue (ou null). */
export function canonicalDisc(value) {
  const raw = String(value || '').trim();
  if (!/^[disc]{1,2}$/i.test(raw)) return null;
  const exact = DISC_WHEEL.find((item) => item === raw);
  if (exact) return exact;
  const [a, b] = raw.toUpperCase();
  if (!b || a === b) return a;
  const upper = `${a}${b}`;
  if (DISC_WHEEL.includes(upper) && raw[1] === raw[1].toUpperCase()) return upper;
  const mixed = `${a}${b.toLowerCase()}`;
  return DISC_WHEEL.includes(mixed) ? mixed : DISC_WHEEL.includes(upper) ? upper : a;
}

/** Nom d'archétype KayrosLab pour un type DISC (« Analyste », « Décideur–Analyste »…). */
export function discArchetype(type) {
  const t = canonicalDisc(type);
  if (!t) return '';
  return t.length === 1 ? STYLE_NAMES[t] : `${STYLE_NAMES[t[0]]}–${STYLE_NAMES[t[1].toUpperCase()]}`;
}

/** Position sur la roue DISC (angle en degrés, sens horaire depuis le haut). */
export function discWheelAngle(type) {
  const index = DISC_WHEEL.indexOf(canonicalDisc(type));
  return index < 0 ? null : (315 + index * 22.5) % 360;
}

function weights(type) {
  const t = canonicalDisc(type);
  if (!t) return null;
  if (t.length === 1) return [[t, 1]];
  const secondary = t[1].toUpperCase();
  return t[1] === secondary ? [[t[0], 0.55], [secondary, 0.45]] : [[t[0], 0.7], [secondary, 0.3]];
}

/** Traits par défaut d'un type DISC (moyenne pondérée des styles qui le composent). */
export function discTraitDefaults(type) {
  const w = weights(type);
  if (!w) return {};
  return Object.fromEntries(DESCRIPTIF_TRAITS.map(({ id }) => [id, Math.round(w.reduce((sum, [style, k]) => sum + TRAIT_DEFAULTS[style][id] * k, 0))]));
}

/** Descriptif prérempli depuis les modèles DISC (style principal + nuances du style secondaire). */
export function descriptifFromDisc(type, { traits = null } = {}) {
  const t = canonicalDisc(type);
  if (!t) return null;
  const primary = TEMPLATES[t[0]];
  const secondary = t.length === 2 ? TEMPLATES[t[1].toUpperCase()] : null;
  const sections = Object.fromEntries(SECTION_IDS.map((id) => [id, strings([
    ...(primary.sections[id] || []),
    ...(secondary ? (secondary.sections[id] || []).slice(0, t[1] === t[1].toUpperCase() ? 2 : 1) : []),
  ], 5)]));
  return normalizeDescriptif({
    disc_type: t, archetype: discArchetype(t), disc_intensity: null,
    overview: secondary ? `${primary.overview} Nuance ${STYLE_NAMES[t[1].toUpperCase()].toLowerCase()} : ${secondary.overview.charAt(0).toLowerCase()}${secondary.overview.slice(1)}` : primary.overview,
    qualities: strings([...primary.qualities.slice(0, 2), ...(secondary ? secondary.qualities.slice(0, 1) : primary.qualities.slice(2))], 3),
    traits: { ...discTraitDefaults(t), ...(traits || {}) },
    sections, source: 'disc_template',
  });
}

function phrases(value) {
  if (value == null) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(phrases);
  if (typeof value === 'object') return [...phrases(value.phrase), ...phrases(value.phrases), ...phrases(value.dos), ...phrases(value.do)];
  return [];
}
function traitKey(key) { return String(key || '').trim().toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_+|_+$/g, ''); }

/**
 * Descriptif depuis une réponse Crystal v4 (`GET /v4/profile`) : sections reprises
 * du profil de la personne ; les sections absentes sont complétées par le modèle DISC.
 */
export function descriptifFromCrystal(response = {}) {
  const data = response?.data || response?.profile || response || {};
  const p = data.personalities || {};
  const content = data.content || response?.content || {};
  const type = canonicalDisc(p.disc_type || data.disc_type) || p.disc_type || data.disc_type || null;
  const rawTraits = p.behavioral_traits || data.behavioral_traits || {};
  const traits = Object.fromEntries(Object.entries(rawTraits).map(([key, value]) => [traitKey(key), score(value)]).filter(([key, value]) => value != null && DESCRIPTIF_TRAITS.some((t) => t.id === key)));
  const template = descriptifFromDisc(type);
  const recommendations = content.recommendations || {};
  const sections = {};
  for (const section of DESCRIPTIF_SECTIONS) {
    let items = section.crystal.flatMap((key) => phrases(content[key]));
    if (section.id === 'do') items = phrases(recommendations.do ?? recommendations.dos);
    if (section.id === 'dont') items = [...phrases(recommendations.dont), ...phrases(recommendations.donts)];
    sections[section.id] = strings(items.length ? items : template?.sections?.[section.id] || [], 8);
  }
  const overview = strings([...phrases(content.profile), p.overview].filter(Boolean), 2).join(' ');
  return normalizeDescriptif({
    disc_type: type, archetype: p.archetype || data.archetype || template?.archetype || '',
    disc_intensity: p.disc_intensity ?? data.disc_intensity,
    overview: overview || template?.overview || '',
    qualities: strings(data.qualities || content.qualities || template?.qualities || [], 6),
    traits: { ...(template?.traits || {}), ...traits }, sections, source: 'crystalknows',
  });
}

/** Normalise un descriptif saisi ou importé (bornes, sections connues, listes dédoublonnées). */
export function normalizeDescriptif(input) {
  if (!input || typeof input !== 'object') return null;
  const traits = Object.fromEntries(DESCRIPTIF_TRAITS.map(({ id }) => [id, score(input.traits?.[id])]).filter(([, v]) => v != null));
  const sections = Object.fromEntries(SECTION_IDS.map((id) => [id, strings(input.sections?.[id]).map((item) => item.slice(0, 500))]).filter(([, items]) => items.length));
  const out = {
    disc_type: canonicalDisc(input.disc_type) || (String(input.disc_type || '').trim().slice(0, 8) || null),
    archetype: String(input.archetype || '').trim().slice(0, 120) || null,
    disc_intensity: score(input.disc_intensity),
    overview: String(input.overview || '').trim().slice(0, 4000) || null,
    qualities: strings(input.qualities, 6).map((item) => item.slice(0, 80)),
    traits, sections,
    source: ['crystalknows', 'disc_template', 'manual', 'anonymised'].includes(input.source) ? input.source : 'manual',
  };
  const empty = !out.disc_type && !out.overview && !Object.keys(traits).length && !Object.keys(sections).length;
  return empty ? null : Object.fromEntries(Object.entries(out).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length)));
}

function level(value) { return value >= 67 ? 'fort' : value <= 33 ? 'faible' : 'moyen'; }

/** Texte injecté dans le contexte d'exécution de l'agent. */
export function descriptifContext(input) {
  const d = normalizeDescriptif(input);
  if (!d) return '';
  const out = ['Descriptif de personnalité (à incarner dans le ton, les priorités et les objections) :'];
  const head = [d.disc_type && `type DISC ${d.disc_type}`, d.archetype && `archétype « ${d.archetype} »`, d.disc_intensity != null && `intensité ${d.disc_intensity}/100`].filter(Boolean);
  if (head.length) out.push(`- Profil : ${head.join(', ')}`);
  if (d.qualities?.length) out.push(`- Qualités : ${d.qualities.join(', ')}`);
  if (d.overview) out.push(`- Vue d'ensemble : ${d.overview}`);
  const traits = DESCRIPTIF_TRAITS.filter(({ id }) => d.traits?.[id] != null)
    .map(({ id, low, high }) => `${low} ↔ ${high} : ${d.traits[id]}/100 (${high.toLowerCase()} ${level(d.traits[id])})`);
  if (traits.length) out.push(`- Traits (0 = ${'gauche'}, 100 = ${'droite'}) :\n${traits.map((t) => `  - ${t}`).join('\n')}`);
  for (const section of DESCRIPTIF_SECTIONS) {
    const items = d.sections?.[section.id];
    if (items?.length) out.push(`- ${section.label} : ${items.join(' ; ')}`);
  }
  return out.join('\n');
}
