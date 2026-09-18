import type { ConflictState } from "./conflict";

export type KgKind = "dossier" | "auteur" | "prise" | "concept" | "oeuvre";

export interface KgNode {
  id: string;
  kind: KgKind;
  label: string;
}

export interface KgEdge {
  from: string;
  to: string;
  rel: string;
}

export interface KnowledgeGraph {
  nodes: KgNode[];
  edges: KgEdge[];
}

const CONCEPTS: Array<[RegExp, string]> = [
  [/autonome|autonomie/, "autonomie"],
  [/ind[eé]pendant/, "indépendance"],
  [/volont[eé]/, "volonté"],
  [/libert[eé]|\blibre\b/, "liberté"],
  [/conscience/, "conscience"],
  [/raison|entendement/, "raison"],
  [/vertu/, "vertu"],
  [/providence|dieu/, "providence"],
  [/nature/, "nature"],
  [/contrat|souverain/, "contrat"],
  [/d[eé]finition/, "définition"],
];

export function conceptsIn(text: string) {
  const src = String(text || "").toLowerCase();
  const out: string[] = [];
  for (const [re, label] of CONCEPTS) if (re.test(src) && !out.includes(label)) out.push(label);
  return out.slice(0, 4);
}

export function graphFromConflict(
  state: ConflictState,
  extras?: { works?: { author: string; title: string }[] },
): KnowledgeGraph {
  const nodes: KgNode[] = [];
  const edges: KgEdge[] = [];
  const seen = new Set<string>();
  const add = (n: KgNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    nodes.push(n);
  };
  const dossier = state.dossier || "question de table";
  add({ id: "dossier", kind: "dossier", label: dossier.slice(0, 72) });
  for (const p of state.prises) {
    const aid = "a:" + p.author;
    add({ id: aid, kind: "auteur", label: "@" + p.author });
    add({ id: p.id, kind: "prise", label: p.text.slice(0, 80) });
    edges.push({ from: aid, to: p.id, rel: "affirme" });
    edges.push({ from: p.id, to: "dossier", rel: "sur" });
    for (const c of conceptsIn(p.text)) {
      const cid = "c:" + c;
      add({ id: cid, kind: "concept", label: c });
      edges.push({ from: p.id, to: cid, rel: "porte" });
    }
  }
  for (const l of state.liens) edges.push({ from: l.from, to: l.to, rel: l.kind });
  for (const w of extras?.works || []) {
    const wid = "w:" + w.title.slice(0, 40);
    add({ id: wid, kind: "oeuvre", label: w.title.slice(0, 48) });
    edges.push({ from: "a:" + w.author, to: wid, rel: "cite" });
  }
  return { nodes, edges };
}
