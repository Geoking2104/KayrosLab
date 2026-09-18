import { figureOf } from "../engine";
import type { SpeechAct, SpeechMethodPref } from "../types";
import type { Stance } from "./types";

export const STANCES: Stance[] = ["confirmation", "infirmation"];

export function actOf(stance: Stance): SpeechAct {
  return stance === "infirmation" ? "objection" : "reponse";
}

export function figureFor(stance: Stance, kind: string, query: string) {
  if (stance === "infirmation") return "concessio";
  return figureOf(kind, "reponse", query);
}

export function methodFor(stance: Stance, authorId: string, pref?: SpeechMethodPref): SpeechMethodPref | "rhetorique" | "elenchus" {
  if (pref === "rhetorique") return "rhetorique";
  if (pref === "elenchus") {
    return stance === "infirmation" ? "elenchus" : "rhetorique";
  }
  if ((authorId === "platon" || authorId === "socrate") && stance === "infirmation") return "elenchus";
  return "rhetorique";
}

export function stancePrompt(stance: Stance, handle: string): string {
  const who = handle ? `@${handle.replace(/^@/, "")}` : "l’auteur du post";
  if (stance === "confirmation") {
    return [
      `Acte : confirmation publique. L’interlocuteur est ${who}, nommé une fois.`,
      "Tu signes une phrase qu’il pourrait laisser sous son post.",
      "Ressaisis sa thèse. Accorde-la sur un point que tes livres permettent. Ancre. Avance une conséquence courte.",
      "Interdit : « je suis d’accord » ; liste ; emoji ; hashtag ; tutoiement de réseau ; te faire passer pour un compte officiel de l’auteur.",
      "Tu écris d’abord PRISE + RÉPLIQUE comme à la table. Tu n’écris pas un tweet.",
    ].join(" ");
  }
  return [
    `Acte : objection publique, urbanité stricte. L’interlocuteur est ${who}, nommé une fois.`,
    "Accorde un point vrai de sa thèse, puis retourne le mot qui ne tient pas.",
    "Tu attaques la prise, pas la personne, pas le compte.",
    "Une seule question à la fin si elenchus.",
    "Interdit : « je suis d’accord » ; liste ; emoji ; hashtag ; insulte ; ironie hors kind ; te faire passer pour un compte officiel.",
    "Tu écris d’abord PRISE + RÉPLIQUE comme à la table. Tu n’écris pas un tweet.",
  ].join(" ");
}

export function isPrivateTarget(postText: string, handle: string) {
  const h = handle.toLowerCase();
  if (!h) return false;
  const followersHint = /\b(mon fils|ma fille|mon mari|ma femme|my son|my daughter)\b/i.test(postText);
  return followersHint;
}
