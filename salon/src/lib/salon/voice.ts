import type { FloorMove, Passage } from "./types";

function label(id: string, names: Record<string, string>) {
  if (id === "user" || id === "table") return id === "table" ? "la table" : "l’hôte";
  return names[id] ?? id;
}

export function speakFromMemory(input: {
  move: FloorMove;
  passage: Passage | undefined;
  names: Record<string, string>;
}) {
  const work = input.passage?.work ?? "un livre";
  const snip = (input.passage?.text ?? "…").replace(/\s+/g, " ").slice(0, 240);
  const to = label(input.move.to, input.names);

  if (input.move.method === "elenchus") {
    return `${to}, je ne sais pas encore ce que tu mets sous ces mots. Dans « ${work} » on lit : ${snip} La question demeure : est-ce encore cela, si l’on tient ta thèse jusqu’au bout ?`;
  }
  switch (input.move.figure) {
    case "concessio":
      return `${to}, je te l’accorde en partie. Pourtant, dans « ${work} » : ${snip}`;
    case "ironia":
      return `On loue cela d’un air fort civil. Dans « ${work} » : ${snip}`;
    case "interrogatio":
      return `${to}, que mets-tu sous ces mots ? « ${work} » dit : ${snip} Est-ce encore ta thèse ?`;
    case "distinctio":
      return `Ce mot ne veut pas dire ce que l’on croit. Dans « ${work} » : ${snip}`;
    case "sententia":
      return `Une maxime, et son prix. Dans « ${work} » : ${snip}`;
    case "hypotypose":
      return `Vois plutôt ceci, dans « ${work} » : ${snip}`;
    default:
      return `Dans « ${work} » : ${snip}`;
  }
}
