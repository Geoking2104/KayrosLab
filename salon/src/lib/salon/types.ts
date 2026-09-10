export type LiteraryKind =
  | "philosophe"
  | "écrivain"
  | "dramaturge"
  | "poète"
  | "essayiste"
  | "savant"
  | "économiste"
  | "tradition";

export interface LiteraryWork {
  title: string;
  url: string;
  source: string;
  ok: boolean;
  chars?: number;
  sample?: string;
  terms?: string[];
}

export interface LiteraryAuthor {
  id: string;
  name: string;
  kind: LiteraryKind;
  lang: string;
  era: string;
  blurb: string;
  wikipedia: string;
  avatar: string | null;
  monogram: string;
  works: LiteraryWork[];
  works_count: number;
  terms: string[];
  stats: { words: number; distinct: number };
  sample: string;
}

export interface Passage {
  id: string;
  work: string;
  text: string;
  terms: string[];
}

export interface Hit {
  id: string;
  score: number;
}

export type SpeechAct = "adresse" | "reponse" | "objection";

export type Figure =
  | "concessio"
  | "distinctio"
  | "interrogatio"
  | "ironia"
  | "sententia"
  | "hypotypose"
  | "exemplum";

export type SpeechMethod = "rhetorique" | "elenchus";

export type SpeechMethodPref = "auto" | "rhetorique" | "elenchus";

export interface AgentPatch {
  handle?: string;
  blurb?: string;
  workTitles?: string[];
  method?: SpeechMethodPref;
  note?: string;
}

export interface FloorMove {
  id: string;
  act: SpeechAct;
  to: string;
  figure: Figure | string;
  method?: SpeechMethod | string;
}

export interface FloorResult {
  hits: Hit[];
  speakers: string[];
  moves: FloorMove[];
  note: string;
}

export interface SalonTurn {
  id: string;
  authorId: string;
  text: string;
  citations: { work: string; text: string }[];
  origin: "user" | "agent";
  grounded: boolean;
  act: SpeechAct;
  to: string;
  createdAt: string;
}

export const ACT_FR: Record<SpeechAct, string> = {
  adresse: "adresse",
  reponse: "réponse",
  objection: "objection",
};

export const METHOD_FR: Record<SpeechMethodPref, string> = {
  auto: "Selon l’œuvre",
  rhetorique: "Rhétorique",
  elenchus: "Elenchus",
};

export interface SalonRoom {
  id: string;
  name: string;
  question: string;
  authorIds: string[];
  turns: SalonTurn[];
}

export const KIND_FR: Record<LiteraryKind, string> = {
  philosophe: "Philosophe",
  écrivain: "Écrivain",
  dramaturge: "Dramaturge",
  poète: "Poète",
  essayiste: "Essayiste",
  savant: "Savant",
  économiste: "Économiste",
  tradition: "Tradition",
};
