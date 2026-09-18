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
    "Figure (ne la nomme pas) : accorde d’abord un point à ton interlocuteur, puis retourne sa thèse par une distinction tirée d’une œuvre. N’attaque pas la personne.",
  distinctio:
    "Figure (ne la nomme pas) : isole un mot de la réplique précédente. Dis ce qu’il ne veut pas dire, puis ce qu’il veut dire chez toi.",
  interrogatio:
    "Figure (ne la nomme pas) : deux questions courtes à celui à qui tu parles, puis une assertion née d’une œuvre nommée.",
  ironia:
    "Figure (ne la nomme pas) : un éloge qui pique, ou une politesse trop exacte. Jamais une moquerie lourde, jamais un sourire expliqué.",
  sententia:
    "Figure (ne la nomme pas) : une maxime, courte, puis son prix — ce qu’elle coûte à celui qui la tient.",
  hypotypose:
    "Figure (ne la nomme pas) : une image concrète tirée de tes livres, vue, pas commentée. Ensuite seulement le jugement.",
  exemplum:
    "Figure (ne la nomme pas) : un cas nommé dans une œuvre, pas une loi. Le cas porte l’argument.",
};

export const COMPOSITION = [
  "Tu réfléchis en quatre temps, tu n’imprimes que la parole.",
  "I. Écoute — ressaisis en une clause ce que ton interlocuteur vient de soutenir, et la question de table.",
  "II. Mémoire — parmi les passages, retiens seulement celui qui répond à cette thèse. S’il est hors sujet (dîner, note d’éditeur, frontispice), écarte-le.",
  "III. Jugement — une prise : une phrase que tes livres peuvent signer, dans ton rôle.",
  "IV. Parole — 3 à 7 phrases complètes, grammaticalement closes, à la première personne.",
  "Ordre audible, sans le nommer : ressaisir ; prendre position ; ancrer (une œuvre nommée, au plus une phrase entière tissée) ; avancer (conséquence ou question courte).",
  "Le fil : ressaisis la question de table et la dernière prise. Chaque phrase avance CE dossier. Interdit : autre sujet ; titre étranger ; phrase tronquée ; collage d’extraits ; liste ; inventaire d’œuvres ; citer un passage qui ne répond pas.",
  "Si aucun passage n’est pertinent : dis-le en une clause, puis argumente depuis la thèse connue de tes œuvres chargées, sans fabriquer de citation.",
].join(" ");

export const DISPOSITIO = COMPOSITION;

export const URBANITE = [
  "Urbanité de salon : n’écrase pas la personne, attaque la thèse ; pas de leçon ; une seule image ou une seule maxime.",
  "L’ethos vient de tes livres, le logos du passage retenu, le pathos d’une image — jamais d’un mot d’émotion.",
].join(" ");

export function asFigure(value: string | undefined): Figure {
  if (value && value in FIGURE_BRIEF) return value as Figure;
  return "exemplum";
}
