import type { LiteraryWork, Passage } from "./types";

export function termsOf(text: string) {
  const freq = new Map<string, number>();
  const tokens = text.toLowerCase().match(/[\p{L}][\p{L}'’-]+/gu) ?? [];
  for (const token of tokens) {
    const key = token.replace(/['’-]/g, "");
    if (key.length < 4) continue;
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([t]) => t);
}

const STOP = new Set([
  "dans", "cette", "avec", "pour", "plus", "tout", "tous", "leur", "leurs",
  "comme", "mais", "donc", "alors", "ainsi", "sans", "sous", "entre",
  "après", "avant", "encore", "aussi", "bien", "très", "fait", "faire",
  "être", "avoir", "cela", "ceux", "celles", "nous", "vous", "elle", "elles",
  "that", "this", "with", "from", "have", "been", "were", "which",
  "their", "there", "about", "would", "could", "should", "the", "and",
]);

export function contentWords(text: string) {
  return (text.toLowerCase().match(/[\p{L}][\p{L}'’-]+/gu) ?? [])
    .map((w) => w.replace(/['’-]/g, ""))
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

/** Phrases entières, bornes propres — même logique que salon/scripts/textlib.mjs. */
export function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  return clean
    .split(/(?<=[.!?…])\s+(?=["«“„]?[A-ZÀ-ÖØ-Þ0-9])/u)
    .map((s) => s.replace(/^["«“„\][\s]+/, "").replace(/\s*["»”]\s*$/, "").trim())
    .filter((s) => s.length >= 24 && s.length <= 340 && /[.!?…»"]$/.test(s));
}

/**
 * Mémoire d'une œuvre : PHRASES ENTIÈRES (40–320 caractères), jamais des
 * tranches coupées au milieu d'une phrase. Plafond par œuvre pour borner
 * le poids du corpus côté navigateur.
 */
export function chunkPassages(title: string, text: string, prefix: string, max = 60): Passage[] {
  const slices: Passage[] = [];
  const seen = new Set<string>();
  for (const raw of splitSentences(text)) {
    const s = raw.replace(/\s+/g, " ").trim();
    if (s.length < 40 || s.length > 320) continue;
    if (!/^[A-ZÀ-ÖØ-Þ«"“„0-9(\[]/.test(s)) continue;
    const key = s.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    slices.push({ id: `${prefix}_${slices.length}`, work: title, text: s, terms: termsOf(s) });
    if (slices.length >= max) break;
  }
  return slices;
}

export function workFromText(title: string, url: string, source: string, text: string): {
  work: LiteraryWork;
  passages: Passage[];
} {
  const passages = chunkPassages(title, text, `${source}_${title}`.slice(0, 24));
  return {
    work: {
      title,
      url,
      source,
      ok: true,
      chars: text.length,
      sample: text.slice(0, 280),
      terms: termsOf(text).slice(0, 12),
    },
    passages,
  };
}
