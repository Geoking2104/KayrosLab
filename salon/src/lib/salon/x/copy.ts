import type { Locale } from "../i18n";
import type { Stance } from "./types";

const fr = {
  nav: "Flux X",
  kicker: "Pupitre",
  title: "Le fil est une autre table.",
  lead: "Un compte — le vôtre. Plusieurs voix. Confirmation ou infirmation, depuis les livres. Rien ne part sur X sans votre geste.",
  needSso: "Le flux X porte le compte de l’hôte. Entrez d’abord au Salon.",
  enter: "Entrer au Salon",
  url: "URL du post",
  urlPh: "https://x.com/compte/status/…",
  paste: "Texte du post (si la carte publique manque)",
  pastePh: "Collez le corps du post.",
  handle: "Compte source @",
  load: "Lire le post",
  these: "Thèse du post",
  theseHelp: "Une phrase. C’est la question de table.",
  theseNeed: "Formulez la thèse — le post est trop court ou n’est qu’un média.",
  authors: "Auteurs (4 au plus)",
  generate: "Faire parler",
  generating: "Les voix s’écrivent…",
  confirm: "Confirme",
  infirm: "Infirme",
  court: "Court",
  long: "Long",
  copy: "Copier",
  copied: "Copié.",
  intent: "Ouvrir X",
  publish: "Publier via API",
  publishOff: "API reply seulement si ce post mentionne votre compte lié.",
  grounded: "ancré",
  fragile: "mémoire fragile",
  edited: "édité",
  chars: "{n} / 270",
  circle: "Cercle",
  linkX: "Lier mon compte X",
  linked: "Compte X · @{handle}",
  unlink: "Délier X",
  writeScope: "Autoriser l’écriture (mentions seulement)",
  engagementOff: "Ne rien préparer tout seul.",
  empty: "Collez une URL. Les auteurs du cercle répondront en deux voix.",
  error: "Le pupitre n’a pas tenu ce tour.",
  source: "Source",
};

const en: Record<keyof typeof fr, string> = {
  nav: "X feed",
  kicker: "Desk",
  title: "The feed is another table.",
  lead: "One account — yours. Several voices. Confirmation or objection, from the books. Nothing reaches X without your hand.",
  needSso: "The X feed carries the host’s account. Enter the Salon first.",
  enter: "Enter the Salon",
  url: "Post URL",
  urlPh: "https://x.com/account/status/…",
  paste: "Post text (if the public card is missing)",
  pastePh: "Paste the body of the post.",
  handle: "Source account @",
  load: "Read the post",
  these: "Claim of the post",
  theseHelp: "One sentence. This is the question of the table.",
  theseNeed: "State the claim — the post is too short, or only media.",
  authors: "Authors (4 at most)",
  generate: "Let them speak",
  generating: "The voices are being written…",
  confirm: "Confirms",
  infirm: "Objects",
  court: "Short",
  long: "Long",
  copy: "Copy",
  copied: "Copied.",
  intent: "Open X",
  publish: "Publish via API",
  publishOff: "API reply only if this post mentions your linked account.",
  grounded: "grounded",
  fragile: "thin memory",
  edited: "edited",
  chars: "{n} / 270",
  circle: "Circle",
  linkX: "Link my X account",
  linked: "X account · @{handle}",
  unlink: "Unlink X",
  writeScope: "Allow writing (mentions only)",
  engagementOff: "Prepare nothing on its own.",
  empty: "Paste a URL. The circle’s authors will answer in two voices.",
  error: "The desk could not hold this turn.",
  source: "Source",
};

export type FluxKey = keyof typeof fr;

export function fluxT(locale: Locale, key: FluxKey, vars?: Record<string, string | number>) {
  let text = (locale === "en" ? en : fr)[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

export function stanceLabel(locale: Locale, stance: Stance) {
  return stance === "confirmation" ? fluxT(locale, "confirm") : fluxT(locale, "infirm");
}
