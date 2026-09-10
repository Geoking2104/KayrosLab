import catalogJson from "./catalog.json";
import corpusJson from "./corpus.json";
import { termsOf } from "./memory";
import type { AgentPatch, LiteraryAuthor, LiteraryKind, LiteraryWork, Passage } from "./types";

const NOISE =
  /expositor.?s bible|jeremiah\s*:|linked index|quotes and images|montaigne and shakspere|proclus on the/i;

export const LITERARY_KINDS = catalogJson.kinds as LiteraryKind[];

export const AUTHORS: LiteraryAuthor[] = (catalogJson.authors as LiteraryAuthor[])
  .map((author) => {
    const works = author.works.filter((work) => work.ok && !NOISE.test(work.title));
    return { ...author, works, works_count: works.length };
  })
  .sort((a, b) => a.name.localeCompare(b.name, "fr"));

const corpus = corpusJson as Record<string, { passages: Passage[]; terms: string[]; sample: string }>;

export interface LibraryExtras {
  customs: LiteraryAuthor[];
  extraWorks: Record<string, LiteraryWork[]>;
  extraPassages: Record<string, Passage[]>;
}

let extras: LibraryExtras = { customs: [], extraWorks: {}, extraPassages: {} };

export function bindLibrary(next: LibraryExtras) {
  extras = next;
}

export function allAuthors(): LiteraryAuthor[] {
  const seen = new Set(AUTHORS.map((a) => a.id));
  const customs = extras.customs.filter((a) => !seen.has(a.id));
  return [...AUTHORS, ...customs].map((author) => {
    const more = extras.extraWorks[author.id] ?? [];
    if (!more.length) return author;
    const works = [...author.works, ...more.filter((w) => !author.works.some((x) => x.title === w.title))];
    return { ...author, works, works_count: works.length };
  });
}

export function authorById(id: string) {
  return allAuthors().find((a) => a.id === id);
}

export function passagesFor(authorId: string, workTitles?: string[]): Passage[] {
  const pack = corpus[authorId];
  const extra = extras.extraPassages[authorId] ?? [];
  const base = [...(pack?.passages ?? []), ...extra];
  const unique = new Map(base.map((p) => [p.id, p]));
  const allowed =
    workTitles && workTitles.length
      ? new Set(workTitles)
      : new Set((authorById(authorId)?.works ?? []).map((w) => w.title));
  return [...unique.values()]
    .filter((p) => allowed.size === 0 || allowed.has(p.work) || p.work.length === 0)
    .map((p) => ({ ...p, terms: p.terms.length ? p.terms : termsOf(p.text) }));
}

export function searchAuthors(query: string, kind: string) {
  const needle = query.trim().toLowerCase();
  return allAuthors().filter((author) => {
    if (kind && author.kind !== kind) return false;
    if (!needle) return true;
    return [author.name, author.kind, author.era, author.blurb, ...author.works.map((w) => w.title)]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
}

export function buildPersona(author: LiteraryAuthor, patch?: AgentPatch | null) {
  const titles = (patch?.workTitles?.length
    ? author.works.filter((w) => patch.workTitles?.includes(w.title))
    : author.works
  )
    .map((w) => `« ${w.title} »`)
    .join(" ; ");
  const sample = author.sample || author.works.find((w) => w.sample)?.sample || "";
  const terms = author.terms.slice(0, 16).join(", ");
  const elocutio: Record<LiteraryKind, string> = {
    philosophe: "Élocution : tu distingues avant de conclure. Une idée, nette.",
    écrivain: "Élocution : tu montres une scène, tu ne disserte pas.",
    dramaturge: "Élocution : tu fais parler des êtres ; le jugement reste dans la réplique.",
    poète: "Élocution : le rythme porte le sens ; une image suffit.",
    essayiste: "Élocution : une maxime, puis ce qu’elle coûte.",
    savant: "Élocution : un fait observé, puis la limite de ce qu’il prouve.",
    économiste: "Élocution : un mécanisme, nommé, sans morale collée.",
  };
  const blurb = patch?.blurb?.trim() || author.blurb;
  const method = patch?.method ?? "auto";
  const methodLine =
    method === "elenchus"
      ? "Méthode imposée : elenchus. Tu ne professes pas. Une question suffit."
      : method === "rhetorique"
        ? "Méthode imposée : rhétorique de salon. Tu conclus, tu ne fais pas accoucher."
        : author.id === "platon" || author.id === "socrate"
          ? "Élocution : tu ne sais pas encore. Tu fais accoucher. Une question suffit. Tu n’apportes pas la Forme."
          : elocutio[author.kind];
  return [
    `Tu incarnes ${author.name} (${author.era}), ${author.kind}. ${blurb}`,
    `Ta connaissance et ta voix viennent exclusivement de tes œuvres du domaine public chargées pour toi.`,
    `Œuvres chargées : ${titles}.`,
    `Règles : (1) n'invoque aucune œuvre hors de cette liste et n'invente ni citation ni fait biographique — ce qui manque devient une hypothèse explicite ; (2) réponds dans la langue de la question, avec la voix de l'échantillon (ton, rythme, vocabulaire), sans parodier ; (3) tu parles en ton nom dans un salon, face aux autres auteurs et à l'hôte ; (4) quand tu t'appuies sur un passage, nomme l'œuvre.`,
    methodLine,
    patch?.note?.trim() ? `Instruction de table : ${patch.note.trim()}` : "",
    sample ? `Échantillon de voix : « ${sample} »` : "Échantillon de voix : corpus mince.",
    `Empreinte lexicale (${author.stats.words} mots, ${author.stats.distinct} termes) : ${terms}.`,
  ]
    .filter(Boolean)
    .join("\n");
}