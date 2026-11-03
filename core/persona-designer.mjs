// KayrosLab — Création conversationnelle de persona (P4).
//
// Un tour de conversation propose un BROUILLON de persona ; il ne crée jamais rien. Le modèle est
// appelé exclusivement via KayrosLLM.complete (donc via le harness global : bloc système injecté,
// conformité notée, relance/blocage en mode enforce). Le brouillon est validé à blanc par
// normalizeImpersonator (mêmes règles que POST /v1/console/impersonators : consentement par défaut,
// source public ⇒ public_sources, SSRF). L'enregistrement n'a lieu qu'après la carte d'approbation
// humaine, côté console, par POST /v1/console/impersonators — seul chemin d'écriture.

import { normalizeImpersonator, impersonatorGuardrails, IMPERSONATOR_PURPOSES } from './impersonator.mjs';

export const DESIGNER_ROLE = 'persona_designer';
const MAX_TURNS = 20;

export const DESIGNER_SYSTEM = [
  'Tu aides un opérateur à décrire une persona SIMULÉE (épreuve d\'idée), jamais à parler au nom d\'une personne réelle.',
  'Pose au plus une question à la fois. Ne propose que des faits présents dans la conversation ou dans les URLs publiques citées ; n\'invente aucun fait privé.',
  'Réponds UNIQUEMENT par un objet JSON : {"reply": "<message à l\'opérateur>", "draft": {"name": "...", "role": "...", "company": "...", "source": "public|manual", "public_sources": ["https://..."], "clues": ["..."], "purpose": "idea_test|objection_rehearsal|pitch_review"}}.',
  'La source "public" exige au moins une URL publique http(s). Le brouillon sera soumis à une approbation humaine avant tout enregistrement.',
].join('\n');

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
function str(v) { return String(v ?? '').trim(); }

/** Extrait le premier objet JSON d'un texte de modèle (tolère ```json, texte autour). */
export function parseDesignerOutput(text) {
  const raw = String(text ?? '');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  for (const candidate of [fenced, raw]) {
    if (!candidate) continue;
    const start = candidate.indexOf('{'); const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try { const v = JSON.parse(candidate.slice(start, end + 1)); if (v && typeof v === 'object') return v; } catch { /* suivant */ }
  }
  return null;
}

/** Brouillon déterministe (sans modèle ou modèle simulé) : URLs et nom repérés dans la conversation. */
export function heuristicDraft(messages = [], previous = {}) {
  const userText = messages.filter((m) => m.role === 'user').map((m) => str(m.content)).join('\n');
  const urls = [...new Set(userText.match(URL_RE) || [])];
  const name = previous.name || userText.match(/(?:[Pp]ersona|[Ss]imule[rz]?|[Nn]om)\s*[:\-]?\s*([A-ZÀ-Ý][\p{L}'-]+(?:\s+[A-ZÀ-Ý][\p{L}'-]+){0,3})/u)?.[1] || '';
  const role = previous.role || userText.match(/\b(CFO|CEO|CTO|CIO|CISO|COO|DAF|DSI|RSSI|DG|directeur[^\n,.]*|directrice[^\n,.]*|acheteu[rs]e?[^\n,.]*)/i)?.[1] || '';
  return { ...previous, name, role, source: urls.length ? 'public' : (previous.source || 'manual'), public_sources: urls.length ? urls : (previous.public_sources || []) };
}

/** Normalise un brouillon brut et le valide à blanc (aucune écriture). */
export function validateDraft(input = {}) {
  const draft = {
    name: str(input.name || input.persona_name).slice(0, 200),
    role: str(input.role || input.persona_role).slice(0, 200) || undefined,
    company: str(input.company || input.persona_company).slice(0, 200) || undefined,
    source: ['public', 'manual'].includes(str(input.source).toLowerCase()) ? str(input.source).toLowerCase() : 'manual',
    public_sources: Array.isArray(input.public_sources) ? [...new Set(input.public_sources.map(str).filter(Boolean))].slice(0, 30) : [],
    clues: Array.isArray(input.clues) ? input.clues.map(str).filter(Boolean).map((c) => c.slice(0, 500)).slice(0, 30) : [],
    purpose: IMPERSONATOR_PURPOSES.includes(str(input.purpose)) ? str(input.purpose) : 'idea_test',
  };
  if (!draft.public_sources.length && draft.source === 'public') draft.source = 'manual';
  try {
    const i = normalizeImpersonator({ persona_name: draft.name, persona_role: draft.role, persona_company: draft.company, source: draft.source, public_sources: draft.public_sources, clues: draft.clues, purpose: draft.purpose });
    return { draft, valid: true, issues: [], guardrails: impersonatorGuardrails(i) };
  } catch (error) {
    return { draft, valid: false, issues: [String(error.message)], guardrails: [] };
  }
}

/**
 * Un tour du concepteur. `llm` doit exposer `complete` (KayrosLLM). Renvoie
 * { reply, draft, valid, issues, guardrails, requires_approval: true, source }.
 */
export async function designPersonaTurn({ llm = null, messages = [], draft: previous = {} } = {}) {
  const history = (Array.isArray(messages) ? messages : []).filter((m) => ['user', 'assistant'].includes(m?.role)).slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, content: str(m.content).slice(0, 4000) }));
  if (!history.some((m) => m.role === 'user')) throw new Error('concepteur : au moins un message utilisateur requis');
  let parsed = null; let source = 'deterministic'; let compliance = null;
  if (llm && typeof llm.complete === 'function') {
    const out = await llm.complete({
      role: DESIGNER_ROLE, temperature: 0.2, maxTokens: 600,
      messages: [{ role: 'system', content: DESIGNER_SYSTEM }, { role: 'system', content: `Brouillon courant : ${JSON.stringify(previous || {})}` }, ...history],
    });
    compliance = out?.compliance || null;
    if (out?.provider !== 'mock') { parsed = parseDesignerOutput(out?.text); source = parsed ? 'model' : 'deterministic'; }
  }
  const merged = parsed?.draft && typeof parsed.draft === 'object' ? { ...previous, ...parsed.draft } : heuristicDraft(history, previous);
  const checked = validateDraft(merged);
  const reply = str(parsed?.reply) || (checked.valid
    ? 'Brouillon prêt : vérifiez la carte d\'approbation avant enregistrement.'
    : `Il manque des éléments : ${checked.issues.join(' ; ')}. Donnez le nom de la persona et, pour une base publique, au moins une URL publique.`);
  return { reply: reply.slice(0, 2000), ...checked, requires_approval: true, source, compliance };
}
