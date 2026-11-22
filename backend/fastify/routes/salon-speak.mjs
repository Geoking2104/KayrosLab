/**
 * routes/salon-speak.mjs — parole publique du Salon (VPS).
 *
 * POST /v1/salon/speak
 *   { authorId, question, history?: [{name,text,prise}], act?: 'reponse'|'objection' }
 *
 * Le route lit les packs publiés (`backend/web/public/salon/kb/<auteur>.json`),
 * construit le persona (doctrine + profil de voix), appelle le proxy LLM
 * gouverné (`app.kayrosContext.llm`) et vérifie chaque citation. Sans clé LLM,
 * le fournisseur `mock` renvoie `[mock]` : la route bascule alors sur le
 * composeur déterministe, étiqueté.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIRROR = fileURLToPath(new URL('../../web/public/salon/', import.meta.url));

const STOP = new Set([
  'dans', 'cette', 'avec', 'pour', 'plus', 'tout', 'tous', 'leur', 'leurs',
  'comme', 'mais', 'donc', 'alors', 'ainsi', 'sans', 'sous', 'entre',
  'apres', 'avant', 'encore', 'aussi', 'bien', 'tres', 'fait', 'faire',
  'etre', 'avoir', 'cela', 'ceux', 'celles', 'nous', 'vous', 'elle', 'elles',
  'that', 'this', 'with', 'from', 'have', 'been', 'were', 'which',
  'their', 'there', 'about', 'would', 'could', 'should', 'the', 'and',
]);

function json(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

function canonical(text) {
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

function words(text) {
  return (String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z][a-z'-]+/g) || [])
    .map((w) => w.replace(/['-]/g, ''))
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

function relevance(query, text) {
  const q = new Set(words(query));
  if (!q.size) return 0;
  const w = words(text);
  if (!w.length) return 0;
  let hit = 0;
  for (const x of w) if (q.has(x)) hit += 1;
  return hit / Math.sqrt(q.size * Math.max(w.length, 8));
}

function splitSentences(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  return clean.split(/(?<=[.!?…])\s+(?=["«“„]?[A-ZÀ-ÖØ-Þ0-9])/u)
    .map((s) => s.replace(/^["«“„\][\s]+/, '').replace(/\s*["»”]\s*$/, '').trim())
    .filter((s) => s.length >= 40 && s.length <= 320 && /[.!?…»"]$/.test(s));
}

/** Phrase du passage qui répond le mieux à la requête. */
function bestSentence(query, text) {
  const list = splitSentences(text);
  if (!list.length) return String(text || '').trim().slice(0, 320);
  let best = list[0];
  let bestScore = -1;
  for (const s of list) {
    const score = relevance(query, s);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

function topTerms(list, n = 8) {
  const freq = new Map();
  for (const s of list) for (const w of words(s)) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0])).slice(0, n).map(([w]) => w);
}

/* ---------------------------------------------------- expansion conceptuelle */

const CONCEPTS = {
  rire: ['rire', 'ris', 'rires', 'ridicule', 'ridicules', 'comedie', 'comique', 'moquerie', 'railler', 'sourire', 'laughter', 'comedy'],
  vice: ['vice', 'vices', 'defaut', 'defauts', 'corruption', 'moeurs', 'hypocrisie', 'hypocrite', 'passion', 'passions'],
  corriger: ['corriger', 'correction', 'corrige', 'guerir', 'guerison', 'reformer', 'reforme', 'amender', 'amendement'],
  liberte: ['liberte', 'libertes', 'libre', 'autonomie', 'independance', 'freedom', 'liberty'],
  justice: ['justice', 'juste', 'injustice', 'droit', 'droits', 'law', 'right'],
  pouvoir: ['pouvoir', 'pouvoirs', 'gouvernement', 'gouverner', 'souverain', 'autorite', 'power', 'state'],
  verite: ['verite', 'vrai', 'faux', 'erreur', 'science', 'connaissance', 'truth', 'knowledge'],
  bonheur: ['bonheur', 'heureux', 'plaisir', 'joie', 'happiness', 'pleasure'],
  vertu: ['vertu', 'vertus', 'morale', 'bien', 'virtue', 'moral'],
  dieu: ['dieu', 'dieux', 'providence', 'religion', 'foi', 'god', 'faith'],
  nature: ['nature', 'naturel', 'monde', 'cosmos', 'world'],
  amour: ['amour', 'aimer', 'passion', 'desir', 'love', 'desire'],
  mort: ['mort', 'mourir', 'destin', 'fate', 'death'],
  guerre: ['guerre', 'combat', 'armee', 'strategie', 'war', 'strategy'],
  richesse: ['richesse', 'riche', 'argent', 'wealth', 'money', 'capital'],
  travail: ['travail', 'travailler', 'labour', 'work', 'industry'],
  education: ['education', 'instruire', 'instruction', 'apprendre', 'learn'],
  societe: ['societe', 'citoyen', 'peuple', 'society', 'people', 'citizen'],
  temps: ['temps', 'histoire', 'memoire', 'time', 'history'],
  art: ['art', 'beaute', 'poesie', 'style', 'beauty', 'poetry'],
};

function expandTerms(base) {
  const out = new Set(base);
  for (const w of base) {
    for (const [key, list] of Object.entries(CONCEPTS)) {
      if (key === w || list.includes(w)) list.forEach((x) => out.add(x));
    }
  }
  return out;
}

/** Terme principal : le concept de la question, sinon le mot le plus long. */
function principalTerm(base) {
  for (const w of base) {
    for (const [key, list] of Object.entries(CONCEPTS)) {
      if (key === w || list.includes(w)) return key;
    }
  }
  return base.slice().sort((a, b) => b.length - a.length)[0] || '';
}

/** BM25 simplifié + couverture des termes de la question. */
function scoreSentence(sentence, expanded, baseTerms, cache) {
  if (cache.has(sentence)) return cache.get(sentence);
  const st = words(sentence);
  const freq = new Map();
  for (const t of st) freq.set(t, (freq.get(t) || 0) + 1);
  let score = 0;
  let hit = 0;
  for (const t of expanded) {
    if (freq.has(t)) {
      hit += 1;
      score += 1 + Math.log(1 + freq.get(t));
    }
  }
  score = score / Math.sqrt(st.length + 1) + hit * 0.12;
  const covered = baseTerms.filter((t) => freq.has(t)).length;
  const result = { score, coverage: baseTerms.length ? covered / baseTerms.length : 0, covered };
  cache.set(sentence, result);
  return result;
}

function diversify(rows, max = 22, perWork = 4) {
  const count = new Map();
  const out = [];
  for (const r of rows) {
    const n = count.get(r.work) || 0;
    if (n >= perWork) continue;
    count.set(r.work, n + 1);
    out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

/** Rerank par le modèle : la précision après le rappel lexical. */
async function rerankWithModel(llm, question, candidates) {
  if (!llm || typeof llm.complete !== 'function' || candidates.length < 6) return null;
  const list = candidates.map((c, i) => `${i}. [${c.work}] ${c.sentence}`).join('\n').slice(0, 10000);
  try {
    const r = await llm.complete({
      messages: [
        { role: 'system', content: "Tu es un bibliothécaire. Classe les passages par utilité pour répondre à la question. Réponds uniquement par un tableau JSON d'indices (3 maximum), du meilleur au moins bon." },
        { role: 'user', content: `Question : ${question}\n\n${list}` },
      ],
      temperature: 0,
      role: 'salon-rerank',
    }, {});
    const raw = String((r && r.text) || '').trim();
    if (!raw || /^\[mock\]/i.test(raw)) return null;
    let arr = null;
    const bracket = raw.match(/\[[\d,\s]+\]/);
    if (bracket) {
      try { arr = JSON.parse(bracket[0]); } catch { arr = null; }
    }
    if (!Array.isArray(arr)) {
      arr = [...raw.matchAll(/\b(\d{1,2})\b/g)].map((m) => Number(m[1]));
    }
    const out = arr
      .filter((i) => Number.isInteger(i) && i >= 0 && i < candidates.length)
      .filter((i, idx, a) => a.indexOf(i) === idx)
      .slice(0, 3)
      .map((i) => candidates[i]);
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/** Aveu du manque : aucune citation, une thèse signée, la question rendue à la table. */
function avowal({ author, doctrine, question, toName = "l’hôte" }) {
  const t = theses(doctrine, author.id, question, 1)[0];
  const thesis = t ? t.text : (author.blurb || 'ma thèse reste à préciser');
  const who = toName ? toName.charAt(0).toUpperCase() + toName.slice(1) : 'L’hôte';
  return {
    prise: 'Sur cette question, mes livres ne fournissent pas de passage décisif.',
    text: `${who}, je ne trouve dans mes œuvres aucune phrase qui réponde vraiment à cette question ; je ne citerai donc pas à faux. Ce que je peux signer, sans citation : ${thesis} C'est peu, mais c'est à moi ; le reste, la table le dira. La question reste ouverte, et je la rends à qui voudra objecter.`,
  };
}

function theses(doctrine, authorId, question, limit = 4) {
  const entry = doctrine && doctrine[authorId];
  if (!entry || !entry.theses) return [];
  const q = new Set(words(question));
  const list = [];
  for (const [domain, demands] of Object.entries(entry.theses)) {
    for (const t of Object.values(demands || {})) {
      if (!t || (!t.fr && !t.en)) continue;
      const text = t.fr || t.en;
      let hit = 0;
      for (const w of q) if (canonical(text).includes(w) || canonical(domain).includes(w)) hit += 1;
      list.push({ domain, text, hit, anchors: t.anchors || [] });
    }
  }
  list.sort((a, b) => (b.hit - a.hit));
  return list.slice(0, limit);
}

function buildPersona({ author, doctrine, question }) {
  const titles = (author.works || []).map((w) => `« ${w.title} »`).join(' ; ');
  const picked = theses(doctrine, author.id, question, 4);
  const samples = (author.samples && author.samples.length ? author.samples : [author.sample]).filter(Boolean).slice(0, 3);
  return [
    `Tu incarnes ${author.name} (${author.era}), ${author.kind}. ${author.blurb}`,
    `Ta connaissance et ta voix viennent exclusivement de tes œuvres du domaine public chargées pour toi.`,
    `Œuvres chargées : ${titles}.`,
    `Règles : n'invente ni citation ni œuvre ; ne cite qu'une phrase entière réellement présente dans les passages fournis ; aucun concept postérieur à ta mort ; une seule œuvre nommée par tour ; si aucun passage ne répond, dis-le et argumente sans citer.`,
    picked.length ? `Thèses que tu peux signer :\n${picked.map((t) => `- [${t.domain}] ${t.text}`).join('\n')}` : '',
    samples.length ? `Exemples de voix (verbatim, ne pas présenter comme citation) :\n${samples.map((s, i) => `${i + 1}. « ${s} »`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

function composeFallback({ author, question, passage, act, toName }) {
  const work = passage ? passage.work : (author.works && author.works[0] ? author.works[0].title : 'mes œuvres');
  const quote = passage ? passage.sentence : '';
  const prise = act === 'objection'
    ? "J’accorde un point, puis je distingue."
    : 'Sur cette question, je réponds depuis mes livres, non depuis une politesse.';
  const who = toName ? toName.charAt(0).toUpperCase() + toName.slice(1) : 'L’hôte';
  const text = act === 'objection'
    ? `${who}, je te l’accorde en partie. Pourtant la question demeure, et « ${work} » la déplace : « ${quote} » Ce n’est pas ta personne que je presse, c’est ce que cette phrase ne peut plus soutenir. Ainsi la difficulté n’est pas dans les mots, mais dans ce que ta thèse engage.`
    : `${who}, voici ce que je peux signer. Dans « ${work} » : « ${quote} » Cela répond à ce que tu viens de poser, et cela suffit pour aujourd’hui : la suite est à qui voudra objecter. Je m’en tiens là, sans ajouter de maxime inutile. La question reste ouverte, et je la rends à la table.`;
  return { prise, text, work, quote };
}

function verifyQuotes(text, author, sources, otherTitles = []) {
  const known = (author.works || []).map((w) => canonical(w.title)).filter(Boolean);
  const citations = [];
  const errors = [];
  const unmatched = [];
  for (const m of String(text || '').matchAll(/[«"“]([^«»"“”]{20,400})[»"”]/g)) {
    const q = m[1].trim();
    const cq = canonical(q);
    if (known.some((t) => t === cq || t.includes(cq) || cq.includes(t.split(':')[0]))) continue;
    const hit = sources.find((s) => quoteMatches(q, s));
    if (hit) citations.push({ text: q, source: hit });
    else { errors.push(`citation non vérifiée : « ${q.slice(0, 60)}… »`); unmatched.push(q); }
  }
  // Une œuvre d'un autre auteur glissée dans la bouche du convive est une
  // hallucination d'attribution : on la refuse, même hors guillemets.
  const body = canonical(text);
  for (const t of otherTitles) {
    if (t.length >= 8 && body.includes(t)) errors.push(`œuvre d'un autre auteur : « ${t} »`);
  }
  return { citations, errors, unmatched };
}

/** Correspondance exacte, préfixe, ou citation elliptique « … » par fragments. */
function quoteMatches(q, source) {
  const cq = canonical(q).replace(/\s*\.\.\.\s*$/, '');
  const cs = canonical(source);
  if (cs.includes(cq)) return true;
  const parts = cq.split(/\s*\.\.\.\s*/).filter((p) => p.length >= 12);
  if (parts.length > 1) {
    let pos = 0;
    for (const part of parts) {
      const at = cs.indexOf(part, pos);
      if (at < 0) return false;
      pos = at + part.length;
    }
    return true;
  }
  return cq.length >= 20 && cs.startsWith(cq);
}

function classifyLang(text) {
  const s = String(text || '');
  const fr = (s.match(/[àâçéèêëîïôùûüÿœ]/gi) || []).length * 3
    + (s.match(/\b(le|la|les|des|une?|est|et|que|qui|dans|pour|pas|plus|sur|avec|nous|vous|ils|elles|du|au|aux|ce|cette|son|sa|ses)\b/gi) || []).length;
  const en = (s.match(/\b(the|of|and|to|in|that|is|it|with|for|as|not|this|his|her|their)\b/gi) || []).length;
  if (!fr && !en) return '';
  return fr >= en ? 'fr' : 'en';
}

const TRANSLATIONS = new Map();

/** Traduction de lot (i18n) — l'original reste la source de vérité. */
async function translateBatch(llm, texts, to) {
  const key = to + '::' + texts.join('|');
  if (TRANSLATIONS.has(key)) return TRANSLATIONS.get(key);
  if (!llm || typeof llm.complete !== 'function' || !texts.length) return null;
  const label = to === 'fr' ? 'français' : 'anglais';
  try {
    const r = await llm.complete({
      messages: [
        { role: 'system', content: `Traduis fidèlement chaque élément du tableau JSON en ${label}. Réponds uniquement par un tableau JSON de chaînes, même longueur et même ordre, sans commentaire ni balise.` },
        { role: 'user', content: JSON.stringify(texts) },
      ],
      temperature: 0.2,
      role: 'salon-traduire',
    }, {});
    const raw = String((r && r.text) || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length === texts.length && arr.every((x) => typeof x === 'string')) {
      TRANSLATIONS.set(key, arr);
      return arr;
    }
  } catch { /* repli : non traduit */ }
  return null;
}

/** Rerank dense bge-m3 : le question + les candidats, cosine. */
let DENSE_ERROR = null;

/** Rerank dense bge-m3 : le question + les 8 meilleurs candidats, cosine. */
async function denseRerank(embeddings, question, candidates) {
  DENSE_ERROR = null;
  if (!embeddings || typeof embeddings.embedBatch !== 'function' || candidates.length < 2) return null;
  const pool = candidates.slice(0, 8);
  try {
    const texts = [question, ...pool.map((c) => c.sentence)];
    const vectors = await embeddings.embedBatch(texts);
    if (!Array.isArray(vectors) || vectors.length !== texts.length) {
      DENSE_ERROR = `shape ${Array.isArray(vectors) ? vectors.length : 'n/a'} ≠ ${texts.length}`;
      return null;
    }
    const q = vectors[0];
    const dot = (a, b) => {
      let s = 0;
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i += 1) s += a[i] * b[i];
      return s;
    };
    return pool
      .map((c, i) => ({ ...c, dense: dot(q, vectors[i + 1]) }))
      .sort((a, b) => b.dense - a.dense);
  } catch (e) {
    DENSE_ERROR = String(e.message || e);
    return null;
  }
}

export default async function salonSpeakRoutes(app) {
  const cache = { catalog: null, doctrine: null, packs: new Map() };

  function catalog() {
    if (!cache.catalog) cache.catalog = json(join(MIRROR, 'catalog.json'));
    return cache.catalog;
  }
  function doctrine() {
    if (!cache.doctrine) cache.doctrine = json(join(MIRROR, 'doctrine.json'), {});
    return cache.doctrine;
  }
  function pack(authorId) {
    if (!/^[a-z0-9-]{1,64}$/.test(authorId)) return null;
    if (!cache.packs.has(authorId)) cache.packs.set(authorId, json(join(MIRROR, 'kb', `${authorId}.json`)));
    return cache.packs.get(authorId);
  }

  app.get('/v1/salon/embeddings/status', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const embeddings = app.kayrosContext && app.kayrosContext.embeddings;
    if (!embeddings || typeof embeddings.embedBatch !== 'function') {
      return { ok: false, error: 'embeddings indisponibles' };
    }
    const started = Date.now();
    try {
      const vectors = await embeddings.embedBatch(['bonheur']);
      const vector = Array.isArray(vectors) ? vectors[0] : null;
      return {
        ok: true,
        model: embeddings.model || null,
        dims: Array.isArray(vector) ? vector.length : 0,
        latencyMs: Date.now() - started,
      };
    } catch (e) {
      return reply.code(503).send({ ok: false, error: String(e.message || e), code: e.code || null });
    }
  });

  app.post('/v1/salon/speak', {
    config: { rateLimit: { max: 40, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = req.body || {};
    const authorId = String(body.authorId || '').trim();
    const question = String(body.question || '').trim().slice(0, 1000);
    const userLang = body.locale === 'en' ? 'en' : 'fr';
    if (!authorId || !question) return reply.code(400).send({ ok: false, error: 'authorId et question requis' });

    const cat = catalog();
    const author = cat && cat.authors ? cat.authors.find((a) => a.id === authorId) : null;
    const p = pack(authorId);
    if (!author || !p) return reply.code(404).send({ ok: false, error: 'auteur ou pack inconnu' });

    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
    const act = body.act === 'objection' ? 'objection' : 'reponse';
    const toName = String(body.toName || '').slice(0, 80);
    const toward = body.toward === 'author' ? 'author' : 'user';
    const last = history.length ? history[history.length - 1] : null;
    const query = `${question} ${last && last.prise ? last.prise : ''} ${last && last.text ? last.text : ''}`.trim();

    const all = (p.passages || []).filter((x) => x && x.s);
    const baseTerms = [...new Set(words(question))];
    const expanded = expandTerms(baseTerms);
    const principal = principalTerm(baseTerms);
    const cache = new Map();
    const ranked = all
      .map((x) => {
        const sentence = bestSentence(query, x.s);
        const { score, coverage, covered } = scoreSentence(sentence, expanded, baseTerms, cache);
        return { work: x.w, sentence, score, coverage, covered };
      })
      .filter((x) => x.sentence)
      .sort((a, b) => b.score - a.score);
    const candidates = diversify(ranked, 22, 4);
    const coverage = candidates.length ? candidates[0].coverage : 0;
    const principalSet = new Set([principal, ...(CONCEPTS[principal] || [])].filter(Boolean));
    const withPrincipal = candidates.filter((c) => words(c.sentence).some((w) => principalSet.has(w)));
    const top = withPrincipal[0] || null;

    // Ancrage insuffisant : aucun passage ne porte le concept de la question.
    if (!top) {
      const av = avowal({ author, doctrine: doctrine(), question, toName: "l’hôte" });
      return {
        ok: true,
        text: av.text,
        prise: av.prise,
        citations: [],
        engine: 'fallback',
        provider: null,
        degraded: 'ancrage insuffisant',
        retrieval: { mode: 'hybrid', coverage: Number(coverage.toFixed(2)), candidates: candidates.length, rerank: false },
      };
    }

    const dense = await denseRerank(app.kayrosContext && app.kayrosContext.embeddings, question, withPrincipal);
    const reranked = dense ? null : await rerankWithModel(app.kayrosContext && app.kayrosContext.llm, question, withPrincipal);
    const selected = (dense && dense.length ? dense : (reranked && reranked.length ? reranked : withPrincipal)).slice(0, 5);
    const cleaned = selected.filter((x) => x.sentence);
    const strong = true;
    const sources = cleaned.map((x) => x.sentence);

    const messages = [
      { role: 'system', content: buildPersona({ author, doctrine: doctrine(), question }) },
      {
        role: 'user',
        content: [
          `Question de table : ${question}`,
          last ? `Dernier tour à enchaîner : ${last.name || 'un convive'}${last.prise ? ` — prise : ${last.prise}` : ''}. ${last.text || ''}` : 'Tu ouvres la table.',
          act === 'objection'
            ? (toward === 'author' && toName
              ? `Acte : objection. Tu t’adresses à ${toName}. Tu objectes à SA PRISE, pas à un autre problème.`
              : 'Acte : objection, adressée à l’hôte. Nomme-le une fois.')
            : (toward === 'author' && toName
              ? `Acte : réponse. Tu t’adresses à ${toName}. Tu fais avancer SA dernière prise d’un cran, toujours sur la question de table.`
              : 'Acte : réponse à l’hôte. Nomme-le une fois.'),
          `Ancre-toi à un seul passage. Cite une phrase entière EXACTEMENT, entre guillemets « … ».`,
          `Langue de réponse : ${userLang === 'fr' ? 'français' : 'anglais'}.`,
          sources.some((s) => { const l = classifyLang(s); return l && l !== userLang; })
            ? `Les passages sont dans une autre langue : tu peux citer l’original exact ou sa traduction fidèle en ${userLang === 'fr' ? 'français' : 'anglais'}. Une citation traduite sera signalée comme telle.`
            : '',
          cleaned.length ? cleaned.map((x) => `« ${x.work} »\n${x.sentence}`).join('\n\n') : 'Aucun passage pertinent.',
          'Format exact :\nPRISE: <une phrase>\nREPLIQUE:\n<90 à 170 mots, phrases complètes, première personne, sans liste>\nObligation : la REPLIQUE contient une citation EXACTE, entre guillemets « … », copiée mot pour mot d’un passage fourni. Sans citation, la réponse est refusée.',
        ].join('\n\n'),
      },
    ];

    let result = null;
    try {
      const llm = app.kayrosContext && app.kayrosContext.llm;
      if (llm && typeof llm.complete === 'function') {
        result = await llm.complete({ messages, temperature: 0.45, role: 'salon-auteur' }, {});
      }
    } catch (e) {
      app.log.warn({ err: e }, 'salon-speak llm');
    }

    const raw = result && typeof result.text === 'string' ? result.text.trim() : '';
    const isMock = !raw || /^\[mock\]/i.test(raw);
    let text = '';
    let prise = '';
    if (!isMock) {
      const pm = raw.match(/^\s*PRISE\s*:\s*(.+?)(?:\n|$)/i);
      const bm = raw.split(/REPLIQUE\s*:\s*/i)[1];
      prise = (pm ? pm[1] : '').replace(/^["«]+|["»]+$/g, '').trim();
      text = (bm || '').trim();
      if (!text) text = raw.replace(/^\s*PRISE\s*:.*$/im, '').trim();
    }

    const otherTitles = (cat.authors || [])
      .filter((a) => a.id !== authorId)
      .flatMap((a) => (a.works || []).map((w) => canonical(w.title)))
      .filter((t) => t && t.length >= 8)
      .filter((t) => !(author.works || []).some((w) => canonical(w.title).includes(t)));
    const checked = text ? verifyQuotes(text, author, sources, otherTitles) : { citations: [], errors: ['réponse vide'], unmatched: [] };
    let citationsChecked = checked.citations;
    let errors = checked.errors;
    if (text && checked.unmatched.length && sources.some((s) => { const l = classifyLang(s); return l && l !== userLang; })) {
      const translated = await translateBatch(app.kayrosContext && app.kayrosContext.llm, sources, userLang);
      if (translated && translated.length === sources.length) {
        const still = [];
        const added = [];
        for (const q of checked.unmatched) {
          const idx = translated.findIndex((t) => quoteMatches(q, t));
          if (idx >= 0) added.push({ text: q, original: sources[idx], translated: true, lang: userLang });
          else still.push(q);
        }
        if (added.length) {
          citationsChecked = [...citationsChecked, ...added];
          errors = still.map((q) => `citation non vérifiée : « ${q.slice(0, 60)}… »`);
        }
      }
    }
    const wordCount = (text.match(/[\p{L}\p{N}'’-]+/gu) || []).length;
    const grounded = citationsChecked.length > 0;
    const valid = text && errors.length === 0 && wordCount >= 40 && wordCount <= 240
      && (!strong || grounded);

    if (!valid) {
      const passage = cleaned[0] || null;
      const fb = composeFallback({ author, question, passage, act, toName: "l’hôte" });
      return {
        ok: true,
        text: fb.text,
        prise: fb.prise,
        citations: passage ? [{ work: passage.work, text: passage.sentence }] : [],
        engine: 'fallback',
        provider: result ? result.provider || null : null,
        degraded: isMock ? 'mock' : (errors[0] || (strong && !grounded ? 'citation absente' : 'hors contrat')),
        retrieval: { mode: dense ? 'hybrid+dense' : 'hybrid', coverage: Number(coverage.toFixed(2)), candidates: candidates.length, rerank: Boolean(reranked), dense: Boolean(dense), ...(DENSE_ERROR ? { denseError: DENSE_ERROR } : {}) },
      };
    }

    const citationsOut = citationsChecked.map((c) => {
      const hit = cleaned.find((x) => canonical(x.sentence).includes(canonical(c.text)))
        || (c.original ? cleaned.find((x) => canonical(x.sentence).includes(canonical(c.original))) : null);
      return {
        work: hit ? hit.work : '',
        text: c.text,
        ...(c.translated ? { translated: true, original: c.original, lang: c.lang } : {}),
      };
    }).filter((c) => c.work);

    return {
      ok: true,
      text,
      prise: prise || (text.split(/(?<=[.!?])\s+/)[0] || '').slice(0, 220),
      citations: citationsOut,
      engine: 'llm',
      provider: result.provider || null,
      degraded: result.degraded || null,
      to: toward === 'author' ? toName : 'hôte',
      retrieval: { mode: dense ? 'hybrid+dense' : 'hybrid', coverage: Number(coverage.toFixed(2)), candidates: candidates.length, rerank: Boolean(reranked), dense: Boolean(dense), ...(DENSE_ERROR ? { denseError: DENSE_ERROR } : {}) },
    };
  });
}
