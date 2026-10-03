#!/usr/bin/env node
/**
 * kb_quote_audit.mjs — audite la fidélité des formules `verbatim` : chaque
 * phrase citée doit être une sous-chaîne exacte d'une source préparée
 * (raw/<slug>.txt). Sortie : rapport Markdown dans salon/scripts/reports/.
 *
 * Note : en mode bootstrap (--from-corpus), aucune source locale n'existe :
 * l'audit saute les auteurs sans sources. Il devient pleinement actif dès que
 * `openkb_ingest.mjs` a préparé les bases.
 *
 * Usage :
 *   node salon/scripts/kb_quote_audit.mjs --all
 *   node salon/scripts/kb_quote_audit.mjs --author voltaire --sample 100
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MIRROR_DIR, REPORTS_DIR, kbRawDir, kbRoot, loadKbMap, nowIso, parseArgs,
  readJSON, writeJSON,
} from "./openkb_common.mjs";

/** Canonicalisation légère pour comparaison de sous-chaîne. */
export function canonical(text) {
  return String(text || "")
    .replace(/\u00A0/g, " ")
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')
    .replace(/[\u2013\u2014\u2010\u2011]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

function sourcesFor(authorId, root) {
  const rawDir = kbRawDir(authorId, root);
  if (!existsSync(rawDir)) return [];
  return readdirSync(rawDir).filter((f) => f.endsWith(".txt")).sort()
    .map((f) => ({ file: f, text: canonical(readFileSync(join(rawDir, f), "utf8")) }));
}

export function auditAuthor(authorId, { root = kbRoot(), sample = 0 } = {}) {
  const pack = readJSON(join(MIRROR_DIR, "kb", `${authorId}.json`));
  if (!pack) return { authorId, status: "no-pack", checked: 0, failed: [] };
  const verbatim = (pack.formulas || []).filter((f) => f.kind === "verbatim");
  const sources = sourcesFor(authorId, root);
  if (!sources.length) return { authorId, status: "no-source", checked: 0, failed: [], total: verbatim.length };
  const list = sample > 0 ? verbatim.slice(0, sample) : verbatim;
  const failed = [];
  for (const f of list) {
    const needle = canonical(f.text);
    const hit = sources.some((s) => s.text.includes(needle));
    if (!hit) failed.push({ id: f.id, work: f.work, excerpt: needle.slice(0, 90) });
  }
  return { authorId, status: failed.length ? "failed" : "ok", checked: list.length, total: verbatim.length, failed };
}

async function main() {
  const args = parseArgs();
  const root = args.root ? String(args.root) : kbRoot();
  const map = loadKbMap();
  const targets = args.all ? Object.keys(map.authors) : [String(args.author || "voltaire")];
  const sample = args.sample ? Number(args.sample) : 0;

  const rows = [];
  for (const id of targets) rows.push(auditAuthor(id, { root, sample }));

  const ok = rows.filter((r) => r.status === "ok").length;
  const skipped = rows.filter((r) => r.status === "no-source").length;
  const failed = rows.filter((r) => r.status === "failed");

  const lines = [
    `# Audit de citations — Salon × OpenKB`,
    ``,
    `- Date : ${nowIso()}`,
    `- Base : \`${root}\``,
    `- Auteurs audités : ${rows.length} — ✓ ${ok}, sans source ${skipped} (bootstrap), ✗ ${failed.length}`,
    ``,
  ];
  for (const r of rows) {
    lines.push(`## ${r.authorId} — ${r.status}`);
    lines.push(`- Formules vérifiées : ${r.checked}/${r.total ?? 0}`);
    for (const f of (r.failed || []).slice(0, 20)) lines.push(`  - ✗ ${f.id} (${f.work}) : « ${f.excerpt}… »`);
    lines.push("");
  }

  const reportFile = join(REPORTS_DIR, `kb-quote-audit-${nowIso().slice(0, 10)}.md`);
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(reportFile, lines.join("\n"), "utf8");

  console.log(`→ Audit citations : ${ok} ok, ${skipped} sans source (bootstrap), ${failed.length} en échec.`);
  console.log(`  Rapport : ${reportFile}`);
  if (failed.length) process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("kb_quote_audit.mjs")) {
  main().catch((e) => { console.error(`ERREUR: ${e.message}`); process.exit(1); });
}
