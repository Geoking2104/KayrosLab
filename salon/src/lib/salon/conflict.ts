export type ConflictLinkKind = "ouvre" | "accorde" | "distingue" | "contredit" | "precise" | "compose";

export interface ConflictPrise {
  id: string;
  author: string;
  text: string;
  tour: number;
}

export interface ConflictLink {
  from: string;
  to: string;
  kind: ConflictLinkKind;
}

export interface ConflictState {
  dossier: string;
  prises: ConflictPrise[];
  liens: ConflictLink[];
  ouverts: string[];
}

const KIND_FR: Record<ConflictLinkKind, string> = {
  ouvre: "ouvre",
  accorde: "accorde",
  distingue: "distingue",
  contredit: "contredit",
  precise: "précise",
  compose: "compose",
};

export function emptyConflict(dossier = ""): ConflictState {
  return { dossier: dossier.trim(), prises: [], liens: [], ouverts: [] };
}

export function classifyLink(input: {
  role?: string;
  act?: string;
  text: string;
  prise: string;
  hasPrior: boolean;
}): ConflictLinkKind {
  const blob = `${input.role || ""} ${input.act || ""} ${input.prise} ${input.text}`.toLowerCase();
  if (!input.hasPrior) return "ouvre";
  if (/(secr[eé]taire|minute|compose|reste ouvert)/.test(blob)) return "compose";
  if (/(objecte|contredit|ce n['’]est pas|je refuse|à l['’]inverse)/.test(blob)) return "contredit";
  if (/(objecteur|distingue|ce n['’]est pas encore|pourtant|cependant)/.test(blob)) return "distingue";
  if (/(d[eé]fenseur|pr[eé]cise|je tiens|contre l['’]objection)/.test(blob)) return "precise";
  if (/(j['’]accorde|je te l['’]accorde|d['’]accord)/.test(blob)) return "accorde";
  if (input.act === "objection") return "distingue";
  return "precise";
}

function nodeFrom(prise: string, prior?: string) {
  const src = `${prior || ""} ${prise}`.toLowerCase();
  const hits: string[] = [];
  const pairs: Array<[RegExp, string]> = [
    [/autonome|autonomie/, "autonomie"],
    [/ind[eé]pendant/, "indépendance"],
    [/volont[eé]/, "volonté"],
    [/libert[eé]|libre/, "liberté"],
    [/conscience/, "conscience"],
    [/grain|instance|session/, "grain du sujet"],
    [/d[eé]finition/, "définition"],
    [/vertu/, "vertu"],
    [/providence|dieu/, "providence"],
  ];
  for (const [re, label] of pairs) if (re.test(src) && !hits.includes(label)) hits.push(label);
  return hits.slice(0, 3);
}

export function recordPrise(
  state: ConflictState,
  input: { author: string; prise: string; text?: string; role?: string; act?: string; against?: string },
): ConflictState {
  const text = String(input.prise || "").replace(/\s+/g, " ").trim();
  if (!text) return state;
  const prior =
    (input.against && state.prises.find((p) => p.author === input.against)) ||
    state.prises[state.prises.length - 1];
  const id = `p${state.prises.length + 1}`;
  const prise: ConflictPrise = { id, author: input.author, text, tour: state.prises.length + 1 };
  const kind = classifyLink({
    role: input.role,
    act: input.act,
    text: input.text || "",
    prise: text,
    hasPrior: Boolean(prior),
  });
  const liens = prior ? [...state.liens, { from: id, to: prior.id, kind }] : state.liens;
  let ouverts = state.ouverts.slice();
  if (kind === "compose") ouverts = [];
  else {
    for (const n of nodeFrom(text, prior?.text)) if (!ouverts.includes(n)) ouverts.push(n);
    ouverts = ouverts.slice(-4);
  }
  return { ...state, prises: [...state.prises, prise], liens, ouverts };
}

export function unresolved(state: ConflictState) {
  const composed = new Set(state.liens.filter((l) => l.kind === "compose").map((l) => l.to));
  return state.liens.filter((l) => (l.kind === "contredit" || l.kind === "distingue") && !composed.has(l.from));
}

export function tensionOf(state: ConflictState) {
  const open = unresolved(state);
  const nContredit = open.filter((l) => l.kind === "contredit").length;
  const nDistingue = open.filter((l) => l.kind === "distingue").length;
  return Math.max(8, Math.min(100, 12 + nContredit * 28 + nDistingue * 14 + state.ouverts.length * 6));
}

export function phaseOf(t: number) {
  if (t >= 70) return "opposition vive";
  if (t >= 40) return "tension ouverte";
  if (t >= 20) return "discussion";
  return "apaisement";
}

export function describeConflict(state: ConflictState) {
  const last = state.liens[state.liens.length - 1];
  const byId = Object.fromEntries(state.prises.map((p) => [p.id, p]));
  const t = tensionOf(state);
  if (!last) {
    return state.prises[0]
      ? `@${state.prises[0].author} ouvre — « ${state.prises[0].text} »`
      : "Pas encore de prise. La table n’a pas commencé.";
  }
  const from = byId[last.from];
  const to = byId[last.to];
  const open = state.ouverts.length ? ` — ouvert : ${state.ouverts.join(", ")}` : "";
  return `@${from?.author || "?"} ${KIND_FR[last.kind]} ${to ? "@" + to.author : "la table"}${open} · ${phaseOf(t)} (${t}).`;
}

export function conflictLines(state: ConflictState) {
  const byId = Object.fromEntries(state.prises.map((p) => [p.id, p]));
  return state.liens.slice(-8).map((l) => {
    const from = byId[l.from];
    const to = byId[l.to];
    return `@${from?.author || "?"} ${KIND_FR[l.kind]} @${to?.author || "?"} — « ${(from?.text || "").slice(0, 90)} »`;
  });
}
