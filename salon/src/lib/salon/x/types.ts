import type { SpeechAct, SpeechMethodPref } from "../types";

export type Stance = "confirmation" | "infirmation";
export type PostOrigin = "api" | "oembed" | "manuel";
export type GabaritX = "court" | "long";
export type DraftStatus = "draft" | "copied" | "intent" | "published" | "failed" | "deleted";
export type Engagement = "off" | "prepare" | "autopost_mentions";

export interface PostSource {
  id: string;
  permalink: string;
  handle: string;
  name: string;
  text: string;
  lang: string;
  createdAt: string;
  conversationId?: string;
  source: PostOrigin;
  mentionedHandles: string[];
  quotedByAuthor?: boolean;
}

export interface TheseSource {
  postId: string;
  text: string;
  edited: boolean;
  model: "extractif" | "hote";
}

export interface PropositionX {
  id: string;
  postId: string;
  circleId: string;
  authorId: string;
  stance: Stance;
  prise: string;
  replique: string;
  court: string;
  long: string;
  work?: string;
  grounded: boolean;
  weakMemory: boolean;
  createdAt: string;
  act: SpeechAct;
  figure: string;
  method: SpeechMethodPref | string;
}

export interface BrouillonX {
  id: string;
  propositionId: string;
  textFinal: string;
  gabarit: GabaritX;
  edited: boolean;
  status: DraftStatus;
  tweetId?: string;
  publishedAt?: string;
  hash: string;
}

export interface XBinding {
  xUserId?: string;
  handle?: string;
  name?: string;
  scopes: string[];
  engagement: Engagement;
  linkedAt?: string;
}

export interface SpeakXInput {
  authorId: string;
  circleId: string;
  post: PostSource;
  these: string;
  stance: Stance;
  method?: SpeechMethodPref;
}
