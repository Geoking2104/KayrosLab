import { createServerFn } from "@tanstack/react-start";
import { authorById, buildPersona } from "./catalog";
import type { AgentPatch } from "./types";
import { ANSWER_ELENCHUS, ELENCHUS } from "./dialectic";
import { asFigure, COMPOSITION, FIGURE_BRIEF, URBANITE } from "./rhetoric";
import { composeFromMemory, firstSentences, parseSpeech, pickGrounding } from "./reflect";

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
      work: p.work,
      text: firstSentences(p.text, 2),
    }));
    const ground = pickGrounding(`${data.question} ${data.history.at(-1)?.text ?? ""}`, cleaned);
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
        ? `Acte : objection. Tu t’adresses à ${data.toName}. Nomme-le une fois. Ne parle pas à tout le salon.`
        : data.toward === "user"
          ? `Acte : réponse. Tu t’adresses à l’hôte (${data.toName}). Réponds à sa réplique, pas à un autre auteur.`
          : `Acte : réponse. Tu t’adresses à ${data.toName}. Réponds à ce qu’il vient de dire. Nomme-le une fois.`;

    const craft = elenchus
      ? [ELENCHUS]
      : answering
        ? [ANSWER_ELENCHUS, FIGURE_BRIEF[figure], URBANITE]
        : [FIGURE_BRIEF[figure], COMPOSITION, URBANITE];

    const format = [
      "Tu écris exactement dans cet ordre, rien avant, rien après :",
      "PRISE: <une phrase : la thèse que ce tour ajoute, dans la langue de la question>",
      "REPLIQUE:",
      "<90 à 170 mots, phrases complètes, première personne, sans listes, sans titre, sans nommer la figure>",
    ].join("\n");

    const memoryNote = ground.weak
      ? "Les passages ci-dessous sont fragiles ou hors sujet. Ne les cite pas tels quels. Dis le manque, puis argumente depuis tes œuvres nommées."
      : "Ancre-toi à un seul de ces passages, par une phrase entière tissée, œuvre nommée.";

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
        temperature: 0.4,
        messages: [
          { role: "system", content: persona },
          {
            role: "user",
            content: [
              actLine,
              ...craft,
              format,
              `Question de table : ${data.question}`,
              recent ? `Fil récent (la chaîne des prises montre l’évolution) :\n${recent}` : "",
              groundedBlock ? `${memoryNote}\n${groundedBlock}` : "Aucun passage pertinent — dis-le, puis relance depuis tes œuvres chargées.",
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
    return { ok: true as const, text: spoken.text, prise: spoken.prise, grounded: data.passages.length > 0 && !ground.weak, fallback: false };
  });
