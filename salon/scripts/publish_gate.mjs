#!/usr/bin/env node
/**
 * publish_gate.mjs — portail de publication du Salon.
 *
 * Rien n'est publié sans passer les tests de qualité de parole :
 *   1. récolte → staging (cache de sources inclus) ;
 *   2. export des packs → staging ;
 *   3. audit de citations (sources locales) ;
 *   4. speech_eval (mémoire, contrat, voix, tours du jeu d'or) ;
 *   5. promotion atomique staging → backend/web/public/salon.
 *
 * En cas d'échec, le miroir publié reste INTACT et un rapport explique pourquoi.
 *
 * Usage :
 *   node salon/scripts/publish_gate.mjs                     # récolte + tests + publication
 *   node salon/scripts/publish_gate.mjs --skip-build        # tests sur les packs existants
 *   node salon/scripts/publish_gate.mjs --works 8 --max 480 --workmax 90
 *   node salon/scripts/publish_gate.mjs --llm               # ajoute les tours modèle réel
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  MIRROR_DIR, REPORTS_DIR, REPO, KBMAP_FILE, nowIso, parseArgs, readJSON, saveKbMap, writeJSON,
} from './openkb_common.mjs';

const args = parseArgs();
const MIRROR = MIRROR_DIR;
const STAGING = resolve(REPO, 'salon', '.staging', 'salon');
const DATE = nowIso().slice(0, 10);
const GATE_REPORT = join(REPORTS_DIR, `publish-gate-${DATE}.json`);
const EVAL_REPORT = join(REPORTS_DIR, `speech-eval-${DATE}.json`);

const num = (k, d) => (args[k] ? String(args[k]) : String(d));

function run(script, extra = []) {
  const file = join(REPO, 'salon', 'scripts', script);
  process.stderr.write(`\n▶ ${script} ${extra.join(' ')}\n`);
  const r = spawnSync(process.execPath, [file, ...extra], { cwd: REPO, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${script} a échoué (code ${r.status})`);
}

function fail(reason, details = []) {
  const report = { at: nowIso(), ok: false, reason, details, mirror: MIRROR };
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeJSON(GATE_REPORT, report);
  console.error(`\n✗ PUBLICATION REFUSÉE — ${reason}`);
  for (const d of details.slice(0, 12)) console.error('  - ' + d);
  console.error(`  rapport : ${GATE_REPORT}`);
  process.exit(1);
}

try {
  if (!args['skip-build']) {
    rmSync(STAGING, { recursive: true, force: true });
  }
  mkdirSync(STAGING, { recursive: true });

  // Amorçage : conserve la mémoire publiée pour les auteurs dont la récolte échoue.
  const previousCorpus = join(MIRROR, 'corpus.json');
  if (!args['skip-build'] && existsSync(previousCorpus)) cpSync(previousCorpus, join(STAGING, 'corpus.json'));

  if (!args['skip-build']) {
    run('harvest_corpus.mjs', [
      '--out', STAGING,
      '--works', num('works', 6),
      '--max', num('max', 360),
      '--workmax', num('workmax', 90),
      '--sleep', num('sleep', 100),
    ]);
  } else if (!existsSync(join(STAGING, 'corpus.json'))) {
    if (existsSync(previousCorpus)) cpSync(previousCorpus, join(STAGING, 'corpus.json'));
    else fail('aucun corpus à tester (staging vide)');
  }

  run('kb_export.mjs', ['--from-corpus', '--out', STAGING, '--no-map']);

  // Audit de citations : sources du cache local (salon/.cache/sources).
  try {
    run('kb_quote_audit.mjs', ['--all', '--mirror', STAGING]);
  } catch (e) {
    fail('audit de citations en échec', [String(e.message || e)]);
  }

  const evalArgs = [
    '--mirror', STAGING,
    '--min-sentences', num('min-sentences', 120),
    '--min-coverage', num('min-coverage', 0.95),
    '--min-turn-pass', num('min-turn-pass', 0.98),
    '--min-doctrine', num('min-doctrine', 0.8),
    '--min-voice-distance', num('min-voice-distance', 0.12),
    '--golden-per-author', num('golden-per-author', 2),
  ];
  if (args.llm) evalArgs.push('--llm');

  try {
    run('speech_eval.mjs', evalArgs);
  } catch (e) {
    fail('tests de qualité de parole en échec', [String(e.message || e)]);
  }

  const evalReport = readJSON(EVAL_REPORT);
  if (!evalReport || (evalReport.failures && evalReport.failures.length)) {
    fail('tests de qualité de parole non conformes', (evalReport && evalReport.failures) || []);
  }

  // Promotion atomique : le miroir ne reçoit que des artefacts validés.
  cpSync(STAGING, MIRROR, { recursive: true, force: true });
  const manifest = readJSON(join(MIRROR, 'kb-manifest.json'), { authors: {}, totals: {} });
  manifest.published = true;
  manifest.publishedAt = nowIso();
  manifest.gate = {
    at: nowIso(),
    report: GATE_REPORT,
    thresholds: evalReport.thresholds,
    totals: evalReport.totals,
    turnPass: evalReport.turnPass,
    llm: evalReport.llm,
  };
  writeJSON(join(MIRROR, 'kb-manifest.json'), manifest);

  // Projection SPA (corpus navigateur) depuis les packs publiés.
  run('kb_export.mjs', ['--spa-only']);

  // Registre dérivé : kb-map reflète ce qui est publié.
  const map = readJSON(KBMAP_FILE, { version: 1, updatedAt: null, authors: {} });
  for (const [id, info] of Object.entries(manifest.authors || {})) {
    const m = map.authors[id] || (map.authors[id] = { kb: `salon-${id}`, works: [] });
    m.pack = { path: info.pack, builtAt: info.builtAt, sentences: info.sentences, formulas: info.formulas, checksum: info.checksum };
    m.kbVersion = info.kbVersion;
  }
  saveKbMap(map);

  const summary = {
    at: nowIso(),
    ok: true,
    mirror: MIRROR,
    authors: evalReport.totals.authors,
    works: evalReport.totals.works,
    sentences: evalReport.totals.sentences,
    medianSentences: evalReport.totals.medianSentences,
    coverage: evalReport.totals.coverage,
    turnPass: evalReport.turnPass,
    meanVoiceDistance: evalReport.totals.meanVoiceDistance,
    report: GATE_REPORT,
    eval: EVAL_REPORT,
  };
  writeJSON(GATE_REPORT, summary);
  console.log(`\n✓ PUBLIÉ — ${summary.authors} auteurs · ${summary.works} œuvres · ${summary.sentences} phrases (médiane ${summary.medianSentences}/auteur)`);
  console.log(`  couverture ${(summary.coverage * 100).toFixed(1)}% · tours ${(summary.turnPass * 100).toFixed(1)}% · voix ${summary.meanVoiceDistance}`);
  console.log(`  rapport : ${GATE_REPORT}`);
} catch (e) {
  fail(String(e.message || e));
}
