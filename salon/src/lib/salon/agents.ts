import { authorById } from "./catalog";
import type { AgentPatch, LiteraryAuthor, SpeechMethodPref } from "./types";

export interface ResolvedAuthor extends LiteraryAuthor {
  handle: string;
  method: SpeechMethodPref;
  note: string;
  workTitles: string[];
}

export function cleanHandle(value: string) {
  return value
    .trim()
    .replace(/^@/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 24);
}

export function resolveAuthor(id: string, patch?: AgentPatch | null): ResolvedAuthor | null {
  const base = authorById(id);
  if (!base) return null;
  const workTitles =
    patch?.workTitles?.filter((title) => base.works.some((w) => w.title === title)) ??
    base.works.map((w) => w.title);
  const works = workTitles.length
    ? base.works.filter((w) => workTitles.includes(w.title))
    : base.works;
  return {
    ...base,
    blurb: patch?.blurb?.trim() || base.blurb,
    works,
    works_count: works.length,
    handle: cleanHandle(patch?.handle || base.id) || base.id,
    method: patch?.method ?? "auto",
    note: patch?.note?.trim() ?? "",
    workTitles: works.map((w) => w.title),
  };
}

export function methodOf(id: string, patch?: AgentPatch | null): SpeechMethodPref {
  if (patch?.method && patch.method !== "auto") return patch.method;
  if (id === "platon" || id === "socrate") return "elenchus";
  return "rhetorique";
}
