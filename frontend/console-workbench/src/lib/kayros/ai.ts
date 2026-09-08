import { createServerFn } from "@tanstack/react-start";

type CollisionDraft = {
  framework: string;
  mechanism: string;
  proposal: string;
  bridge: string;
  signature: string;
};

export const generateCollisions = createServerFn({ method: "POST" })
  .validator((input: { title: string; brief: string; constraints: string[] }) => input)
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "unavailable", collisions: [] as CollisionDraft[] };

    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 900,
        temperature: 0.8,
        messages: [
          {
            role: "system",
            content:
              "Tu es le Bisociateur KayrosLab. Produis exactement 4 collisions JSON. Chaque collision: framework, mechanism, proposal, bridge, signature. signature = pont conceptuel non-évident. Pas de markdown.",
          },
          {
            role: "user",
            content: JSON.stringify({
              title: data.title,
              brief: data.brief,
              constraints: data.constraints,
            }),
          },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return { ok: false as const, error: `xAI ${res.status}`, collisions: [] as CollisionDraft[] };
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content ?? "{}";
    let parsed: { collisions?: CollisionDraft[] } = {};
    try {
      parsed = JSON.parse(text) as { collisions?: CollisionDraft[] };
    } catch {
      return { ok: false as const, error: "parse", collisions: [] as CollisionDraft[] };
    }
    const collisions = (parsed.collisions ?? []).slice(0, 4).map((c) => ({
      framework: String(c.framework ?? ""),
      mechanism: String(c.mechanism ?? ""),
      proposal: String(c.proposal ?? ""),
      bridge: String(c.bridge ?? c.signature ?? ""),
      signature: String(c.signature ?? c.bridge ?? ""),
    }));
    return { ok: true as const, collisions };
  });
