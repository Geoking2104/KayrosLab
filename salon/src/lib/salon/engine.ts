import type { FloorMove, FloorResult, Passage, SpeechMethodPref } from "./types";

function tokens(text: string) {
  return text
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 4);
}

export function figureOf(kind: string, act: string, query: string) {
  if (act === "objection") return "concessio";
  const q = query.toLowerCase();
  if (kind === "philosophe") {
    if (/(dieu|providence|optimisme|vertu)/.test(q)) return "ironia";
    if (q.includes("?") || /(pourquoi|comment|faut)/.test(q)) return "interrogatio";
    return "distinctio";
  }
  if (kind === "essayiste") return "sententia";
  if (kind === "écrivain" || kind === "dramaturge" || kind === "poète") return "hypotypose";
  return "exemplum";
}

export function retrieveFallback(query: string, passages: Passage[]): FloorResult {
  const q = tokens(query);
  if (!passages.length) return { hits: [], speakers: [], moves: [], note: "mémoire" };
  if (!q.length) {
    return {
      hits: passages.slice(0, 3).map((p) => ({ id: p.id, score: 0.1 })),
      speakers: [],
      moves: [],
      note: "mémoire",
    };
  }
  const hits = passages
    .map((p) => {
      let score = 0;
      for (const term of p.terms.length ? p.terms : tokens(p.text).slice(0, 16)) {
        const t = term.toLowerCase();
        if (q.some((w) => w === t || t.includes(w) || w.includes(t))) score += 1;
      }
      const den = Math.sqrt(Math.max(p.terms.length || 8, 1));
      return { id: p.id, score: score / den };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  return { hits, speakers: [], moves: [], note: "mémoire" };
}

function isSocratic(id: string, method?: SpeechMethodPref) {
  if (method === "rhetorique") return false;
  if (method === "elenchus") return true;
  return id === "platon" || id === "socrate";
}

export function craftMoves(
  moves: FloorMove[],
  seated: string[],
  kinds: string[],
  query: string,
  methods: SpeechMethodPref[] = [],
): FloorMove[] {
  const kindOf = (id: string) => kinds[seated.indexOf(id)] ?? "";
  const methodOf = (id: string) => methods[seated.indexOf(id)] ?? "auto";
  const next = moves.map((m) => {
    if (isSocratic(m.id, methodOf(m.id))) return { ...m, method: "elenchus", figure: "interrogatio" };
    return { ...m, method: "rhetorique", figure: figureOf(kindOf(m.id), m.act, query) };
  });
  if (next.length >= 2 && next[0].method === "elenchus") {
    const first = next[0].id;
    next[1] = {
      ...next[1],
      act: "reponse",
      to: first,
      method: isSocratic(next[1].id, methodOf(next[1].id)) ? "elenchus" : "rhetorique",
      figure: isSocratic(next[1].id, methodOf(next[1].id))
        ? "interrogatio"
        : figureOf(kindOf(next[1].id), "reponse", query),
    };
  }
  return next;
}

export function floorFallback(input: {
  seated: string[];
  last: string | null;
  recent: string[];
  mode: "ask" | "talk";
  addressed: string | null;
  kinds?: string[];
  query?: string;
}): FloorResult {
  const { seated, last, recent, mode, addressed } = input;
  const kinds = input.kinds ?? [];
  const query = input.query ?? "";
  if (!seated.length) return { hits: [], speakers: [], moves: [], note: "parole" };
  const spoken = new Map(seated.map((id) => [id, 0]));
  for (const id of recent) spoken.set(id, (spoken.get(id) ?? 0) + 1);
  const ranked = [...seated].sort((a, b) => (spoken.get(a) ?? 0) - (spoken.get(b) ?? 0) || a.localeCompare(b));
  const replyTo = last && last !== "user" ? last : "user";

  if (mode === "talk") {
    const id = ranked.find((x) => x !== last) ?? seated[0];
    const moves = craftMoves([{ id, act: "reponse", to: replyTo, figure: "exemplum" }], seated, kinds, query);
    return { hits: [], speakers: moves.map((m) => m.id), moves, note: "parole" };
  }

  const first =
    (addressed && seated.includes(addressed) ? addressed : ranked.find((x) => x !== last)) ?? seated[0];
  const raw: FloorMove[] = [
    { id: first, act: "reponse", to: last === "user" || !last ? "user" : replyTo, figure: "exemplum" },
  ];
  const second = ranked.find((x) => x !== first && x !== last);
  if (second) raw.push({ id: second, act: "objection", to: first, figure: "concessio" });
  const moves = craftMoves(raw, seated, kinds, query);
  return { hits: [], speakers: moves.map((m) => m.id), moves, note: "parole" };
}
