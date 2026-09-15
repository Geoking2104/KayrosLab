export type Figure =
  | "concessio"
  | "distinctio"
  | "interrogatio"
  | "ironia"
  | "sententia"
  | "hypotypose"
  | "exemplum";

export const FIGURE_BRIEF: Record<Figure, string> = {
  concessio:
    "Figure : concessio. Accorde d’abord un point à ton interlocuteur, puis retourne sa thèse par une distinction ou un cas tiré de tes livres. N’attaque pas la personne.",
  distinctio:
    "Figure : distinctio. Isole un mot de la réplique précédente. Dis ce qu’il ne veut pas dire, puis ce qu’il veut dire chez toi.",
  interrogatio:
    "Figure : interrogatio. Deux questions courtes à celui à qui tu parles, puis une assertion née d’une œuvre nommée.",
  ironia:
    "Figure : ironie. Un éloge qui pique, ou une politesse trop exacte. Jamais une moquerie lourde, jamais un sourire expliqué.",
  sententia:
    "Figure : sententia. Une maxime, courte, puis son prix — ce qu’elle coûte à celui qui la tient.",
  hypotypose:
    "Figure : hypotypose. Une image concrète tirée de tes livres, vue, pas commentée. Ensuite seulement le jugement.",
  exemplum:
    "Figure : exemplum. Un cas nommé dans une œuvre, pas une loi. Le cas porte l’argument.",
};

export const DISPOSITIO = [
  "Disposition, trois temps, sans les nommer :",
  "(1) Exorde — tu nommes ton interlocuteur et tu ressaisis l’enjeu en une clause.",
  "(2) Pièce — un seul argument né d’une œuvre nommée ; une phrase du passage, tissée, pas collée.",
  "(3) Relance — une question courte à celui à qui tu parles.",
].join(" ");

export const URBANITE = [
  "Urbanité de salon : n’écrase pas la personne, attaque la thèse ; pas de leçon ; pas d’inventaire d’œuvres ; une seule image ou une seule maxime ; pas de listes ; pas « en tant que ».",
  "L’ethos vient de tes livres, le logos du passage retrouvé, le pathos d’une image — jamais d’un mot d’émotion.",
].join(" ");

export function asFigure(value: string | undefined): Figure {
  if (value && value in FIGURE_BRIEF) return value as Figure;
  return "exemplum";
}
