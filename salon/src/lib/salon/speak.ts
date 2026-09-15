import { createServerFn } from "@tanstack/react-start";
import { authorById, buildPersona } from "./catalog";
import type { AgentPatch } from "./types";
import { ANSWER_ELENCHUS, ELENCHUS } from "./dialectic";
import { asFigure, DISPOSITIO, FIGURE_BRIEF, URBANITE } from "./rhetoric";

export const speakAsAuthor = createServerFn({ method: "POST" })
  .validator((input: {
    authorId: string;
    question: string;
    history: { name: string; text: string }[];
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
    if (!persona) return { ok: false as const, error: "auteur inconnu", text: "", grounded: false };

    const apiKey = process.env.XAI_API_KEY;
    const grounded = data.passages
      .slice(0, 3)
      .map((p) => `« ${p.work} »\n${p.text}`)
      .join("\n\n");
    const recent = data.history
      .slice(-8)
      .map((h) => `${h.name}: ${h.text}`)
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
        : [FIGURE_BRIEF[figure], DISPOSITIO, URBANITE];

    if (!apiKey) {
      const first = data.passages[0];
      const text = elenchus
        ? `${data.toName}, je ne sais pas encore ce que tu mets sous ces mots. Dans « ${first?.work ?? "un dialogue"} », la question demeure : ${first ? first.text.slice(0, 280) : "qu’entends-tu par là ?"}`
        : first
          ? `${data.act === "objection" ? `${data.toName}, je te l’accorde : ` : ""}je ne parle ici que depuis mes livres. Dans « ${first.work} » : ${first.text.slice(0, 360)}`
          : `${data.toName} n’a plus de passage sous la main — hypothèse : le salon doit relire.`;
      return { ok: true as const, text, grounded: Boolean(first), fallback: true };
    }

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 280,
        temperature: 0.35,
        messages: [
          { role: "system", content: persona },
          {
            role: "user",
            content: [
              actLine,
              ...craft,
              `Question du salon : ${data.question}`,
              recent ? `Fil récent :\n${recent}` : "",
              grounded ? `Passages retrouvés dans ta mémoire :\n${grounded}` : "Aucun passage pertinent — dis-le, puis relance.",
              "70 à 130 mots, première personne, sans listes, sans titre, sans nommer la figure.",
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
      }),
    });
    if (!res.ok) {
      const first = data.passages[0];
      const text = first
        ? `La voix assistée est muette. Je m’en tiens au livre. « ${first.work} » : ${first.text.slice(0, 360)}`
        : `La voix assistée est muette (${res.status}).`;
      return { ok: false as const, error: `xAI ${res.status}`, text, grounded: Boolean(first) };
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content?.trim() ?? "";
    return { ok: true as const, text, grounded: data.passages.length > 0, fallback: false };
  });
