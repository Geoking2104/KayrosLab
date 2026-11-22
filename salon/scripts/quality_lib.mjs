#!/usr/bin/env node
/**
 * quality_lib.mjs — règles de qualité de parole, côté scripts (zéro dépendance).
 *
 * Miroir de salon/src/lib/salon/verify.ts : mêmes tolérances, mêmes contrôles,
 * pour que le portail de publication teste exactement ce que le moteur applique.
 */

export const STOP = new Set([
  'dans', 'cette', 'avec', 'pour', 'plus', 'tout', 'tous', 'leur', 'leurs',
  'comme', 'mais', 'donc', 'alors', 'ainsi', 'sans', 'sous', 'entre',
  'apres', 'avant', 'encore', 'aussi', 'bien', 'tres', 'fait', 'faire',
  'etre', 'avoir', 'cela', 'ceux', 'celles', 'nous', 'vous', 'elle', 'elles',
  'that', 'this', 'with', 'from', 'have', 'been', 'were', 'which',
  'their', 'there', 'about', 'would', 'could', 'should', 'the', 'and',
]);

export function canonical(text) {
  return String(text || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')
    .replace(/[\u2013\u2014\u2010\u2011]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function verifyQuote(quote, sources) {
  const needle = canonical(quote);
  if (needle.length < 20) return { ok: false };
  for (const src of sources) if (canonical(src).includes(needle)) return { ok: true, source: src };
  return { ok: false };
}

export function wordCount(text) {
  return (String(text || '').match(/[\p{L}\p{N}'’-]+/gu) || []).length;
}

export function contentWords(text) {
  return (String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z][a-z'-]+/g) || [])
    .map((w) => w.replace(/['-]/g, ''))
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

export function splitSentences(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  return clean
    .split(/(?<=[.!?…])\s+(?=["«“„]?[A-ZÀ-ÖØ-Þ0-9])/u)
    .map((s) => s.replace(/^["«“„\][\s]+/, '').replace(/\s*["»”]\s*$/, '').trim())
    .filter((s) => s.length >= 24 && s.length <= 340 && /[.!?…»"]$/.test(s));
}

export function deathYear(author) {
  const era = String(author.era || author.eraEn || '');
  const years = [...era.matchAll(/\b(1[0-9]{3}|20[0-9]{2})\b/g)].map((m) => Number(m[1]));
  return years.length ? Math.max(...years) : null;
}

export function knownWork(quote, author) {
  const q = canonical(quote);
  if (!q) return false;
  return (author.works || []).map((w) => canonical(w.title)).filter(Boolean)
    .some((t) => t === q || t.includes(q) || q.includes(t.split(':')[0]));
}

/** Contrôle mécanique du contrat de parole (miroir de verify.ts). */
export function checkTurn({ text, author, toName, sources = [], passages = [], minWords = 40 }) {
  const errors = [];
  const warnings = [];
  const citations = [];
  const body = String(text || '').trim();
  const words = wordCount(body);

  if (!body) errors.push('réplique vide');
  if (words < minWords) errors.push(`réplique trop courte (${words} mots < ${minWords})`);
  if (words > 220) errors.push(`réplique trop longue (${words} mots > 220)`);
  if (!/^[A-ZÀ-ÖØ-Þ«"“„0-9(\[]/.test(body)) errors.push('début au milieu d’une phrase');
  if (!/[.!?…»"]$/.test(body)) errors.push('phrase non close');
  if (/(^|\n)\s*([-*•]|\d+[.)])\s+/.test(body)) errors.push('liste interdite');
  if (!/\b(je|j['’]|me|moi|nous)\b/i.test(body) && !/\b(I|me|my|we)\b/.test(body)) {
    errors.push('première personne absente');
  }

  const name = String(toName || '').trim();
  if (name && !/^(l['’]hôte|la table|hôte|table)$/i.test(name)) {
    const token = name.split(/[\s'’-]+/).filter((x) => x.length >= 3)[0];
    if (token && !canonical(body).includes(canonical(token))) errors.push(`destinataire « ${name} » non nommé`);
  }

  const allSources = [...sources, ...passages.map((p) => p.text)];
  for (const m of body.matchAll(/[«"“]([^«»"“”]{20,400})[»"”]/g)) {
    const q = m[1].trim();
    if (knownWork(q, author)) continue;
    const v = verifyQuote(q, allSources);
    citations.push({ text: q, verified: v.ok });
    if (!v.ok) errors.push(`citation non vérifiée : « ${q.slice(0, 60)}… »`);
  }

  const death = deathYear(author);
  if (death) {
    for (const m of body.matchAll(/\b(1[5-9][0-9]{2}|20[0-9]{2})\b/g)) {
      if (Number(m[1]) > death + 2) errors.push(`anachronisme : ${m[1]} > ${death}`);
    }
  }

  if (!citations.length) warnings.push('aucune citation vérifiable (aveu ou argument)');
  return { ok: errors.length === 0, errors, warnings, citations, words };
}

/* ---------------------------------------------------------- voix */

export function voiceVector(sentences) {
  const n = Math.max(sentences.length, 1);
  const joined = sentences.join(' ');
  const words = joined.split(/\s+/).filter(Boolean);
  const count = (re) => (joined.match(re) || []).length / n;
  const terms = [...new Set(contentWords(joined))].slice(0, 200);
  return {
    n,
    avgLen: words.length / n,
    comma: count(/,/g),
    semi: count(/;/g),
    quest: count(/\?/g),
    excl: count(/!/g),
    terms,
  };
}

export function voiceDistance(a, b) {
  const nums = ['avgLen', 'comma', 'semi', 'quest', 'excl'];
  const scale = { avgLen: 30, comma: 3, semi: 1.5, quest: 0.5, excl: 0.5 };
  let sum = 0;
  for (const k of nums) {
    const d = (Number(a[k]) - Number(b[k])) / scale[k];
    sum += d * d;
  }
  const sa = new Set(a.terms);
  const sb = new Set(b.terms);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const jaccard = 1 - (inter / Math.max(sa.size + sb.size - inter, 1));
  return Math.sqrt(sum / nums.length) * 0.7 + jaccard * 0.3;
}

/* -------------------------------------------------- composeur déterministe */

/** Compose un tour conforme au contrat, sans LLM (repli et test de structure). */
export function composeTurn({ author, question, sentences, act = 'reponse', toName = "l’hôte", method = 'rhetorique' }) {
  const query = String(question || '');
  const pool = sentences.filter((s) => !/[«»"“”]/.test(s.s));
  const candidates = pool.length ? pool : sentences;
  let best = null;
  let bestScore = -1;
  for (const s of candidates) {
    const words = new Set(contentWords(query));
    let hit = 0;
    for (const w of contentWords(s.s)) if (words.has(w)) hit += 1;
    const score = hit / Math.sqrt(Math.max(words.size, 1) * Math.max(contentWords(s.s).length, 8));
    if (score > bestScore) { bestScore = score; best = s; }
  }
  const pick = best || candidates[0];
  const work = pick ? pick.w : (author.works && author.works[0] ? author.works[0].title : 'mes œuvres');
  const quote = pick ? pick.s : '';
  const prise = act === 'objection'
    ? "J’accorde un point, puis je distingue."
    : 'Sur cette question, je réponds depuis mes livres, non depuis une politesse.';
  const who = toName ? toName.charAt(0).toUpperCase() + toName.slice(1) : 'L’hôte';
  let text;
  if (method === 'elenchus') {
    text = `${who}, tu soutiens donc cela ; je ne sais pas encore si tu peux le signer jusqu’au bout. Dans « ${work} », on lit : « ${quote} » Est-ce encore cela, si l’on tient ta définition jusqu’à sa conséquence ? Réponds-moi précisément : qu’est-ce que cela change pour la question qui nous occupe ?`;
  } else if (act === 'objection') {
    text = `${who}, je te l’accorde en partie. Pourtant la question demeure, et « ${work} » la déplace : « ${quote} » Ce n’est pas ta personne que je presse, c’est ce que cette phrase ne peut plus soutenir. Ainsi la difficulté n’est pas dans les mots, mais dans ce que ta thèse engage.`;
  } else {
    text = `${who}, voici ce que je peux signer. Dans « ${work} » : « ${quote} » Cela répond à ce que tu viens de poser, et cela suffit pour aujourd’hui : la suite est à qui voudra objecter. Je m’en tiens là, sans ajouter de maxime inutile. La question reste ouverte, et je la rends à la table.`;
  }
  return { prise, text, work, quote, score: bestScore };
}

/** Questions du jeu d'or, dérivées de la doctrine puis génériques. */
export function goldenQuestions(author, doctrine) {
  const out = [];
  const entry = doctrine && doctrine[author.id];
  if (entry && entry.theses) {
    for (const [domain, demands] of Object.entries(entry.theses)) {
      const t = Object.values(demands || {})[0];
      const fr = t && (t.fr || t.en);
      if (fr) out.push({ question: `${domain} : ${fr} ?`, domain, source: 'doctrine' });
      if (out.length >= 2) break;
    }
  }
  out.push({ question: 'Qu’est-ce qui donne du prix à une vie humaine ?', domain: 'valeur', source: 'generique' });
  out.push({ question: 'Faut-il préférer la vérité qui blesse à l’illusion qui console ?', domain: 'verite', source: 'generique' });
  return out;
}
