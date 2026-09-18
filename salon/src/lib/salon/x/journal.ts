import type { BrouillonX, PostSource, PropositionX, TheseSource } from "./types";

const KEY = "kayros-salon-x-journal";

export interface FluxJournal {
  posts: Record<string, PostSource>;
  theses: Record<string, TheseSource>;
  propositions: PropositionX[];
  drafts: BrouillonX[];
  lastAuthors: Record<string, string[]>;
}

function empty(): FluxJournal {
  return { posts: {}, theses: {}, propositions: [], drafts: [], lastAuthors: {} };
}

export function loadJournal(): FluxJournal {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? ({ ...empty(), ...JSON.parse(raw) } as FluxJournal) : empty();
  } catch {
    return empty();
  }
}

export function saveJournal(journal: FluxJournal) {
  try {
    const trimmed: FluxJournal = {
      ...journal,
      propositions: journal.propositions.slice(-80),
      drafts: journal.drafts.slice(-80),
    };
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* quota */
  }
}

export function rememberPost(post: PostSource, these: TheseSource) {
  const j = loadJournal();
  j.posts[post.id] = post;
  j.theses[post.id] = these;
  saveJournal(j);
}

export function rememberProps(props: PropositionX[]) {
  const j = loadJournal();
  j.propositions = [...j.propositions, ...props];
  const last = props[0];
  if (last) {
    j.lastAuthors[last.circleId] = [...new Set(props.map((p) => p.authorId))];
  }
  saveJournal(j);
}

export function rememberDraft(draft: BrouillonX) {
  const j = loadJournal();
  j.drafts = [...j.drafts.filter((d) => d.id !== draft.id), draft];
  saveJournal(j);
}
