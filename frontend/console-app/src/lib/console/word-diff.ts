export type DiffPart = { op: "same" | "add" | "del"; text: string };
/** Diff par mots (LCS) entre deux textes courts (briefs) ; borné à 600 mots par côté. */
export function wordDiff(a: string, b: string): DiffPart[] {
  const A = (a || "").split(/(\s+)/).filter(Boolean).slice(0, 1200);
  const B = (b || "").split(/(\s+)/).filter(Boolean).slice(0, 1200);
  const n = A.length, m = B.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (op: DiffPart["op"], text: string) => { const last = out[out.length - 1]; if (last?.op === op) last.text += text; else out.push({ op, text }); };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push("same", A[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) push("del", A[i++]);
    else push("add", B[j++]);
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("add", B[j++]);
  return out;
}
