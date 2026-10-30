// Reformulation guidée d'une saisie manuelle de contexte (RFP / AO, projet interne, skill).
// Passe par KayrosLLM.complete (harnais injecté, mode `flag` : on restitue la demande
// de l'utilisateur, on ne la juge pas). Échec → le brouillon est conservé tel quel.

export const CONTEXT_MODES = {
  rfp: {
    label: 'RFP / AO',
    fields: [
      { key: 'demande_client', label: 'Demande initiale du client' },
      { key: 'contexte_interne', label: 'Contexte interne' },
      { key: 'contexte_client', label: 'Contexte côté client' },
      { key: 'equipe_decision', label: 'Équipe qui décide' },
    ],
  },
  interne: {
    label: 'Projet interne',
    fields: [
      { key: 'perimetre', label: 'Périmètre' },
      { key: 'contexte_societe', label: 'Contexte société' },
      { key: 'contexte_projet', label: 'Contexte projet' },
      { key: 'competences', label: 'Compétences disponibles' },
    ],
  },
  skill: {
    label: 'Objectif de skill',
    fields: [
      { key: 'objectif', label: 'Objectif du skill' },
      { key: 'quand_utiliser', label: 'Quand l’utiliser' },
      { key: 'limites', label: 'Limites' },
    ],
  },
};

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

/** Brouillon déterministe : structure = champs saisis, brief = concaténation lisible. */
export function draftFromInput(type, { raw = '', fields = {} } = {}) {
  const mode = CONTEXT_MODES[type];
  const structured = Object.fromEntries(mode.fields.map((f) => [f.key, clip(fields[f.key], 4000)]));
  if (!Object.values(structured).some(Boolean) && raw) structured[mode.fields[0].key] = clip(raw, 4000);
  const brief = mode.fields.filter((f) => structured[f.key]).map((f) => `${f.label} : ${structured[f.key]}`).join('\n');
  return { structured, brief, missing: mode.fields.filter((f) => !structured[f.key]).map((f) => f.key) };
}

function parseJson(text) {
  const s = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('réponse non JSON');
  return JSON.parse(s.slice(a, b + 1));
}

/**
 * @returns {Promise<{type, source:'model'|'draft', structured, brief, missing, questions, error?}>}
 */
export async function rephraseContext(llm, type, input = {}) {
  if (!CONTEXT_MODES[type]) throw new Error(`type inconnu : ${type}`);
  const draft = draftFromInput(type, input);
  const base = { type, ...draft, questions: [] };
  if (!llm?.complete) return { ...base, source: 'draft', error: 'aucun modèle configuré' };
  const mode = CONTEXT_MODES[type];
  const prompt = [
    `Mode : ${mode.label}. Reformule la saisie ci-dessous pour montrer ta compréhension, sans rien inventer.`,
    `Réponds UNIQUEMENT par un objet JSON : {"structured":{${mode.fields.map((f) => `"${f.key}":string`).join(',')}},"brief":string,"missing":string[],"questions":string[]}.`,
    '- structured : une reformulation claire et factuelle par champ ("" si l’information est absente).',
    '- brief : 3 à 6 phrases en français, commençant par « Ma compréhension : », reprenant enjeux, contraintes et décideurs.',
    '- missing : clés des champs vides ; questions : 0 à 3 questions pour lever les ambiguïtés.',
    'N’ajoute aucun chiffre, date, nom ou engagement absent de la saisie.',
    '',
    'Saisie brute :', clip(input.raw, 12000) || '—',
    'Champs guidés :', ...mode.fields.map((f) => `- ${f.label} : ${clip(input.fields?.[f.key], 4000) || '—'}`),
  ].join('\n');
  try {
    const out = await llm.complete({ role: 'context_rephrase', compliance: 'flag', messages: [{ role: 'user', content: prompt }], temperature: 0.2, maxTokens: 1200 });
    if (!out || out.provider === 'mock') return { ...base, source: 'draft', error: 'modèle simulé : brouillon conservé' };
    const j = parseJson(out.text);
    const structured = Object.fromEntries(mode.fields.map((f) => [f.key, clip(j.structured?.[f.key] ?? draft.structured[f.key], 4000)]));
    const brief = clip(j.brief, 4000);
    if (!brief) throw new Error('brief vide');
    return {
      type, source: 'model', structured, brief,
      missing: Array.isArray(j.missing) ? j.missing.filter((k) => k in structured).slice(0, 10) : draft.missing,
      questions: Array.isArray(j.questions) ? j.questions.map((q) => clip(q, 300)).filter(Boolean).slice(0, 3) : [],
      model_provider: out.provider, compliance: out.compliance ?? null,
    };
  } catch (error) {
    return { ...base, source: 'draft', error: String(error.message || error).slice(0, 200) };
  }
}
