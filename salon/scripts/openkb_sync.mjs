#!/usr/bin/env node
/**
 * openkb_sync.mjs — synchronise les bases OpenKB du Salon (REST), puis laisse
 * kb_export.mjs publier les packs statiques.
 *
 * Étapes par auteur : init (idempotent) → add des œuvres modifiées (multipart,
 * idempotent par hash de contenu) → recompile optionnel → kb-map mise à jour.
 *
 * Dégrade proprement : si OpenKB est injoignable, les fichiers restent préparés
 * (openkb_ingest) et la commande se termine sans casser le Salon.
 *
 * Usage :
 *   node salon/scripts/openkb_sync.mjs --all
 *   node salon/scripts/openkb_sync.mjs --author voltaire --recompile
 *   node salon/scripts/openkb_sync.mjs --all --files-only
 *   node salon/scripts/openkb_sync.mjs --all --dry-run --strict
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  acquireLock, kbId, kbRawDir, kbRoot, loadCatalog, loadKbMap, nowIso,
  openkbFetch, openkbPing, parseArgs, saveKbMap,
} from "./openkb_common.mjs";
import { ingestAuthor } from "./openkb_ingest.mjs";

const ADD_TIMEOUT_MS = 30 * 60 * 1000;
const RECOMPILE_TIMEOUT_MS = 60 * 60 * 1000;

function partFiles(authorId, work, root) {
  const dir = join(kbRawDir(authorId, root), work.slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => join(dir, f));
}

export async function syncAuthor(authorId, {
  root = kbRoot(), map = loadKbMap(), dryRun = false, filesOnly = false,
  recompile = false, refreshSchema = false, log = console.log,
} = {}) {
  const entry = map.authors[authorId] || (map.authors[authorId] = { kb: kbId(authorId), works: [] });
  const report = { authorId, created: false, added: 0, skipped: 0, failed: 0, unchanged: 0, recompiled: false, degraded: false };

  // 1. Matière préparée ?
  const rawDir = kbRawDir(authorId, root);
  const hasRaw = existsSync(rawDir) && readdirSync(rawDir).some((f) => f.endsWith(".txt"));
  if (!hasRaw && !dryRun) {
    log(`  · matière absente — préparation (ingest)…`);
    await ingestAuthor(authorId, { root, map, log });
  }
  if (filesOnly) { report.unchanged = (entry.works || []).length; return report; }

  // 2. Serveur OpenKB joignable ?
  const up = await openkbPing();
  if (!up) {
    report.degraded = true;
    log(`  ! OpenKB injoignable (${process.env.OPENKB_URL || "http://127.0.0.1:7566"}) — fichiers préparés seulement.`);
    return report;
  }

  // 3. init (idempotent) — une base neuve force la ré-indexation des œuvres.
  if (dryRun) { log(`  + init ${kbId(authorId)} (dry-run)`); }
  else {
    const init = await openkbFetch("/api/v1/init", { method: "POST", body: { kb: kbId(authorId) } });
    if (!init.ok) throw new Error(`init ${kbId(authorId)} → ${init.status} ${init.text.slice(0, 160)}`);
    report.created = Boolean(init.json && init.json.created);
    if (report.created) log(`  + base créée : ${kbId(authorId)}`);
    if (report.created) for (const w of entry.works || []) w.status = "staged";
  }

  // 4. add des œuvres non indexées (ou toutes, si base neuve).
  for (const work of entry.works || []) {
    if (work.status === "added" && !report.created) { report.skipped += 1; continue; }
    if (work.status === "failed") { report.failed += 1; continue; }
    const files = partFiles(authorId, work, root);
    if (!files.length) { report.failed += 1; work.status = "failed"; work.error = "aucune partie préparée"; continue; }
    if (dryRun) { log(`  + add ${work.title} (${files.length} parties, dry-run)`); report.added += 1; continue; }
    try {
      const fd = new FormData();
      fd.append("kb", kbId(authorId));
      fd.append("stream", "false");
      for (const f of files) {
        fd.append("files", new Blob([readFileSync(f)], { type: "text/markdown" }), basename(f));
      }
      const res = await openkbFetch("/api/v1/add", { method: "POST", body: fd, timeoutMs: ADD_TIMEOUT_MS });
      if (!res.ok) throw new Error(`add ${res.status} ${res.text.slice(0, 160)}`);
      const j = res.json || {};
      if (j.failed_count > 0) { work.status = "failed"; report.failed += 1; log(`  ! ${work.title} : ${j.failed_count} fichier(s) en échec`); }
      else if (j.added_count > 0) { work.status = "added"; report.added += 1; log(`  + ${work.title} : compilé (${j.added_count} doc.)`); }
      else { work.status = "added"; report.skipped += 1; log(`  = ${work.title} : déjà indexé`); }
      work.indexedAt = nowIso();
    } catch (e) {
      work.status = "failed"; work.error = String(e.message || e);
      report.failed += 1;
      log(`  ! ${work.title} : ${e.message || e}`);
    }
  }

  // 5. recompile (toute la base) si demandé — les compilations s'écrasent, c'est voulu.
  if (recompile && !dryRun) {
    const res = await openkbFetch("/api/v1/recompile", {
      method: "POST",
      body: { kb: kbId(authorId), all_docs: true, refresh_schema: Boolean(refreshSchema) },
      timeoutMs: RECOMPILE_TIMEOUT_MS,
    });
    if (!res.ok) throw new Error(`recompile ${res.status} ${res.text.slice(0, 160)}`);
    report.recompiled = true;
    log(`  ↻ ${authorId} : wiki recompilé (${(res.json && res.json.recompiled) ?? "?"} doc.)`);
  }

  // 6. version : bump seulement si la base a réellement changé.
  if (!dryRun && (report.created || report.added > 0 || report.recompiled)) {
    entry.kbVersion = `${authorId}@${nowIso()}`;
  }
  entry.updatedAt = nowIso();
  return report;
}

async function main() {
  const args = parseArgs();
  const root = args.root ? String(args.root) : kbRoot();
  const catalog = loadCatalog();
  const map = loadKbMap();
  const targets = args.author ? [String(args.author)]
    : (Object.keys(map.authors).length ? Object.keys(map.authors) : catalog.authors.map((a) => a.id));

  const release = args["dry-run"] ? () => {} : acquireLock(join(root, ".salon-openkb-sync.lock"));
  try {
    console.log(`→ Sync Salon × OpenKB  (base : ${root}${args["dry-run"] ? "  [dry-run]" : ""})`);
    const totals = { created: 0, added: 0, skipped: 0, failed: 0, degraded: 0, recompiled: 0 };
    for (const id of targets) {
      console.log(`· ${id}`);
      const r = await syncAuthor(id, {
        root, map,
        dryRun: Boolean(args["dry-run"]),
        filesOnly: Boolean(args["files-only"]),
        recompile: Boolean(args.recompile),
        refreshSchema: Boolean(args["refresh-schema"]),
      });
      totals.added += r.added || 0;
      totals.skipped += r.skipped || 0;
      totals.failed += r.failed || 0;
      totals.created += r.created ? 1 : 0;
      totals.degraded += r.degraded ? 1 : 0;
      totals.recompiled += r.recompiled ? 1 : 0;
    }
    if (!args["dry-run"]) saveKbMap(map);
    console.log(`\nRésumé : ${totals.added} œuvre(s) compilée(s), ${totals.skipped} déjà indexée(s), ${totals.failed} en échec, ${totals.degraded} base(s) hors-ligne.`);
    console.log(`Prochaine étape : node salon/scripts/kb_export.mjs  (packs statiques)`);
    if (totals.failed) process.exitCode = 1;
    if (args.strict && totals.degraded) process.exitCode = 3;
  } finally {
    release();
  }
}

if (process.argv[1] && process.argv[1].endsWith("openkb_sync.mjs")) {
  main().catch((e) => { console.error(`ERREUR: ${e.message}`); process.exit(1); });
}
