import catalogJson from "./catalog.json";
import corpusJson from "./corpus.json";
import doctrineJson from "./doctrine.json";
import { termsOf } from "./memory";
import { sentencesOf } from "./reflect";
import { wordCount } from "./verify";
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

type DoctrineThesis = { fr?: string; en?: string; anchors?: { work: string; startsWith: string }[] };
type DoctrineEntry = { concepts?: string[]; theses?: Record<string, Record<string, DoctrineThesis>> };
const DOCTRINE = doctrineJson as Record<string, DoctrineEntry>;

export function doctrineFor(authorId: string): DoctrineEntry | null {
  return DOCTRINE[authorId] ?? null;
}

/** Thèses de l'auteur, aplaties et indexées par domaine. */
export function thesesOf(authorId: string): { domain: string; fr: string; en: string; anchors: { work: string; startsWith: string }[] }[] {
  const entry = DOCTRINE[authorId];
  if (!entry || !entry.theses) return [];
  const out: { domain: string; fr: string; en: string; anchors: { work: string; startsWith: string }[] }[] = [];
  for (const [domain, demands] of Object.entries(entry.theses)) {
    for (const t of Object.values(demands || {})) {
      if (!t || (!t.fr && !t.en)) continue;
      out.push({ domain, fr: t.fr || t.en || "", en: t.en || t.fr || "", anchors: t.anchors || [] });
    }
  }
  return out;
}

/** Sélection déterministe des thèses les plus proches de la question. */
export function selectTheses(authorId: string, question?: string, limit = 4) {
  const list = thesesOf(authorId);
  if (!list.length) return [];
  const q = String(question || "").toLowerCase();
  const words = new Set((q.match(/[\p{L}]{4,}/gu) ?? []).map((w) => w.toLowerCase()));
  const scored = list.map((t, i) => {
    const blob = `${t.domain} ${t.fr} ${t.en}`.toLowerCase();
    let hit = 0;
    for (const w of words) if (blob.includes(w)) hit += 1;
    return { t, i, score: hit };
  });
  scored.sort((a, b) => (b.score - a.score) || (a.i - b.i));
  return scored.slice(0, limit).map((x) => x.t);
}

/** Profil de voix mesuré (longueur, ponctuation, lexique) — jamais inventé. */
export function voiceProfile(author: LiteraryAuthor): string {
  const samples = (author.samples && author.samples.length ? author.samples : [author.sample]).filter(Boolean);
  const text = samples.join(" ");
  const sents = sentencesOf(text);
  const avg = sents.length ? Math.round(sents.reduce((n, s) => n + wordCount(s), 0) / sents.length) : 0;
  const questions = (text.match(/\?/g) || []).length;
  const exclam = (text.match(/!/g) || []).length;
  const semis = (text.match(/;/g) || []).length;
  const terms = (author.terms || []).slice(0, 8).join(", ");
  return [
    avg ? `phrase moyenne ~${avg} mots` : "",
    `ponctuation : ${questions} interrogation(s), ${exclam} exclamation(s), ${semis} point(s)-virgule(s)`,
    terms ? `lexique récurrent : ${terms}` : "",
  ].filter(Boolean).join(" ; ");
}

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
    .map((p) => ({ ...p, terms: p.terms && p.terms.length ? p.terms : termsOf(p.text) }));
}

export function authorCopy(author: LiteraryAuthor, locale: "fr" | "en") {
  const en = locale === "en";
  return {
    name: en && author.nameEn ? author.nameEn : author.name,
    blurb: en && author.blurbEn ? author.blurbEn : author.blurb,
    era: en && author.eraEn ? author.eraEn : author.era,
  };
}

export function searchAuthors(query: string, kind: string) {
  const needle = query.trim().toLowerCase();
  return allAuthors().filter((author) => {
    if (kind && author.kind !== kind) return false;
    if (!needle) return true;
    return [
      author.name,
      author.nameEn,
      author.kind,
      author.era,
      author.eraEn,
      author.blurb,
      author.blurbEn,
      ...author.works.map((w) => w.title),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
}

export function buildPersona(author: LiteraryAuthor, patch?: AgentPatch | null, question?: string) {
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
    tradition: "Élocution : tu parles depuis l’écriture. Une parole, puis le silence qu’elle ouvre.",
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
  const theses = selectTheses(author.id, question, 4);
  const doctrineBlock = theses.length
    ? [
        "Thèses que tu peux signer (d'après tes œuvres — ne les récite pas, sers-t'en) :",
        ...theses.map((t) => `- [${t.domain}] ${t.fr}`),
        theses.some((t) => t.anchors.length)
          ? `Ancres disponibles : ${theses.flatMap((t) => t.anchors.map((a) => `« ${a.work} »`)).slice(0, 4).join(" ; ")}.`
          : "",
      ].filter(Boolean).join("\n")
    : "";
  const samples = (author.samples && author.samples.length ? author.samples : [author.sample]).filter(Boolean).slice(0, 3);
  const voiceBlock = samples.length
    ? [
        `Profil de voix (mesuré sur tes œuvres) : ${voiceProfile(author)}.`,
        "Exemples de voix (verbatim de tes œuvres ; ne les présente jamais comme des citations) :",
        ...samples.map((s, i) => `${i + 1}. « ${s} »`),
      ].join("\n")
    : "";
  const constraints = [
    "Contraintes : n'invente ni citation ni œuvre ; ne cite qu'une phrase entière réellement présente dans les passages fournis ;",
    "aucun concept, fait ou événement postérieur à ta mort ; une seule œuvre nommée par tour ; si aucun passage ne répond, dis-le et argumente sans citer.",
  ].join(" ");
  return [
    `Tu incarnes ${author.name} (${author.era}), ${author.kind}. ${blurb}`,
    `Ta connaissance et ta voix viennent exclusivement de tes œuvres du domaine public chargées pour toi.`,
    `Œuvres chargées : ${titles}.`,
    `Règles : (1) n'invoque aucune œuvre hors de cette liste et n'invente ni citation ni fait biographique — ce qui manque devient une hypothèse explicite ; (2) réponds dans la langue de la question, avec la voix de l'échantillon (ton, rythme, vocabulaire), sans parodier ; (3) tu parles en ton nom dans un salon, face aux autres auteurs et à l'hôte ; (4) quand tu t'appuies sur un passage, nomme l'œuvre.`,
    methodLine,
    doctrineBlock,
    voiceBlock,
    constraints,
    patch?.note?.trim() ? `Instruction de table : ${patch.note.trim()}` : "",
    sample ? `Échantillon de voix : « ${sample} »` : "Échantillon de voix : corpus mince.",
    // Retiré (plan de correction v2, D2) : l'empreinte lexicale alourdissait le prompt
    // sans porter la voix ; voir salon-engine.js, persona().
    // `Empreinte lexicale (${author.stats.words} mots, ${author.stats.distinct} termes) : ${terms}.`,
  ]
    .filter(Boolean)
    .join("\n");
}