#!/usr/bin/env node
/**
 * openkb_ingest.mjs — prépare la matière d'un auteur pour sa base OpenKB.
 *
 * Pour chaque œuvre enregistrée (catalog.json, works[] ok:true) :
 *   1. télécharge le texte (URL Gutenberg du catalogue) ;
 *   2. normalise (en-tête/pied Gutenberg retirés, espaces nettoyés) ;
 *   3. écrit dans la base : raw/<slug>.txt (source d'audit) et
 *      raw/<slug>/part-XX.md (parties équilibrées prêtes pour `openkb add`).
 *   4. consigne les empreintes (sha256) dans salon/kb-map.json.
 *
 * La base est locale (SALON_KB_ROOT) ; la synchronisation REST se fait ensuite
 * avec openkb_sync.mjs. Déterministe : jamais de trou (une œuvre en échec
 * conserve son entrée précédente).
 *
 * Usage :
 *   node salon/scripts/openkb_ingest.mjs --author voltaire
 *   node salon/scripts/openkb_ingest.mjs --all
 *   node salon/scripts/openkb_ingest.mjs --author smith --force --dry-run
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  acquireLock, cutGutenberg, kbDir, kbRawDir, kbRoot, loadCatalog, loadKbMap,
  nowIso, parseArgs, saveKbMap, sha256, slugify, splitIntoParts,
} from "./openkb_common.mjs";

const UA = "KayrosLab-Salon-OpenKB/1.0 (corpus preparation; contact@kayroslab.com)";

export function worksForAuthor(catalog, authorId) {
  const author = catalog.authors.find((a) => a.id === authorId);
  if (!author) throw new Error(`auteur inconnu : ${authorId}`);
  return {
    author,
    works: (author.works || []).filter((w) => w.ok && w.url),
  };
}

async function fetchText(url, timeoutMs = 60000) {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.text();
}

/**
 * Prépare (ou rafraîchit) la matière d'un auteur dans sa base.
 * @returns {{authorId:string, staged:number, unchanged:number, failed:number, dryRun:boolean}}
 */
export async function ingestAuthor(authorId, { root = kbRoot(), catalog = loadCatalog(), map = loadKbMap(), dryRun = false, force = false, log = console.log } = {}) {
  const { works } = worksForAuthor(catalog, authorId);
  const rawDir = kbRawDir(authorId, root);
  const entry = map.authors[authorId] || (map.authors[authorId] = { kb: `salon-${authorId}`, works: [] });
  const prevByTitle = new Map((entry.works || []).map((w) => [w.title, w]));

  const report = { authorId, staged: 0, unchanged: 0, failed: 0, dryRun };
  const nextWorks = [];

  for (const work of works) {
    const slug = slugify(work.title);
    const prev = prevByTitle.get(work.title);
    const txtPath = join(rawDir, `${slug}.txt`);
    const partsDir = join(rawDir, slug);

    if (!force && prev && prev.status !== "failed" && prev.hash && prev.raw === txtPath) {
      // Empreinte déjà connue : pas de retéléchargement (déterministe, réseau économe).
      nextWorks.push(prev);
      report.unchanged += 1;
      log(`  = ${work.title} (inchangé, ${prev.parts || "?"} parties)`);
      continue;
    }

    if (dryRun) {
      nextWorks.push({ title: work.title, url: work.url, slug, status: "planned" });
      report.staged += 1;
      log(`  + ${work.title} (à préparer)`);
      continue;
    }

    try {
      const rawText = await fetchText(work.url);
      const text = cutGutenberg(rawText);
      if (text.length < 2000) throw new Error(`texte trop court (${text.length} o)`);
      const parts = splitIntoParts(text);

      mkdirSync(partsDir, { recursive: true });
      writeFileSync(txtPath, text + "\n", "utf8");
      const files = [];
      parts.forEach((part, i) => {
        const file = join(partsDir, `part-${String(i + 1).padStart(2, "0")}.md`);
        const head = `# ${work.title} — Partie ${i + 1}/${parts.length}` + (part.title ? ` — ${part.title}` : "");
        writeFileSync(file, `${head}\n\n${part.text}\n`, "utf8");
        files.push(file);
      });

      nextWorks.push({
        title: work.title,
        url: work.url,
        slug,
        hash: sha256(text),
        chars: text.length,
        parts: parts.length,
        files: files.length,
        raw: txtPath,
        status: "staged",
        updatedAt: nowIso(),
      });
      report.staged += 1;
      log(`  + ${work.title} → ${parts.length} parties (${text.length} o)`);
    } catch (e) {
      if (prev && prev.hash) { nextWorks.push(prev); } // jamais de trou : on garde l'état précédent
      else nextWorks.push({ title: work.title, url: work.url, slug, status: "failed", error: String(e.message || e) });
      report.failed += 1;
      log(`  ! ${work.title} : ${e.message || e}`);
    }
  }

  entry.works = nextWorks;
  entry.kb = `salon-${authorId}`;
  entry.updatedAt = nowIso();
  if (!dryRun) saveKbMap(map);
  return report;
}

async function main() {
  const args = parseArgs();
  const root = args.root ? String(args.root) : kbRoot();
  const catalog = loadCatalog();
  const targets = args.all
    ? catalog.authors.map((a) => a.id)
    : [String(args.author || "voltaire")];

  const release = args["dry-run"] ? () => {} : acquireLock(join(root, ".salon-openkb-ingest.lock"));
  try {
    console.log(`→ Ingest Salon × OpenKB  (base : ${root}${args["dry-run"] ? "  [dry-run]" : ""})`);
    let total = { staged: 0, unchanged: 0, failed: 0 };
    for (const id of targets) {
      console.log(`· ${id}`);
      const r = await ingestAuthor(id, { root, catalog, dryRun: Boolean(args["dry-run"]), force: Boolean(args.force) });
      total.staged += r.staged; total.unchanged += r.unchanged; total.failed += r.failed;
    }
    console.log(`\nRésumé : ${total.staged} préparée(s), ${total.unchanged} inchangée(s), ${total.failed} en échec.`);
    if (total.failed) process.exitCode = 1;
  } finally {
    release();
  }
}

if (process.argv[1] && process.argv[1].endsWith("openkb_ingest.mjs")) {
  main().catch((e) => { console.error(`ERREUR: ${e.message}`); process.exit(1); });
}
