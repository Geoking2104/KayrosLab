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
    const m = raw.match(/\[[\d,\s]+\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]);
    const out = arr
      .filter((i) => Number.isInteger(i) && i >= 0 && i < candidates.length)
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
  for (const m of String(text || '').matchAll(/[«"“]([^«»"“”]{20,400})[»"”]/g)) {
    const q = m[1].trim();
    const cq = canonical(q);
    if (known.some((t) => t === cq || t.includes(cq) || cq.includes(t.split(':')[0]))) continue;
    const hit = sources.find((s) => canonical(s).includes(cq));
    if (hit) citations.push({ text: q, source: hit });
    else errors.push(`citation non vérifiée : « ${q.slice(0, 60)}… »`);
  }
  // Une œuvre d'un autre auteur glissée dans la bouche du convive est une
  // hallucination d'attribution : on la refuse, même hors guillemets.
  const body = canonical(text);
  for (const t of otherTitles) {
    if (t.length >= 8 && body.includes(t)) errors.push(`œuvre d'un autre auteur : « ${t} »`);
  }
  return { citations, errors };
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

  app.post('/v1/salon/speak', {
    config: { rateLimit: { max: 40, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const body = req.body || {};
    const authorId = String(body.authorId || '').trim();
    const question = String(body.question || '').trim().slice(0, 1000);
    if (!authorId || !question) return reply.code(400).send({ ok: false, error: 'authorId et question requis' });

    const cat = catalog();
    const author = cat && cat.authors ? cat.authors.find((a) => a.id === authorId) : null;
    const p = pack(authorId);
    if (!author || !p) return reply.code(404).send({ ok: false, error: 'auteur ou pack inconnu' });

    const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
    const act = body.act === 'objection' ? 'objection' : 'reponse';
    const last = history.length ? history[history.length - 1] : null;
    const query = `${question} ${last && last.prise ? last.prise : ''} ${last && last.text ? last.text : ''}`.trim();

    const all = (p.passages || []).filter((x) => x && x.s);
    const baseTerms = [...new Set(words(question))];
    const expanded = expandTerms(baseTerms);
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
    const covered = candidates.length ? candidates[0].covered : 0;
    const strong = candidates.length > 0 && (
      coverage >= 0.34 || covered >= 2 || (covered >= 1 && baseTerms.length <= 4 && coverage >= 0.25)
    );

    // Ancrage insuffisant : aveu du manque, aucune citation hors sujet.
    if (!strong) {
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

    const reranked = await rerankWithModel(app.kayrosContext && app.kayrosContext.llm, question, candidates);
    const selected = (reranked && reranked.length ? reranked : candidates).slice(0, 5);
    const cleaned = selected.filter((x) => x.sentence);
    const weak = false;

    const messages = [
      { role: 'system', content: buildPersona({ author, doctrine: doctrine(), question }) },
      {
        role: 'user',
        content: [
          `Question de table : ${question}`,
          last ? `Dernier tour à enchaîner : ${last.name || 'un convive'}${last.prise ? ` — prise : ${last.prise}` : ''}. ${last.text || ''}` : 'Tu ouvres la table.',
          act === 'objection' ? `Acte : objection, adressée à l’hôte. Nomme-le une fois.` : `Acte : réponse à l’hôte. Nomme-le une fois.`,
          weak
            ? 'Les passages sont fragiles ou hors sujet : ne les cite pas. Argumente depuis tes œuvres nommées, ou avoue le manque.'
            : `Ancre-toi à un seul passage. Cite une phrase entière EXACTEMENT, entre guillemets « … ».`,
          cleaned.length ? cleaned.map((x) => `« ${x.work} »\n${x.sentence}`).join('\n\n') : 'Aucun passage pertinent.',
          'Format exact :\nPRISE: <une phrase>\nREPLIQUE:\n<90 à 170 mots, phrases complètes, première personne, sans liste>',
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

    const sources = cleaned.map((x) => x.sentence);
    const otherTitles = (cat.authors || [])
      .filter((a) => a.id !== authorId)
      .flatMap((a) => (a.works || []).map((w) => canonical(w.title)))
      .filter((t) => t && t.length >= 8)
      .filter((t) => !(author.works || []).some((w) => canonical(w.title).includes(t)));
    const checked = text ? verifyQuotes(text, author, sources, otherTitles) : { citations: [], errors: ['réponse vide'] };
    const wordCount = (text.match(/[\p{L}\p{N}'’-]+/gu) || []).length;
    const grounded = checked.citations.length > 0;
    const valid = text && checked.errors.length === 0 && wordCount >= 40 && wordCount <= 240
      && (!strong || grounded);

    if (!valid) {
      const passage = cleaned[0] || null;
      const fb = composeFallback({ author, question, passage, act, toName: "l’hôte" });
      return {
        ok: true,
        text: fb.text,
        prise: fb.prise,
        citations: passage ? [{ work: passage.work, text: passage.quote }] : [],
        engine: 'fallback',
        provider: result ? result.provider || null : null,
        degraded: isMock ? 'mock' : (checked.errors[0] || (strong && !grounded ? 'citation absente' : 'hors contrat')),
        retrieval: { mode: 'hybrid', coverage: Number(coverage.toFixed(2)), candidates: candidates.length, rerank: Boolean(reranked) },
      };
    }

    const citations = checked.citations.map((c) => {
      const hit = cleaned.find((x) => canonical(x.sentence).includes(canonical(c.text)));
      return { work: hit ? hit.work : '', text: c.text };
    }).filter((c) => c.work);

    return {
      ok: true,
      text,
      prise: prise || (text.split(/(?<=[.!?])\s+/)[0] || '').slice(0, 220),
      citations,
      engine: 'llm',
      provider: result.provider || null,
      degraded: result.degraded || null,
      retrieval: { mode: 'hybrid', coverage: Number(coverage.toFixed(2)), candidates: candidates.length, rerank: Boolean(reranked) },
    };
  });
}
