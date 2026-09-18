import type { PostOrigin, PostSource } from "./types";

const STATUS_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com|mobile\.twitter\.com)\/(?:[A-Za-z0-9_]+\/status\/|i\/(?:web\/)?status\/)(\d{5,19})/i;
const STATUS_QUERY_RE = /[?&](?:status|id)=(\d{5,19})/i;
const HANDLE_RE = /(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\//i;
const MENTION_RE = /@([A-Za-z0-9_]{1,15})/g;

export function parsePostId(input: string): string | null {
  const raw = input.trim();
  if (/^\d{5,19}$/.test(raw)) return raw;
  const fromPath = raw.match(STATUS_RE);
  if (fromPath?.[1]) return fromPath[1];
  const fromQuery = raw.match(STATUS_QUERY_RE);
  return fromQuery?.[1] ?? null;
}

export function parseHandleFromUrl(input: string): string {
  const m = input.match(HANDLE_RE);
  const handle = m?.[1];
  if (!handle || handle.toLowerCase() === "i") return "";
  return handle;
}

export function mentionedHandlesOf(text: string): string[] {
  const found = text.match(MENTION_RE) ?? [];
  return [...new Set(found.map((h) => h.slice(1).toLowerCase()))];
}

export function permalinkOf(id: string, handle?: string) {
  const who = handle || "i/web";
  return `https://x.com/${who}/status/${id}`;
}

export function emptyPost(partial: Partial<PostSource> & { id: string }): PostSource {
  return {
    permalink: partial.permalink || permalinkOf(partial.id, partial.handle),
    handle: partial.handle ?? "",
    name: partial.name ?? partial.handle ?? "",
    text: partial.text ?? "",
    lang: partial.lang ?? "und",
    createdAt: partial.createdAt ?? new Date().toISOString(),
    conversationId: partial.conversationId,
    source: partial.source ?? "manuel",
    mentionedHandles: partial.mentionedHandles ?? mentionedHandlesOf(partial.text ?? ""),
    quotedByAuthor: partial.quotedByAuthor,
    id: partial.id,
  };
}

export async function ingestPost(input: {
  urlOrId: string;
  pastedText?: string;
  pastedHandle?: string;
  pastedName?: string;
}): Promise<{ post: PostSource; warning?: string }> {
  const id = parsePostId(input.urlOrId);
  const handleGuess = parseHandleFromUrl(input.urlOrId) || (input.pastedHandle ?? "").replace(/^@/, "");

  if (!id && !input.pastedText?.trim()) {
    throw new Error("ni identifiant X, ni texte collé");
  }

  const localId = id ?? `manuel_${Date.now().toString(36)}`;

  if (id) {
    const oembed = await tryOEmbed(permalinkOf(id, handleGuess || "i/web"));
    if (oembed) {
      return {
        post: emptyPost({
          id,
          handle: handleGuess || oembed.handle,
          name: oembed.name || handleGuess,
          text: oembed.text,
          lang: guessLang(oembed.text),
          source: "oembed",
          permalink: permalinkOf(id, handleGuess || oembed.handle),
        }),
      };
    }
  }

  if (input.pastedText?.trim()) {
    return {
      post: emptyPost({
        id: localId,
        handle: handleGuess,
        name: input.pastedName || handleGuess,
        text: input.pastedText.trim(),
        lang: guessLang(input.pastedText),
        source: "manuel",
        permalink: id ? permalinkOf(id, handleGuess) : "",
      }),
      warning: id ? "oEmbed silencieux — texte collé retenu." : "source manuelle.",
    };
  }

  return {
    post: emptyPost({
      id: localId,
      handle: handleGuess,
      source: "manuel",
      permalink: id ? permalinkOf(id, handleGuess) : "",
    }),
    warning: "Post chargé sans texte. Collez le corps.",
  };
}

interface OEmbedCard {
  handle: string;
  name: string;
  text: string;
}

async function tryOEmbed(url: string): Promise<OEmbedCard | null> {
  const endpoints = [
    `https://publish.x.com/oembed?omit_script=true&url=${encodeURIComponent(url)}`,
    `https://publish.twitter.com/oembed?omit_script=true&url=${encodeURIComponent(url)}`,
  ];
  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint);
      if (!res.ok) continue;
      const body = (await res.json()) as { author_name?: string; author_url?: string; html?: string };
      const text = stripHtml(body.html ?? "");
      if (!text) continue;
      const handle = (body.author_url ?? "").split("/").filter(Boolean).at(-1) ?? "";
      return { handle, name: body.author_name ?? handle, text };
    } catch {
      /* réseau ou CORS : on bascule au collage */
    }
  }
  return null;
}

function stripHtml(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function guessLang(text: string): string {
  const fr = (text.match(/[àâçéèêëîïôùûüœæ]/gi) ?? []).length;
  const stopFr = (text.toLowerCase().match(/\b(les|des|une|est|que|qui|dans|pour|pas)\b/g) ?? []).length;
  if (fr + stopFr >= 3) return "fr";
  if (/[A-Za-z]/.test(text)) return "en";
  return "und";
}

export function isMediaOnly(text: string) {
  const stripped = text.replace(/https?:\/\/\S+/g, "").replace(/@\w+/g, "").trim();
  return stripped.length < 20;
}

export function originLabel(origin: PostOrigin, locale: "fr" | "en") {
  if (locale === "en") {
    return origin === "oembed" ? "public card" : origin === "api" ? "X API" : "pasted";
  }
  return origin === "oembed" ? "carte publique" : origin === "api" ? "API X" : "collé";
}
