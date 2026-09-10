import { createServerFn } from "@tanstack/react-start";
import { termsOf, workFromText } from "./memory";

export const searchPublicWorks = createServerFn({ method: "POST" })
  .validator((query: string) => query)
  .handler(async ({ data: query }) => {
    const needle = query.trim();
    if (needle.length < 2) return [] as { id: number; title: string; authors: string }[];
    const res = await fetch(`https://gutendex.com/books?search=${encodeURIComponent(needle)}`);
    if (!res.ok) return [];
    const json = (await res.json()) as {
      results?: { id: number; title: string; authors?: { name: string }[] }[];
    };
    return (json.results ?? []).slice(0, 8).map((book) => ({
      id: book.id,
      title: book.title,
      authors: (book.authors ?? []).map((a) => a.name).join(", "),
    }));
  });

export const ingestPublicWork = createServerFn({ method: "POST" })
  .validator((input: { id: number; title: string }) => input)
  .handler(async ({ data }) => {
    const meta = await fetch(`https://gutendex.com/books/${data.id}`);
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
