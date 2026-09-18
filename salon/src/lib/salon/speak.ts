import { createServerFn } from "@tanstack/react-start";
import { authorById, buildPersona } from "./catalog";
import type { AgentPatch } from "./types";
import { ANSWER_ELENCHUS, ELENCHUS } from "./dialectic";
import { asFigure, COMPOSITION, FIGURE_BRIEF, URBANITE } from "./rhetoric";
import { composeFromMemory, firstSentences, parseSpeech, pickGrounding } from "./reflect";
import { rewriteTitlesInText, workTitleFr } from "./titles-fr";

export const speakAsAuthor = createServerFn({ method: "POST" })
  .validator((input: {
    authorId: string;
    question: string;
    history: { name: string; text: string; prise?: string }[];
    passages: { work: string; text: string }[];
    act: "reponse" | "objection";
    toName: string;
    toward: "user" | "author";
    figure?: string;
    method?: string;
    answering?: string;
    patch?: AgentPatch;
    persona?: string;
  }) => input)
  .handler(async ({ data }) => {
    const author = authorById(data.authorId);
    const persona = data.persona || (author ? buildPersona(author, data.patch) : "");
    if (!persona) return { ok: false as const, error: "auteur inconnu", text: "", prise: "", grounded: false };

    const apiKey = process.env.XAI_API_KEY;
    const cleaned = data.passages.slice(0, 3).map((p) => ({
      work: workTitleFr(p.work),
      text: firstSentences(p.text, 2),
    }));
    const last = data.history.at(-1);
    const groundQuery = `${data.question} ${last?.prise ?? ""} ${last?.text ?? ""}`;
    const ground = pickGrounding(groundQuery, cleaned);
    const groundedBlock = cleaned.map((p) => `« ${p.work} »\n${p.text}`).join("\n\n");
    const recent = data.history
      .slice(-8)
      .map((h) => (h.prise ? `${h.name} [prise : ${h.prise}] : ${h.text}` : `${h.name}: ${h.text}`))
      .join("\n");
    const figure = asFigure(data.figure);
    const elenchus = data.method === "elenchus";
    const answering = data.answering === "elenchus";

    const actLine =
      data.act === "objection"
        ? `Acte : objection. Tu t’adresses à ${data.toName}. Nomme-le une fois. Tu objectes à SA PRISE, pas à un autre problème.`
        : data.toward === "user"
          ? `Acte : réponse à l’hôte (${data.toName}). Tu réponds à la question de table telle qu’il l’a posée.`
          : `Acte : réponse. Tu t’adresses à ${data.toName}. Tu fais avancer SA dernière prise d’un cran, toujours sur la question de table.`;

    const craft = elenchus
      ? [ELENCHUS]
      : answering
        ? [ANSWER_ELENCHUS, FIGURE_BRIEF[figure], URBANITE]
        : [FIGURE_BRIEF[figure], COMPOSITION, URBANITE];

    const format = [
      "Tu écris exactement dans cet ordre, rien avant, rien après :",
      "PRISE: <une phrase : la thèse que CE tour ajoute à la question de table>",
      "REPLIQUE:",
      "<90 à 170 mots, phrases complètes, première personne, sans listes, sans titre de section>",
    ].join("\n");

    const thread = [
      `Question de table (fil directeur — ne la quitte pas) : ${data.question}`,
      last
        ? `Dernier tour à enchaîner : ${last.name}${last.prise ? ` — prise : ${last.prise}` : ""}. ${last.text}`
        : "Tu ouvres la table : ressaisis la question, puis prends position.",
      "Cohérence : chaque phrase doit pouvoir se lire comme la suite de la précédente. Pas de nouveau dossier.",
      "Titres : cite uniquement le titre français reçu de l’œuvre.",
    ].join("\n");

    const memoryNote = ground.weak
      ? "Les passages ci-dessous sont fragiles ou hors sujet. Ne les cite pas. Argumente depuis tes œuvres nommées (titre français), sur la question de table."
      : "Ancre-toi à un seul de ces passages, œuvre nommée en français, seulement s’il répond à la question.";

    const fallbackMove = {
      id: data.authorId,
      act: data.act,
      to: data.toward === "user" ? "user" : data.toName,
      figure,
      method: elenchus ? "elenchus" : "rhetorique",
    } as const;
    const fallback = composeFromMemory({
      move: fallbackMove,
      passage: cleaned[0] ? { id: "p0", work: cleaned[0].work, text: cleaned[0].text, terms: [] } : undefined,
      names: {},
      question: data.question,
      toName: data.toName,
    });

    if (!apiKey) {
      return { ok: true as const, text: fallback.text, prise: fallback.prise, grounded: Boolean(cleaned[0]) && !ground.weak, fallback: true };
    }

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 420,
        temperature: 0.35,
        messages: [
          { role: "system", content: persona },
          {
            role: "user",
            content: [
              actLine,
              thread,
              ...craft,
              format,
              recent ? `Fil récent :\n${recent}` : "",
              groundedBlock ? `${memoryNote}\n${groundedBlock}` : "Aucun passage pertinent — dis-le, puis relance depuis tes œuvres, sur la question.",
            ].filter(Boolean).join("\n\n"),
          },
        ],
      }),
    });
    if (!res.ok) {
      return { ok: false as const, error: `xAI ${res.status}`, text: fallback.text, prise: fallback.prise, grounded: Boolean(cleaned[0]) && !ground.weak };
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = body.choices?.[0]?.message?.content?.trim() ?? "";
    const spoken = raw ? parseSpeech(raw) : fallback;
    if (!spoken.text) {
      return { ok: true as const, text: fallback.text, prise: fallback.prise, grounded: Boolean(cleaned[0]) && !ground.weak, fallback: true };
    }
    return {
      ok: true as const,
      text: rewriteTitlesInText(spoken.text),
      prise: rewriteTitlesInText(spoken.prise),
      grounded: data.passages.length > 0 && !ground.weak,
      fallback: false,
    };
  });
