import { authorById, authorCopy, buildPersona, passagesFor } from "../catalog";
import { pickGrounding } from "../reflect";
import { speakAsAuthor } from "../speak";
import { retrieveMemory } from "../wasm";
import { compressCourt, compressLong } from "./compress";
import { actOf, figureFor, methodFor, stancePrompt } from "./stance";
import type { PropositionX, SpeakXInput } from "./types";

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function speakForX(
  input: SpeakXInput,
  opts: { locale: "fr" | "en"; patch?: { workTitles?: string[]; blurb?: string; method?: "auto" | "rhetorique" | "elenchus"; handle?: string; note?: string } },
): Promise<PropositionX> {
  const author = authorById(input.authorId);
  if (!author) throw new Error("auteur inconnu");
  const act = actOf(input.stance);
  const method = methodFor(input.stance, input.authorId, opts.patch?.method ?? input.method);
  const figure = figureFor(input.stance, author.kind, input.these);
  const passages = passagesFor(input.authorId, opts.patch?.workTitles);
  const query = `${input.these} ${input.post.text}`;
  const memory = await retrieveMemory(query, passages);
  const cited = memory.hits
    .map((hit) => passages.find((p) => p.id === hit.id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .slice(0, 3);
  const ground = pickGrounding(query, cited.map((p) => ({ work: p.work, text: p.text })));
  const handle = input.post.handle ? `@${input.post.handle.replace(/^@/, "")}` : input.post.name || "l’auteur";
  const spoken = await speakAsAuthor({
    data: {
      authorId: input.authorId,
      question: input.these,
      history: [{ name: handle, text: input.post.text, prise: input.these }],
      passages: cited.map((p) => ({ work: p.work, text: p.text })),
      act,
      toName: handle,
      toward: "author",
      figure,
      method,
      patch: opts.patch,
      persona: [buildPersona(author, opts.patch), stancePrompt(input.stance, input.post.handle)].join("\n"),
    },
  });
  const prise = (spoken.prise || "").trim() || input.these;
  const replique = (spoken.text || "").trim();
  const name = authorCopy(author, opts.locale).name;
  const work = ground.weak ? undefined : ground.work || cited[0]?.work;
  return {
    id: uid("px"),
    postId: input.post.id,
    circleId: input.circleId,
    authorId: input.authorId,
    stance: input.stance,
    prise,
    replique,
    court: compressCourt({ prise, authorName: name, locale: opts.locale, work }),
    long: compressLong({ prise, replique, authorName: name, locale: opts.locale, work }),
    work,
    grounded: Boolean(spoken.grounded) && !ground.weak,
    weakMemory: ground.weak || cited.length === 0,
    createdAt: new Date().toISOString(),
    act,
    figure,
    method,
  };
}

export const MAX_AUTHORS_X = 4;
