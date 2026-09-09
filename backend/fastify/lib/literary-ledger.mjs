import { promises as fs } from 'node:fs';

/** Politique d'attribution des livres d'un agent (version en ligne).
 * poolSize = nombre d'œuvres trouvées pour l'auteur ; max = plafond ; min = plancher.
 * - pool >= max  → on assigne max livres, le surplus est retenu (règle « cap »).
 * - min <= pool < max → on assigne tout (le plancher de min est satisfait).
 * - pool < min → on assigne tout et on exige un complément manuel de l'utilisateur. */
export function applyBookPolicy(poolSize, { max = 15, min = 3 } = {}) {
  const pool = Number(poolSize) || 0;
  if (pool >= max) return { assign: max, withheld: pool - max, rule: 'cap', manualRequired: false, missing: 0 };
  if (pool >= min) return { assign: pool, withheld: 0, rule: 'floor-ok', manualRequired: false, missing: 0 };
  return { assign: pool, withheld: 0, rule: 'floor-short', manualRequired: true, missing: min - pool };
}

/** Score d'attribution d'un livre vers un agent, à partir de ses caractéristiques.
 * work: { title, author, terms[], era? } — agent: enregistrement complet (metadata.literary). */
export function scoreWorkAgainstAgent(work, agent) {
  const lit = agent?.metadata?.literary;
  if (!lit) return { score: 0, reasons: [] };
  const reasons = [];
  let score = 0;
  const agentName = String(lit.name || agent.display_name || '').toLowerCase();
  const reference = `${work.title || ''} ${work.author || ''}`.toLowerCase();
  const nameWords = agentName.split(/[^a-zà-ÿ]+/).filter((w) => w.length > 3);
  if (nameWords.some((word) => reference.includes(word))) {
    score += 0.4;
    reasons.push(`auteur « ${lit.name} » présent dans la référence du livre`);
  }
  if (work.era && lit.era && String(work.era) === String(lit.era)) {
    score += 0.15;
    reasons.push(`même époque (${lit.era})`);
  }
  const agentTerms = new Set((lit.terms || []).map((term) => String(term).toLowerCase().split(' ')[0]));
  const workTerms = (work.terms || []).map((term) => String(term).toLowerCase().split(' ')[0]);
  const overlaps = workTerms.filter((term) => agentTerms.has(term));
  if (overlaps.length) {
    score += Math.min(0.45, 0.09 * overlaps.length);
    reasons.push(`${overlaps.length} terme(s) signature partagé(s) : ${overlaps.slice(0, 6).join(', ')}`);
  }
  if (!reasons.length) reasons.push('aucune caractéristique commune détectée — attribution au meilleur agent disponible');
  return { score, reasons };
}

/** Choisit l'agent auteur le mieux adapté à un livre ajouté manuellement. */
export function pickBestAgentForWork(work, agents) {
  const candidates = (agents || []).filter((agent) => agent.metadata?.literary && agent.enabled !== false);
  if (!candidates.length) return null;
  let best = null;
  let bestScore = -1;
  for (const agent of candidates) {
    const { score, reasons } = scoreWorkAgainstAgent(work, agent);
    if (score > bestScore) { bestScore = score; best = { agent, score, reasons }; }
  }
  return best;
}

export async function appendLedgerEntry(file, entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  await fs.appendFile(file, `${line}\n`, 'utf8');
}

export async function readLedgerEntries(file, limit = 100) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const entries = lines.map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    return entries.slice(-limit).reverse();
  } catch { return []; }
}
