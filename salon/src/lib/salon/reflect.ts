import type { FloorMove, Passage } from "./types";

export function sentencesOf(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const parts = clean.split(/(?<=[.!?…])\s+(?=["«“„]?[A-ZÀ-ÖØ-Þ])/u);
  return parts
    .map((s) => s.replace(/^["«“„]\s*/, "").replace(/\s*["»”]\s*$/, "").trim())
    .filter((s) => s.length >= 24);
}

export function firstSentences(text: string, max = 2): string {
  return sentencesOf(text).slice(0, max).join(" ");
}

export function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}][\p{L}'’-]+/gu) ?? [])
    .map((w) => w.replace(/['’-]/g, ""))
    .filter((w) => w.length >= 4);
}

const STOP = new Set([
  "dans", "cette", "avec", "pour", "plus", "tout", "tous", "leur", "leurs",
  "comme", "mais", "donc", "alors", "ainsi", "sans", "sous", "entre",
  "après", "avant", "encore", "aussi", "bien", "très", "fait", "faire",
  "être", "avoir", "cela", "ceux", "celles", "nous", "vous", "elle", "elles",
  "that", "this", "with", "from", "have", "been", "were", "which",
  "their", "there", "about", "would", "could", "should",
]);

export function fullWords(text: string): string[] {
  return contentWords(text).filter((w) => !STOP.has(w));
}

export function relevance(query: string, text: string): number {
  const q = new Set(fullWords(query));
  if (!q.size) return 0;
  const words = fullWords(text);
  if (!words.length) return 0;
  let hit = 0;
  for (const w of words) if (q.has(w)) hit += 1;
  return hit / Math.sqrt(q.size * Math.max(words.length, 8));
}

export function pickGrounding(query: string, passages: { work: string; text: string }[]) {
  const ranked = passages
    .map((p) => ({ ...p, score: relevance(query, `${p.work} ${p.text}`) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) return { work: "", sentence: "", weak: true, score: 0 };
  const sentence = firstSentences(best.text, 1);
  return { work: best.work, sentence, weak: best.score < 0.08 || !sentence, score: best.score };
}

export function parseSpeech(raw: string): { prise: string; text: string } {
  const src = raw.replace(/\r\n/g, "\n").trim();
  const priseMatch = src.match(/^\s*PRISE\s*:\s*(.+?)(?:\n|$)/i);
  const bodyMatch = src.match(/REPLIQUE\s*:\s*([\s\S]+)/i);
  let prise = (priseMatch?.[1] ?? "").replace(/^["«]+|["»]+$/g, "").trim();
  let text = (bodyMatch?.[1] ?? "").trim();
  if (!text) {
    text = src.replace(/^\s*PRISE\s*:.*$/im, "").replace(/^\s*REPLIQUE\s*:\s*/im, "").trim();
  }
  text = closeSentences(text);
  if (!prise) prise = firstSentences(text, 1).slice(0, 220);
  if (prise.length > 240) prise = `${prise.slice(0, 237).trim()}…`;
  return { prise, text };
}

export function closeSentences(text: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  t = t.replace(/^[^A-ZÀ-ÖØ-Þ«"“]+/, (lead) => {
    const cut = lead.search(/[A-ZÀ-ÖØ-Þ«"“]/);
    return cut >= 0 ? lead.slice(cut) : lead;
  });
  if (t && !/[.!?...»"]$/.test(t)) {
    const last = t.lastIndexOf(".");
    if (last > 40) t = t.slice(0, last + 1);
    else t = `${t}.`;
  }
  return t.trim();
}

function label(id: string, names: Record<string, string>) {
  if (id === "user" || id === "table") return id === "table" ? "la table" : "l’hôte";
  return names[id] ?? id;
}

export function composeFromMemory(input: {
  move: FloorMove;
  passage: Passage | undefined;
  names: Record<string, string>;
  question?: string;
  toName?: string;
}): { text: string; prise: string } {
  const to = input.toName || label(input.move.to, input.names);
  const work = input.passage?.work ?? "";
  const sentence = input.passage ? firstSentences(input.passage.text, 1) : "";
  const q = input.question ?? "";
  const grounded = Boolean(work && sentence);
  const weak = grounded && q ? relevance(q, `${work} ${sentence}`) < 0.08 : !grounded;

  let prise = "";
  let text = "";

  if (input.move.method === "elenchus") {
    prise = "Je ne tiens pas encore la définition que tu mets sous ces mots.";
    text = grounded && !weak
      ? `${to}, je reprends ce que tu viens de dire, et je ne sais pas encore si tu peux le signer jusqu’au bout. Dans « ${work} », on lit : ${sentence} Est-ce encore cela, si l’on tient ta thèse jusqu’au bout ?`
      : `${to}, je reprends ce que tu viens de dire, et je ne sais pas encore ce que tu mets sous ces mots. Qu’entends-tu précisément, si l’on refuse les termes trop vastes ?`;
  } else if (input.move.act === "objection") {
    prise = "J’accorde un point, puis je distingue.";
    text = grounded && !weak
      ? `${to}, je te l’accorde en partie. Pourtant la question demeure, et « ${work} » la déplace : ${sentence} Ce n’est pas ta personne que je presse, c’est ce que cette phrase ne peut plus soutenir.`
      : `${to}, je te l’accorde en partie. Mais la thèse, tenue jusqu’au bout, change de nom. Mes livres, ici, ne donnent pas la citation juste — je distingue seulement : ce que tu soutiens n’est pas encore ce qu’il faut conclure.`;
  } else {
    prise = q
      ? `Sur cette question, je réponds depuis mes livres, non depuis une politesse.`
      : "Je réponds depuis mes livres.";
    text = grounded && !weak
      ? `${to}, voici ce que je peux signer. Dans « ${work} » : ${sentence} Cela répond à ce que tu viens de poser, et cela suffit pour aujourd’hui : la suite est à qui voudra objecter.`
      : `${to}, je ne parle ici que depuis mes livres, et le passage le plus proche ne tranche pas ta question. Je m’en tiens donc à ce que je peux signer sans citer à faux : la question reste ouverte, et je la rends à la table.`;
  }

  return { text: closeSentences(text), prise: closeSentences(prise) };
}

export function formatHistoryLine(name: string, text: string, prise?: string) {
  return prise ? `${name} [prise : ${prise}] : ${text}` : `${name}: ${text}`;
}

export function enrichQuery(parts: Array<string | undefined | null>) {
  return parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
