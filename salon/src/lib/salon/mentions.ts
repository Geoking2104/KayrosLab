import { authorById } from "./catalog";
import type { AgentPatch, LiteraryAuthor } from "./types";
import { resolveAuthor } from "./agents";

function fold(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function handleOf(author: Pick<LiteraryAuthor, "id" | "name">, patch?: AgentPatch | null) {
  const resolved = resolveAuthor(author.id, patch);
  return resolved?.handle ?? author.id;
}

export function mentionKeys(author: Pick<LiteraryAuthor, "id" | "name" | "nameEn">, patch?: AgentPatch | null) {
  const resolved = resolveAuthor(author.id, patch);
  const names = [author.name, author.nameEn].filter(Boolean) as string[];
  const keys = [author.id, resolved?.handle];
  for (const name of names) {
    const parts = name.split(/\s+/).filter(Boolean);
    keys.push(name, parts.at(-1), parts[0]);
  }
  return keys.map((k) => fold(k ?? "")).filter(Boolean);
}

export function parseMentions(text: string, seatedIds: string[], patches: Record<string, AgentPatch> = {}) {
  const seated = seatedIds.map(authorById).filter((a): a is LiteraryAuthor => Boolean(a));
  const found: string[] = [];
  const re = /@([\p{L}0-9_.-]+)/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const key = fold(match[1]);
    if (key === "table" || key === "salon" || key === "channel" || key === "tous") {
      return { ids: [] as string[], table: true, body: text };
    }
    const hit = seated.find((author) =>
      mentionKeys(author, patches[author.id]).some((k) => k === key || k.startsWith(key)),
    );
    if (hit && !found.includes(hit.id)) found.push(hit.id);
  }
  return { ids: found, table: found.length === 0, body: text };
}

export function suggestMentions(draft: string, seatedIds: string[], patches: Record<string, AgentPatch> = {}) {
  const at = draft.lastIndexOf("@");
  if (at < 0) return [];
  const tail = draft.slice(at + 1);
  if (/\s/.test(tail)) return [];
  const needle = fold(tail);
  return seatedIds
    .map(authorById)
    .filter((a): a is LiteraryAuthor => Boolean(a))
    .filter((author) => mentionKeys(author, patches[author.id]).some((k) => k.startsWith(needle)))
    .slice(0, 6);
}

export function insertMention(draft: string, author: Pick<LiteraryAuthor, "id" | "name">, patch?: AgentPatch | null) {
  const at = draft.lastIndexOf("@");
  const token = `@${handleOf(author, patch)} `;
  if (at >= 0 && !/\s/.test(draft.slice(at + 1))) {
    return `${draft.slice(0, at)}${token}`;
  }
  return `${draft.trimEnd()} ${token}`.trimStart();
}
