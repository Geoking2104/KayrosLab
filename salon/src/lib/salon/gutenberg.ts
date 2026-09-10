import { createServerFn } from "@tanstack/react-start";
import { termsOf, workFromText } from "./memory";

export type PublicHit = {
  key: string;
  title: string;
  authors: string;
  source: "gutenberg" | "atramenta";
  gutenbergId?: number;
  url?: string;
};

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&/gi, "&")
    .replace(/</gi, "<")
    .replace(/>/gi, ">")
    .replace(/"/gi, '"')
    .replace(/&#0?39;|'|&rsquo;/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/\s+/g, " ")
    .trim();
}

async function searchGutenberg(needle: string): Promise<PublicHit[]> {
  const res = await fetch(`https://gutendex.com/books?search=${encodeURIComponent(needle)}`);
  if (!res.ok) return [];
  const json = (await res.json()) as {
    results?: { id: number; title: string; authors?: { name: string }[] }[];
  };
  return (json.results ?? []).slice(0, 8).map((book) => ({
    key: `gutenberg:${book.id}`,
    title: book.title,
    authors: (book.authors ?? []).map((a) => a.name).join(", "),
    source: "gutenberg" as const,
    gutenbergId: book.id,
  }));
}

async function searchAtramenta(needle: string): Promise<PublicHit[]> {
  const urls = [
    `https://www.atramenta.net/lire/recherche/${encodeURIComponent(needle)}`,
    `https://www.atramenta.net/index.php?q=${encodeURIComponent(needle)}`,
  ];
  const hits: PublicHit[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(12_000) });
      if (!res.ok) continue;
      const html = await res.text();
      const re = /href="(\/lire\/[a-z0-9-]+\/\d+)"[^>]*>\s*([^<]{3,120})/gi;
      for (const match of html.matchAll(re)) {
        const path = match[1];
        const title = match[2].trim();
        if (seen.has(path) || /chapitre|page/i.test(title)) continue;
        seen.add(path);
        hits.push({
          key: `atramenta:${path}`,
          title,
          authors: "Atramenta · domaine public",
          source: "atramenta",
          url: `https://www.atramenta.net${path}`,
        });
        if (hits.length >= 8) return hits;
      }
    } catch {
      /* Atramenta is optional when the catalogue is down. */
    }
  }
  return hits;
}

export const searchPublicWorks = createServerFn({ method: "POST" })
  .validator((query: string) => query)
  .handler(async ({ data: query }) => {
    const needle = query.trim();
    if (needle.length < 2) return [] as PublicHit[];
    const [gutenberg, atramenta] = await Promise.all([searchGutenberg(needle), searchAtramenta(needle)]);
    return [...atramenta, ...gutenberg].slice(0, 12);
  });

export const ingestPublicWork = createServerFn({ method: "POST" })
  .validator((input: { title: string; gutenbergId?: number; url?: string; source?: string }) => input)
  .handler(async ({ data }) => {
    if (data.source === "atramenta" && data.url) {
      const chapter = data.url.replace(/\/$/, "");
      const page = /\/\d+$/.test(chapter) ? `${chapter}/1` : chapter;
      const res = await fetch(page, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return { ok: false as const, error: "introuvable" };
      const text = htmlToText(await res.text()).slice(0, 90_000);
      if (text.length < 400) return { ok: false as const, error: "texte inaccessible" };
      const packed = workFromText(data.title, data.url, "atramenta", text);
      return {
        ok: true as const,
        work: packed.work,
        passages: packed.passages,
        terms: termsOf(text).slice(0, 16),
        sample: packed.work.sample ?? "",
      };
    }
    const id = data.gutenbergId;
    if (!id) return { ok: false as const, error: "introuvable" };
    const meta = await fetch(`https://gutendex.com/books/${id}`);
    if (!meta.ok) return { ok: false as const, error: "introuvable" };
    const book = (await meta.json()) as {
      title: string;
      formats?: Record<string, string>;
    };
    const formats = book.formats ?? {};
    const textUrl =
      formats["text/plain; charset=utf-8"] ||
      formats["text/plain"] ||
      Object.entries(formats).find(([k]) => k.startsWith("text/plain"))?.[1];
    if (!textUrl) return { ok: false as const, error: "pas de texte" };
    const raw = await fetch(textUrl);
    if (!raw.ok) return { ok: false as const, error: "texte inaccessible" };
    const text = (await raw.text()).replace(/\u0000/g, "").slice(0, 90_000);
    const packed = workFromText(book.title || data.title, textUrl, "gutenberg", text);
    return {
      ok: true as const,
      work: packed.work,
      passages: packed.passages,
      terms: termsOf(text).slice(0, 16),
      sample: packed.work.sample ?? "",
    };
  });
