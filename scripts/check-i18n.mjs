#!/usr/bin/env node
/**
 * KayrosLab i18n checker for kayroslab-complete-with-ai-agents.html
 *
 * Usage:
 *   node scripts/check-i18n.mjs [path-or-url]
 *   node scripts/check-i18n.mjs ./kayroslab-complete-with-ai-agents.html
 *   node scripts/check-i18n.mjs https://www.kayroslab.com/kayroslab-complete-with-ai-agents.html
 *
 * Exit codes:
 *   0 = OK
 *   1 = missing keys / empty values
 *   2 = parse / IO error
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_URL =
  'https://raw.githubusercontent.com/Geoking2104/KayrosLab/main/kayroslab-complete-with-ai-agents.html';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const target = args[0] || DEFAULT_URL;
const strict = flags.has('--strict');
const jsonOut = flags.has('--json');

async function loadSource(src) {
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${src}`);
    return await res.text();
  }
  return fs.readFileSync(path.resolve(src), 'utf8');
}

function extractObject(html, braceIndex) {
  if (html[braceIndex] !== '{') throw new Error('Expected {');
  let depth = 0;
  let inStr = false;
  let quote = '';
  let escaped = false;
  for (let i = braceIndex; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === quote) inStr = false;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = true; quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return html.slice(braceIndex, i + 1);
    }
  }
  throw new Error('Unbalanced braces while extracting i18n object');
}

function parseI18nObject(objSrc) {
  const map = new Map();
  const body = objSrc.slice(1, -1);
  const re =
    /([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(?:'((?:\\'|[^'])*)'|"((?:\\"|[^"])*)"|`((?:\\`|[^`])*)`)/g;
  let m;
  while ((m = re.exec(body))) {
    const key = m[1];
    const raw = m[2] ?? m[3] ?? m[4] ?? '';
    const value = raw
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\\\/g, '\\');
    map.set(key, value);
  }
  return map;
}

function findLangObject(html, lang) {
  const patterns = [
    new RegExp(`\\b${lang}\\s*:\\s*\\{`),
    new RegExp(`['"]${lang}['"]\\s*:\\s*\\{`),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) {
      const brace = html.indexOf('{', m.index);
      return extractObject(html, brace);
    }
  }
  throw new Error(`Could not find i18n object for language "${lang}"`);
}

function collectUsedKeys(html) {
  const used = new Set();
  for (const m of html.matchAll(
    /data-i18n(?:-html|-placeholder|-aria)?=["']([a-zA-Z0-9_]+)["']/g
  )) used.add(m[1]);
  for (const m of html.matchAll(/\bt\(\s*['"]([a-zA-Z0-9_]+)['"]/g)) used.add(m[1]);
  return used;
}

const IGNORE_USED = new Set([
  'a','div','span','button','input','form',
  'company','consent','firstName','lastName','phone','position','professionalEmail',
  'md','pdf','skip_to_end',
]);

function analyze(html) {
  const fr = parseI18nObject(findLangObject(html, 'fr'));
  const en = parseI18nObject(findLangObject(html, 'en'));
  const used = collectUsedKeys(html);

  const onlyFr = [...fr.keys()].filter((k) => !en.has(k)).sort();
  const onlyEn = [...en.keys()].filter((k) => !fr.has(k)).sort();
  const emptyFr = [...fr.entries()].filter(([, v]) => !String(v).trim()).map(([k]) => k).sort();
  const emptyEn = [...en.entries()].filter(([, v]) => !String(v).trim()).map(([k]) => k).sort();
  const usedMissingFr = [...used].filter((k) => !IGNORE_USED.has(k) && !fr.has(k)).sort();
  const usedMissingEn = [...used].filter((k) => !IGNORE_USED.has(k) && !en.has(k)).sort();
  const identical = [...fr.keys()].filter((k) => en.has(k)).filter((k) => {
    const a = fr.get(k); const b = en.get(k);
    return a && b && a === b && a.length > 12 && /[a-zA-Z\u00C0-\u024F]{4,}/.test(a);
  }).sort();

  return {
    counts: { fr: fr.size, en: en.size, used: used.size },
    onlyFr, onlyEn, emptyFr, emptyEn, usedMissingFr, usedMissingEn, identical,
  };
}

function printReport(report, src) {
  console.log(`i18n check \u00b7 ${src}`);
  console.log(`  keys: FR=${report.counts.fr}  EN=${report.counts.en}  used=${report.counts.used}`);
  const sections = [
    ['ONLY IN FR (missing EN)', report.onlyFr],
    ['ONLY IN EN (missing FR)', report.onlyEn],
    ['EMPTY FR', report.emptyFr],
    ['EMPTY EN', report.emptyEn],
    ['USED but missing FR', report.usedMissingFr],
    ['USED but missing EN', report.usedMissingEn],
  ];
  if (strict) sections.push(['IDENTICAL FR=EN (possible untranslated)', report.identical]);
  let issues = 0;
  for (const [title, list] of sections) {
    if (!list.length) continue;
    issues += list.length;
    console.log(`\n\u2717 ${title} (${list.length})`);
    for (const k of list) console.log(`    - ${k}`);
  }
  if (!issues) console.log('\n\u2713 No missing translation keys.');
  else console.log(`\n\u2717 ${issues} issue(s) found.`);
  return issues;
}

const html = await loadSource(target);
let report;
try { report = analyze(html); }
catch (err) { console.error('Parse error:', err.message); process.exit(2); }

if (jsonOut) console.log(JSON.stringify({ source: target, ...report }, null, 2));
else process.exit(printReport(report, target) ? 1 : 0);
