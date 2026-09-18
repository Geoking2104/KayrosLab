import type { FloorMove, Passage } from "./types";
import { composeFromMemory } from "./reflect";

export function speakFromMemory(input: {
  move: FloorMove;
  passage: Passage | undefined;
  names: Record<string, string>;
  question?: string;
}) {
  return composeFromMemory(input).text;
}
