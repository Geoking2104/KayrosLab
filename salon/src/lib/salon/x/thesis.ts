import { firstSentences } from "../reflect";
import { isMediaOnly } from "./ingest";
import type { PostSource, TheseSource } from "./types";

export function extractThese(post: PostSource): TheseSource {
  const stripped = post.text.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  if (isMediaOnly(stripped)) {
    return { postId: post.id, text: "", edited: false, model: "extractif" };
  }
  const first = firstSentences(stripped, 1) || stripped;
  const text = first.length > 180 ? `${first.slice(0, 177).trim()}…` : first;
  return { postId: post.id, text, edited: false, model: "extractif" };
}

export function theseReady(these: TheseSource) {
  return these.text.trim().length >= 12;
}
