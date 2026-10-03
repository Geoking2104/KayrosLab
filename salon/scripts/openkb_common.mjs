#!/usr/bin/env node
/**
 * openkb_common.mjs — helpers partagés du pipeline OpenKB du Salon.
 *
 * Référence : docs/SALON-OPENKB.md (§5 Ingest, §10 Build & sync).
 * Zéro dépendance npm ; mêmes principes que salon/scripts/harvest_corpus.mjs
 * (déterministe, « jamais de trou »).
 */
import { createHash } from "node:crypto";
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync,
  statSync, unlinkSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "..", "..");
export const MIRROR_DIR = join(REPO, "backend", "web", "public", "salon");
export const CATALOG_FILE = join(REPO, "salon", "src", "lib", "salon", "catalog.json");
export const KBMAP_FILE = join(REPO, "salon", "kb-map.json");
export const REPORTS_DIR = join(REPO, "salon", "scripts", "reports");

/* ------------------------------------------------------------------ utils */

export function readJSON(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; }
}

export function writeJSON(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
}

export function sha256(text) { return createHash("sha256").update(String(text)).digest("hex"); }

export function stableChecksum(value) {
  return "sha256:" + sha256(JSON.stringify(value));
}

export function nowIso() { return new Date().toISOString(); }

export function todayIso() { return new Date().toISOString().slice(0, 10); }

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 2) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { out[key] = next; i += 1; } else { out[key] = true; }
  }
  return out;
}

export function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "sans-titre";
}

/* ------------------------------------------------------- catalog & kb-map */

export function loadCatalog() {
  const cat = readJSON(CATALOG_FILE);
  if (!cat || !Array.isArray(cat.authors)) throw new Error(`catalog illisible: ${CATALOG_FILE}`);
  return cat;
}

export function loadKbMap() {
  return readJSON(KBMAP_FILE, { version: 1, updatedAt: null, authors: {} });
}

export function saveKbMap(map) {
  map.updatedAt = nowIso();
  writeJSON(KBMAP_FILE, map);
}

/* -------------------------------------------------------------- locations */

export function kbRoot() {
  return process.env.SALON_KB_ROOT || process.env.OPENKB_KB_ROOT
    || join(homedir(), ".config", "openkb", "kbs");
}

export function kbId(authorId) { return `salon-${authorId}`; }

export function kbDir(authorId, root = kbRoot()) { return join(root, "salon", authorId); }

export function kbRawDir(authorId, root = kbRoot()) { return join(kbDir(authorId, root), "raw"); }

/* ----------------------------------------------------- sentence utilities */

export const NOISE = /project gutenberg|gutenberg\.org|ebook|produced by|transcriber|pg[a-z]*\.txt|copyright|table of contents|advertisement|isbn|printers?|publishers?|\bpress\b|london:|edinburgh|oxford:|mdccc|mdcc|chapter\s+[ivxl]+|^book\b|^volume\b|^contents\b|preface|introduction|translator|editor\b|the author of the following|bibliograph|dictionary of|assistant in the|catalogue|appendix|\bsays that\b|\bwas born\b|\bflourished\b|\bdied in\b|\bthe life of\b|biograph|\bhis life\b|\bher life\b/i;

export function isNoise(s) {
  const letters = String(s || "").replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letters.length) {
    const caps = (letters.match(/[A-ZÀ-Þ]/g) || []).length;
    if (caps / letters.length > 0.5) return true;
  }
  if (!/[a-zà-ÿ]{3}/.test(s)) return true;
  return NOISE.test(s);
}

/** Découpe en phrases (même logique que salon-engine.js / reflect.ts). */
export function sentencesOf(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const parts = clean.split(/(?<=[.!?…])\s+(?=["«“„]?[A-ZÀ-ÖØ-Þ])/u);
  return parts
    .map((s) => s.replace(/^["«“„]\s*/, "").replace(/\s*["»”]\s*$/, "").trim())
    .filter((s) => s.length >= 24);
}

/** Phrase entière citable : bornes propres, pas de résidu OCR/éditeur. */
export function usableSentence(s) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length < 40 || t.length > 320) return false;
  if (!/[.!?…»"]$/.test(t)) return false;
  if (!/^[A-ZÀ-ÖØ-Þ«"“„¿¡0-9(\[]/.test(t)) return false;
  if (/\uFFFD/.test(t)) return false;
  if (isNoise(t)) return false;
  return true;
}

/** Retire l'en-tête/pied Project Gutenberg sans rogner le corps du texte. */
export function cutGutenberg(text) {
  let s = String(text || "").replace(/\r/g, "");
  const start = s.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG/i);
  if (start >= 0) {
    const nl = s.indexOf("\n", start);
    s = nl >= 0 ? s.slice(nl + 1) : s.slice(start + 200);
  }
  const end = s.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i);
  if (end >= 0) s = s.slice(0, end);
  return s.trim();
}

/**
 * Découpe un livre en parties équilibrées (titres de chapitres quand c'est
 * possible, sinon paragraphes). Déterministe : deux exécutions identiques.
 * @returns {{title:string|null, text:string}[]}
 */
export function splitIntoParts(text, { target = 42000, maxParts = 12 } = {}) {
  const src = String(text || "");
  const chapterRe = /(?:^|\n)\s{0,4}(?:CHAPTER|Chapter|CHAPITRE|Chapitre|BOOK|Book|LIVRE|Livre|PART|Partie|SECTION|Section)\s?[A-Z0-9IVXLC][^\n]{0,70}\n/g;
  const marks = [...src.matchAll(chapterRe)].map((m) => m.index).filter((i) => i > 0);
  let segments = [];
  if (marks.length >= 3) {
    for (let i = 0; i < marks.length; i += 1) {
      const from = marks[i];
      const to = i + 1 < marks.length ? marks[i + 1] : src.length;
      const seg = src.slice(from, to).trim();
      if (seg.length >= 400) segments.push(seg);
    }
  }
  if (segments.length < 3) {
    const paras = src.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
    segments = [];
    let buf = [];
    let size = 0;
    for (const p of paras) {
      buf.push(p); size += p.length;
      if (size >= target) { segments.push(buf.join("\n\n")); buf = []; size = 0; }
    }
    if (buf.length) segments.push(buf.join("\n\n"));
  }
  // Fusionne gloutonnement jusqu'à <= maxParts, sans jamais dépasser ~64k/part.
  while (segments.length > maxParts) {
    let bestAt = 0; let bestLen = Infinity;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const merged = segments[i].length + segments[i + 1].length;
      if (merged < bestLen) { bestLen = merged; bestAt = i; }
    }
    const merged = [{ title: null, text: segments[bestAt] + "\n\n" + segments[bestAt + 1] }];
    segments = segments.slice(0, bestAt).concat(merged, segments.slice(bestAt + 2));
  }
  return segments.map((seg) => {
    const m = seg.match(/^\s*((?:CHAPTER|Chapter|CHAPITRE|Chapitre|BOOK|Book|LIVRE|Livre|PART|Partie|SECTION|Section)[^\n]{0,70})/);
    return { title: m ? m[1].trim() : null, text: seg.trim() };
  }).filter((s) => s.text.length > 200);
}

/* ----------------------------------------------------------------- locks */

export function acquireLock(file, { staleMs = 30 * 60 * 1000 } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  try {
    const fd = openSync(file, "wx");
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, at: nowIso() })); } finally { closeSync(fd); }
  } catch (e) {
    try {
      const st = statSync(file);
      if (Date.now() - st.mtimeMs > staleMs) { unlinkSync(file); return acquireLock(file, { staleMs }); }
    } catch { /* ignore */ }
    throw new Error(`verrou actif : ${file} (un autre processus travaille — supprimer le fichier s'il est périmé)`);
  }
  return () => { try { unlinkSync(file); } catch { /* ignore */ } };
}

/* ------------------------------------------------------ OpenKB REST client */

export function openkbBase() { return process.env.OPENKB_URL || "http://127.0.0.1:7566"; }

export async function openkbFetch(path, {
  method = "GET", body, timeoutMs = 120000,
  baseUrl = openkbBase(), token = process.env.OPENKB_API_TOKEN || "",
} = {}) {
  const url = baseUrl.replace(/\/$/, "") + path;
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch(url, { method, headers, body: payload, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* texte brut */ }
  return { ok: res.ok, status: res.status, json, text };
}

export async function openkbPing({ baseUrl = openkbBase(), token = process.env.OPENKB_API_TOKEN || "", timeoutMs = 2500 } = {}) {
  try {
    const res = await openkbFetch("/api/v1/kbs", { baseUrl, token, timeoutMs });
    return res.ok;
  } catch { return false; }
}

/* ----------------------------------------------------------------- misc */

export function formatBytes(n) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export function readIfExists(file) {
  try { return existsSync(file) ? readFileSync(file, "utf8") : null; } catch { return null; }
}
