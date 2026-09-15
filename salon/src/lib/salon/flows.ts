import { methodOf } from "./agents";
import { authorById } from "./catalog";
import { craftMoves } from "./engine";
import type { AgentPatch, FloorMove } from "./types";
import { nextSpeakers } from "./wasm";

/**
 * Routage à la BuilderBot : chaque auteur assis est un flux.
 * Le mot-clé n’est pas « hello » — c’est @handle, @table.
 */
export async function planRound(input: {
  seated: string[];
  last: string | null;
  recent: string[];
  query: string;
  mentions: string[];
  table: boolean;
  mode: "ask" | "talk";
  patches?: Record<string, AgentPatch>;
}): Promise<FloorMove[]> {
  const patches = input.patches ?? {};
  const kinds = input.seated.map((id) => authorById(id)?.kind ?? "");
  const methods = input.seated.map((id) => methodOf(id, patches[id]));

  const finish = (moves: FloorMove[]) => craftMoves(moves, input.seated, kinds, input.query, methods);

  if (input.mode === "talk") {
    const floor = await nextSpeakers({
      seated: input.seated,
      last: input.last,
      recent: input.recent,
      mode: "talk",
      addressed: null,
      kinds,
      query: input.query,
    });
    return finish(floor.moves);
  }

  const called = input.mentions.filter((id) => input.seated.includes(id));
  if (!input.table && called.length > 0) {
    const raw: FloorMove[] = called.map((id) => ({
      id,
      act: "reponse",
      to: "user",
      figure: "exemplum",
    }));
    const occupied = new Set(called);
    const other = input.seated.find((id) => !occupied.has(id) && id !== input.last);
    if (other) {
      raw.push({
        id: other,
        act: "objection",
        to: called[0],
        figure: "concessio",
      });
    }
    return finish(raw);
  }

  const floor = await nextSpeakers({
    seated: input.seated,
    last: input.last,
    recent: input.recent,
    mode: "ask",
    addressed: null,
    kinds,
    query: input.query,
  });
  return finish(floor.moves);
}
