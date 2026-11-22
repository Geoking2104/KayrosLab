import type { LiteraryAuthor } from "./types";
import { relevance, sentencesOf } from "./reflect";

/** Normalisation de comparaison (espaces, guillemets, tirets, casse). */
export function canonical(text: string): string {
  return String(text || "")
    .replace(/\u00A0/g, " ")
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')
    .replace(/[\u2013\u2014\u2010\u2011]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Phrase du passage qui répond le mieux à la requête (jamais une tranche). */
export function bestSentenceFor(query: string, text: string): string {
  const list = sentencesOf(text);
  if (!list.length) return "";
  if (query) {
    let best = list[0];
    let bestScore = -1;
    for (const s of list) {
      const score = relevance(query, s);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (bestScore > 0) return best;
  }
  return list.slice().sort((a, b) => b.length - a.length)[0];
}

/** Une citation n'est recevable que si elle est une sous-chaîne exacte d'une source. */
export function verifyQuote(quote: string, sources: string[]): { ok: boolean; source?: string } {
  const needle = canonical(quote);
  if (needle.length < 20) return { ok: false };
  for (const src of sources) {
    if (canonical(src).includes(needle)) return { ok: true, source: src };
  }
  return { ok: false };
}

export function deathYear(author: LiteraryAuthor): number | null {
  const era = String(author.era || author.eraEn || "");
  const years = [...era.matchAll(/\b(1[0-9]{3}|20[0-9]{2})\b/g)].map((m) => Number(m[1]));
  return years.length ? Math.max(...years) : null;
}

export function wordCount(text: string): number {
  return (String(text || "").match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;
}

function workTitles(author: LiteraryAuthor): string[] {
  return (author.works || []).map((w) => canonical(w.title)).filter(Boolean);
}

function knownWork(quote: string, author: LiteraryAuthor): boolean {
  const q = canonical(quote);
  if (!q) return false;
  return workTitles(author).some((t) => t === q || t.includes(q) || q.includes(t.split(":")[0]));
}

export interface TurnCheckInput {
  text: string;
  prise: string;
  author: LiteraryAuthor;
  toName?: string;
  sources: string[];
  /** Passages fournis au modèle (œuvre + texte) — base de vérification. */
  passages: { work: string; text: string }[];
}

export interface TurnCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  citations: { work: string; text: string; verified: boolean }[];
}

/**
 * Contrôle mécanique du contrat de parole (SALON-AGENT-AUTEUR.md §3) :
 * phrases closes, longueur, destinataire nommé, œuvre du registre,
 * citations sous-chaîne vérifiée, pas d'anachronisme, pas de liste.
 */
export function checkTurn(input: TurnCheckInput): TurnCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const citations: { work: string; text: string; verified: boolean }[] = [];
  const text = String(input.text || "").trim();
  const words = wordCount(text);

  if (!text) errors.push("réplique vide");
  if (words < 60) errors.push(`réplique trop courte (${words} mots < 60)`);
  if (words > 220) errors.push(`réplique trop longue (${words} mots > 220)`);
  if (!/^[A-ZÀ-ÖØ-Þ«"“„0-9(\[]/.test(text)) errors.push("la réplique commence au milieu d'une phrase");
  if (!/[.!?…»"]$/.test(text)) errors.push("la réplique ne se termine pas par une phrase close");
  if (/(^|\n)\s*([-*•]|\d+[.)])\s+/.test(text)) errors.push("liste interdite dans la réplique");
  if (!/\b(je|j['’]|me|moi|nous)\b/i.test(text) && !/\b(I|me|my|we)\b/.test(text)) {
    errors.push("première personne absente");
  }

  const toName = String(input.toName || "").trim();
  if (toName && !/^(l['’]hôte|la table|hôte|table)$/i.test(toName)) {
    const token = toName.split(/[\s'’-]+/).filter((x) => x.length >= 3)[0];
    if (token && !canonical(text).includes(canonical(token))) {
      errors.push(`destinataire « ${toName} » non nommé`);
    }
  }

  const sources = [...input.sources, ...input.passages.map((p) => p.text)];
  const quoted = [...text.matchAll(/[«"“]([^«»"“”]{20,400})[»"”]/g)].map((m) => m[1].trim());
  for (const q of quoted) {
    if (knownWork(q, input.author)) continue; // c'est un titre d'œuvre, pas une citation
    const v = verifyQuote(q, sources);
    citations.push({ work: "", text: q, verified: v.ok });
    if (!v.ok) errors.push(`citation non vérifiée : « ${q.slice(0, 60)}… »`);
  }

  const death = deathYear(input.author);
  if (death) {
    for (const m of text.matchAll(/\b(1[5-9][0-9]{2}|20[0-9]{2})\b/g)) {
      const year = Number(m[1]);
      if (year > death + 2) errors.push(`anachronisme : ${year} après la mort de l'auteur (${death})`);
    }
  }

  // Œuvre nommée hors registre : « Dans « X »… » avec X inconnu et long.
  for (const m of text.matchAll(/(?:dans|d['’]après|chez|in)\s+[«"“]([^»"”]{3,120})[»"”]/gi)) {
    const title = m[1].trim();
    if (title.length >= 20 && !knownWork(title, input.author)) {
      errors.push(`œuvre hors registre : « ${title} »`);
    }
  }

  if (!citations.length) warnings.push("aucune citation vérifiable dans ce tour (aveu ou argument)");
  return { ok: errors.length === 0, errors, warnings, citations };
}
