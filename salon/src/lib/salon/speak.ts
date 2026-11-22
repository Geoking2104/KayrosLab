import { createServerFn } from "@tanstack/react-start";
import { authorById, buildPersona } from "./catalog";
import type { AgentPatch } from "./types";
import { ANSWER_ELENCHUS, ELENCHUS } from "./dialectic";
import { asFigure, COMPOSITION, FIGURE_BRIEF, URBANITE } from "./rhetoric";
import { composeFromMemory, parseSpeech, pickGrounding } from "./reflect";
import { bestSentenceFor, canonical, checkTurn } from "./verify";
import { rewriteTitlesInText, workTitleFr } from "./titles-fr";

type ProviderResult = { text: string; provider: string; degraded?: string | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Appelle le modèle : proxy gouverné du backend (multi-fournisseur, retry,
 * observabilité) si configuré, sinon xAI direct. Aucune clé → repli déterministe.
 */
async function callModel(
  messages: { role: string; content: string }[],
  opts: { temperature: number; maxTokens: number; role: string },
): Promise<ProviderResult | null> {
  const proxy = process.env.SALON_LLM_URL || process.env.KAYROS_LLM_URL;
  if (proxy) {
    const res = await fetch(proxy, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, temperature: opts.temperature, role: opts.role }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return { text: "", provider: "proxy", degraded: `proxy ${res.status}` };
    const body = (await res.json()) as { text?: string; provider?: string; degraded?: string | null };
    return { text: body.text ?? "", provider: body.provider ?? "proxy", degraded: body.degraded ?? null };
  }

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return null;
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.SALON_MODEL || "grok-4.5",
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      messages,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) return { text: "", provider: "xai", degraded: `xAI ${res.status}` };
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return { text: body.choices?.[0]?.message?.content?.trim() ?? "", provider: "xai" };
}

async function generate(
  messages: { role: string; content: string }[],
  opts: { temperature: number; maxTokens: number; role: string },
): Promise<ProviderResult | null> {
  let last: ProviderResult | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const r = await callModel(messages, opts);
      if (r && r.text.trim()) return r;
      last = r;
    } catch (err) {
      last = { text: "", provider: "none", degraded: err instanceof Error ? err.message : "échec" };
    }
    await sleep(400 * (attempt + 1));
  }
  return last;
}

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
    const persona = data.persona || (author ? buildPersona(author, data.patch, data.question) : "");
    if (!author || !persona) {
      return { ok: false as const, error: "auteur inconnu", text: "", prise: "", grounded: false, citations: [] };
    }

    const last = data.history.at(-1);
    const groundQuery = `${data.question} ${last?.prise ?? ""} ${last?.text ?? ""}`.trim();

    // 5 passages, chacun réduit à LA phrase qui répond (jamais une tranche).
    const cleaned = data.passages
      .slice(0, 5)
      .map((p) => ({ work: workTitleFr(p.work), raw: p.text, sentence: bestSentenceFor(groundQuery, p.text) }))
      .filter((p) => p.sentence);

    const ground = pickGrounding(groundQuery, cleaned.map((p) => ({ work: p.work, text: p.sentence })));
    const groundedBlock = cleaned.map((p) => `« ${p.work} »\n${p.sentence}`).join("\n\n");
    const recent = data.history
      .slice(-10)
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
      "Si tu cites une phrase, elle doit être EXACTEMENT l'une des phrases des passages fournis, entre guillemets « … ». Sinon, ne cite pas : nomme seulement l'œuvre.",
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
      passage: cleaned[0] ? { id: "p0", work: cleaned[0].work, text: cleaned[0].sentence, terms: [] } : undefined,
      names: {},
      question: data.question,
      toName: data.toName,
    });

    const messages = [
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
    ];

    const first = await generate(messages, { temperature: 0.45, maxTokens: 900, role: "salon-auteur" });
    if (!first || !first.text.trim()) {
      return {
        ok: true as const,
        text: fallback.text,
        prise: fallback.prise,
        grounded: Boolean(cleaned[0]) && !ground.weak,
        fallback: true,
        citations: [],
        engine: first?.provider ?? "none",
        degraded: first?.degraded ?? "no-provider",
      };
    }

    const sources = cleaned.map((p) => p.sentence);
    const check = (text: string, prise: string) => checkTurn({
      text,
      prise,
      author,
      toName: data.toName,
      sources,
      passages: cleaned.map((p) => ({ work: p.work, text: p.sentence })),
    });

    let spoken = parseSpeech(first.text);
    let verdict = check(spoken.text, spoken.prise);

    // Une passe de réparation avec les erreurs en clair, puis repli étiqueté.
    if (!verdict.ok) {
      const repair = await generate(
        [
          ...messages,
          { role: "assistant", content: first.text },
          {
            role: "user",
            content: [
              "Ta réplique viole le contrat. Corrige exactement ces points, sans changer la thèse :",
              ...verdict.errors.map((e) => `- ${e}`),
              "Réécris au format PRISE/REPLIQUE, 90 à 170 mots, phrases complètes, sans liste.",
            ].join("\n"),
          },
        ],
        { temperature: 0.3, maxTokens: 900, role: "salon-auteur-repair" },
      );
      if (repair && repair.text.trim()) {
        const second = parseSpeech(repair.text);
        const secondVerdict = check(second.text, second.prise);
        if (secondVerdict.ok) {
          spoken = second;
          verdict = secondVerdict;
        }
      }
    }

    if (!verdict.ok) {
      return {
        ok: true as const,
        text: fallback.text,
        prise: fallback.prise,
        grounded: Boolean(cleaned[0]) && !ground.weak,
        fallback: true,
        citations: [],
        engine: first.provider,
        degraded: verdict.errors.slice(0, 3).join(" ; "),
      };
    }

    const citations = verdict.citations
      .filter((c) => c.verified)
      .map((c) => {
        const hit = cleaned.find((p) => canonical(p.sentence).includes(canonical(c.text)));
        return { work: hit?.work ?? "", text: c.text };
      })
      .filter((c) => c.work);

    return {
      ok: true as const,
      text: rewriteTitlesInText(spoken.text),
      prise: rewriteTitlesInText(spoken.prise),
      grounded: data.passages.length > 0 && !ground.weak,
      fallback: false,
      citations,
      engine: first.provider,
      degraded: first.degraded ?? null,
    };
  });
