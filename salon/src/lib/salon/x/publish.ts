import { getSalonToken, SALON_API } from "../sso";
import { canApiReply } from "./oauth";
import type { BrouillonX, GabaritX, PostSource, PropositionX, XBinding } from "./types";

export function intentComposeUrl(text: string, inReplyTo?: string) {
  const base = "https://x.com/intent/tweet";
  const params = new URLSearchParams({ text });
  if (inReplyTo && /^\d{5,19}$/.test(inReplyTo)) params.set("in_reply_to", inReplyTo);
  return `${base}?${params.toString()}`;
}

export function textOf(prop: PropositionX, gabarit: GabaritX, override?: string) {
  if (override?.trim()) return override.trim();
  return gabarit === "long" ? prop.long : prop.court;
}

export function hashText(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function openIntent(text: string, post: PostSource) {
  const replyId = /^\d{5,19}$/.test(post.id) ? post.id : undefined;
  const url = intentComposeUrl(text, replyId);
  window.open(url, "_blank", "noopener,noreferrer");
  return url;
}

export async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

const lastWriteAt = new Map<string, number>();
const MIN_WRITE_MS = 45_000;
const sent = new Set<string>();

export async function publishViaApi(input: {
  binding: XBinding | null;
  post: PostSource;
  text: string;
  proposition: PropositionX;
}): Promise<{ tweetId: string }> {
  if (!canApiReply(input.binding, input.post.mentionedHandles)) {
    throw new Error("API reply refusée : le compte de l’hôte n’est pas convoqué sur ce post.");
  }
  if (!getSalonToken()) throw new Error("SSO Salon requis.");
  const key = `${input.post.id}:${input.proposition.authorId}:${input.proposition.stance}:${hashText(input.text)}`;
  if (sent.has(key)) throw new Error("déjà publié (idempotence).");
  const account = input.binding?.handle ?? "host";
  const prev = lastWriteAt.get(account) ?? 0;
  if (Date.now() - prev < MIN_WRITE_MS) {
    throw new Error("délai minimal de 45 s entre deux publications.");
  }

  const res = await fetch(`${SALON_API}/v1/salon/x/tweets`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${getSalonToken()}`,
    },
    body: JSON.stringify({
      text: input.text,
      in_reply_to_tweet_id: input.post.id,
      made_with_ai: true,
      propositionId: input.proposition.id,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !body.id) throw new Error(body.error || `X ${res.status}`);
  sent.add(key);
  lastWriteAt.set(account, Date.now());
  return { tweetId: body.id };
}

export function draftFrom(prop: PropositionX, gabarit: GabaritX, text: string, status: BrouillonX["status"], tweetId?: string): BrouillonX {
  return {
    id: `bx_${prop.id}`,
    propositionId: prop.id,
    textFinal: text,
    gabarit,
    edited: text !== (gabarit === "long" ? prop.long : prop.court),
    status,
    tweetId,
    publishedAt: status === "published" ? new Date().toISOString() : undefined,
    hash: hashText(text),
  };
}
