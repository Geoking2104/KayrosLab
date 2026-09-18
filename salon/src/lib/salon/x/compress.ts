const URL_RE = /https?:\/\/[^\s]+/gi;

export function weightedLength(text: string): number {
  if (!text) return 0;
  const urls = text.match(URL_RE) ?? [];
  const without = text.replace(URL_RE, "");
  let n = urls.length * 23;
  for (const ch of without) {
    const code = ch.codePointAt(0) ?? 0;
    n += code > 0x7ff ? 2 : 1;
  }
  return n;
}

export function fitsCourt(text: string, limit = 270) {
  return weightedLength(text) <= limit;
}

export function cutToWeighted(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (weightedLength(clean) <= limit) return clean;
  const sentences = clean.split(/(?<=[.!?\u2026])\s+/);
  let acc = "";
  for (const sentence of sentences) {
    const next = acc ? `${acc} ${sentence}` : sentence;
    if (weightedLength(next) <= limit) {
      acc = next;
      continue;
    }
    break;
  }
  if (acc) return acc.trim();
  let slice = "";
  for (const ch of clean) {
    const next = slice + ch;
    if (weightedLength(next + "\u2026") > limit) break;
    slice = next;
  }
  return `${slice.trim()}\u2026`;
}

export function signatureOf(authorName: string, locale: "fr" | "en") {
  return locale === "en" ? `\u2014 after ${authorName} \u00b7 Salon` : `\u2014 d\u2019apr\u00e8s ${authorName} \u00b7 Salon`;
}

export function workTag(work?: string) {
  if (!work) return "";
  const short = work.replace(/^[\u00ab]\s*|\s*[\u00bb]$/g, "").trim();
  if (!short) return "";
  return `(${cutToWeighted(short, 40)})`;
}

export function compressCourt(input: {
  prise: string;
  authorName: string;
  locale: "fr" | "en";
  work?: string;
  limit?: number;
}): string {
  const limit = input.limit ?? 270;
  const sign = signatureOf(input.authorName, input.locale);
  const tag = workTag(input.work);
  const reserve = weightedLength(` ${tag} ${sign}`.trim()) + 1;
  const bodyLimit = Math.max(80, limit - reserve);
  const body = cutToWeighted(input.prise.replace(/^PRISE\s*:\s*/i, ""), bodyLimit);
  return [body, tag, sign].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function compressLong(input: {
  prise: string;
  replique: string;
  authorName: string;
  locale: "fr" | "en";
  work?: string;
  limit?: number;
}): string {
  const limit = input.limit ?? 1800;
  const sign = signatureOf(input.authorName, input.locale);
  const sentences = input.replique
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?\u2026])\s+/)
    .filter(Boolean)
    .slice(0, 5);
  const parts = [input.prise.trim(), ...sentences, input.work ? `\u2014 ${input.work}` : "", sign].filter(Boolean);
  return cutToWeighted(parts.join(" "), limit);
}
