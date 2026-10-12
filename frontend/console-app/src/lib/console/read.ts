export interface Reading {
  engine: "local-deterministe";
  thin: boolean;
  summary: string;
  facts: string[];
  questions: string[];
  note: string;
}

const AMOUNT = /(?:\d{1,3}(?:[ .]\d{3})+|\d+)(?:[,.]\d+)?\s?(?:€|eur|k€|%|jours|mois)/gi;
const DATE = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g;
const MARKS = ["remise", "pénalité", "penalite", "résiliation", "resiliation", "délai", "delai", "échéance", "echeance", "souverain", "rgpd", "exclusiv", "essai", "avenant", "plafond", "budget"];

export function readableText(raw: string) {
  const text = raw.replace(/\u0000/g, " ").replace(/\r/g, "").trim();
  if (!text) return { ok: false as const, reason: "Fichier vide." };
  if (text.length > 80_000) return { ok: false as const, reason: "Document trop long pour cette lecture locale (80 000 caractères)." };
  const printable = [...text].filter((char) => char === "\n" || char === "\t" || char >= " ").length / text.length;
  if (printable < 0.9) return { ok: false as const, reason: "Ce format n’est pas lisible ici. Déposez un .txt ou un .md, ou collez le texte." };
  return { ok: true as const, text };
}

export function readDocument(name: string, raw: string): Reading {
  const parsed = readableText(raw);
  if (!parsed.ok || parsed.text.length < 40) {
    return {
      engine: "local-deterministe",
      thin: true,
      summary: "",
      facts: [],
      questions: [],
      note: parsed.ok ? "Texte trop court pour proposer une question. Ajoutez l’objet, un chiffre et une échéance." : parsed.reason,
    };
  }
  const text = parsed.text;
  const amounts = unique(text.match(AMOUNT) ?? []).slice(0, 6);
  const dates = unique(text.match(DATE) ?? []).slice(0, 4);
  const facts = [
    ...amounts.map((item) => `Chiffre relevé : ${item.trim()}`),
    ...dates.map((item) => `Date relevée : ${item}`),
  ];
  const lower = text.toLowerCase();
  for (const mark of MARKS) {
    if (!lower.includes(mark)) continue;
    const sentence = sentenceAround(text, mark);
    if (sentence) facts.push(sentence);
  }
  const kept = [...new Set(facts)].slice(0, 8);
  const sentences = text.split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter((item) => item.length > 40).slice(0, 2);
  const summary = (sentences.join(" ") || kept.join(" ")).slice(0, 480);
  return {
    engine: "local-deterministe",
    thin: false,
    summary,
    facts: kept,
    questions: questionsFrom(name, text, amounts, dates),
    note: "Aucun fait n’est ajouté s’il n’est pas dans le texte. L’API distante n’est pas appelée.",
  };
}

function questionsFrom(name: string, text: string, amounts: string[], dates: string[]) {
  const lower = text.toLowerCase();
  const questions: string[] = [];
  const percent = amounts.find((item) => item.includes("%"));
  const money = amounts.find((item) => /€|eur/i.test(item));
  const delay = amounts.find((item) => /jours|mois/i.test(item));
  if (percent && /remise/i.test(lower)) questions.push(`Faut-il accorder la remise de ${percent.trim()} citée dans ${name} ?`);
  else if (percent) questions.push(`Le comité accepte-t-il l’écart de ${percent.trim()} relevé dans ${name} ?`);
  if (money) questions.push(`L’engagement de ${money.trim()} est-il acceptable, et à quelles conditions ?`);
  if (delay || dates[0]) questions.push(`L’échéance ${delay ? delay.trim() : dates[0]} est-elle tenable pour le comité ?`);
  if (/résiliation|resiliation/i.test(lower)) questions.push(`La clause de résiliation de ${name} doit-elle être acceptée en l’état ?`);
  if (questions.length === 0) questions.push(`Le comité valide-t-il ${name} en l’état, et quelles conditions manquent ?`);
  return [...new Set(questions)].slice(0, 4);
}

function sentenceAround(text: string, mark: string) {
  const index = text.toLowerCase().indexOf(mark);
  if (index < 0) return "";
  const start = Math.max(0, text.lastIndexOf(".", index) + 1, text.lastIndexOf("\n", index) + 1);
  const endDot = text.indexOf(".", index);
  const endLine = text.indexOf("\n", index);
  const end = [endDot, endLine].filter((item) => item > index).sort((a, b) => a - b)[0] ?? Math.min(text.length, index + 160);
  return text.slice(start, end + 1).replace(/\s+/g, " ").trim().slice(0, 180);
}

function unique(values: string[]) {
  return [...new Set(values.map((item) => item.replace(/\s+/g, " ").trim()))];
}
