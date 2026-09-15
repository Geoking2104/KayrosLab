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

export function chunkPassages(title: string, text: string, prefix: string): Passage[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const slices: Passage[] = [];
  for (let i = 0; i < clean.length && slices.length < 10; i += 720) {
    const piece = clean.slice(i, i + 900).trim();
    if (piece.length < 120) continue;
    slices.push({
      id: `${prefix}_${slices.length}`,
      work: title,
      text: piece,
      terms: termsOf(piece),
    });
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
