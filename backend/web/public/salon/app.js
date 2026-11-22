/* Le Salon — client autonome (sans build).
 * Charge le catalogue publié et les packs mémoire, interroge /v1/salon/speak,
 * et retombe sur un composeur déterministe si l'API ou le modèle manque.
 */
(() => {
  'use strict';

  const BASE = new URL('./', window.location.href);
  // En production la page est servie par www.kayroslab.com et l'API par
  // api.kayroslab.com (CORS déjà autorisé). En local, on reste en same-origin
  // et l'absence d'API déclenche le repli déterministe.
  const API = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)
    ? ''
    : 'https://api.kayroslab.com';
  const $ = (id) => document.getElementById(id);
  const ui = {
    author: $('author'),
    card: $('card'),
    thread: $('thread'),
    form: $('ask'),
    question: $('question'),
    reset: $('reset'),
    status: $('status'),
  };

  const state = {
    catalog: null,
    manifest: null,
    author: null,
    pack: null,
    history: [],
    busy: false,
  };

  /* ------------------------------------------------------------ données */

  async function loadJSON(name) {
    const res = await fetch(new URL(name, BASE), { cache: 'no-store' });
    if (!res.ok) throw new Error(`${name} : HTTP ${res.status}`);
    return res.json();
  }

  function sentencesOf(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    return clean.split(/(?<=[.!?…])\s+(?=["«“„]?[A-ZÀ-ÖØ-Þ0-9])/u)
      .map((s) => s.replace(/^["«“„\][\s]+/, '').replace(/\s*["»”]\s*$/, '').trim())
      .filter((s) => s.length >= 40 && s.length <= 320 && /[.!?…»"]$/.test(s));
  }

  const STOP = new Set(['dans', 'cette', 'avec', 'pour', 'plus', 'tout', 'tous', 'leur', 'leurs', 'comme', 'mais', 'donc', 'alors', 'ainsi', 'sans', 'sous', 'entre', 'apres', 'avant', 'encore', 'aussi', 'bien', 'tres', 'fait', 'faire', 'etre', 'avoir', 'cela', 'ceux', 'celles', 'nous', 'vous', 'elle', 'elles', 'that', 'this', 'with', 'from', 'have', 'been', 'were', 'which', 'their', 'there', 'about', 'would', 'could', 'should', 'the', 'and']);

  function terms(text) {
    return (String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .match(/[a-z][a-z'-]+/g) || [])
      .map((w) => w.replace(/['-]/g, ''))
      .filter((w) => w.length >= 4 && !STOP.has(w));
  }

  function relevance(query, text) {
    const q = new Set(terms(query));
    if (!q.size) return 0;
    const w = terms(text);
    if (!w.length) return 0;
    let hit = 0;
    for (const x of w) if (q.has(x)) hit += 1;
    return hit / Math.sqrt(q.size * Math.max(w.length, 8));
  }

  function bestSentence(query, text) {
    const list = sentencesOf(text);
    if (!list.length) return '';
    let best = list[0];
    let score = -1;
    for (const s of list) {
      const v = relevance(query, s);
      if (v > score) { score = v; best = s; }
    }
    return best;
  }

  function retrieve(pack, query, k = 5) {
    const all = (pack && pack.passages) || [];
    return all
      .map((p) => ({ work: p.w, sentence: bestSentence(query, p.s), score: relevance(query, `${p.w} ${p.s}`) }))
      .filter((p) => p.sentence)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /* --------------------------------------------------------- rendu */

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function setStatus(text) { ui.status.textContent = text || ''; }

  function renderCard() {
    const a = state.author;
    if (!a) { clear(ui.card); return; }
    clear(ui.card);
    ui.card.append(
      el('h2', null, a.name),
      el('p', 'era', [a.era, a.kind].filter(Boolean).join(' · ')),
      el('p', 'blurb', a.blurb || ''),
    );
    const info = state.manifest && state.manifest.authors ? state.manifest.authors[a.id] : null;
    const works = (a.works || []).length;
    const sentences = info ? info.sentences : 0;
    const stats = el('p', 'stats');
    stats.append(
      el('span', 'pill', `${works} œuvres`),
      el('span', 'pill', `${sentences} phrases en mémoire`),
      el('span', 'pill', 'domaine public'),
    );
    ui.card.append(stats);
    if (a.sample) ui.card.append(el('blockquote', 'sample', `« ${a.sample} »`));
  }

  function addMessage({ role, name, text, prise, citations, meta }) {
    const empty = ui.thread.querySelector('.empty');
    if (empty) empty.remove();
    const article = el('article', `turn ${role}`);
    const head = el('header', 'turn-head');
    head.append(el('span', 'who', name));
    if (role === 'author') head.append(el('span', 'badge', 'voix simulée'));
    article.append(head);
    if (prise) article.append(el('p', 'prise', `Prise : ${prise}`));
    article.append(el('p', 'said', text));
    if (citations && citations.length) {
      const details = el('details', 'cites');
      details.append(el('summary', null, `Citations vérifiées (${citations.length})`));
      const list = el('ul');
      for (const c of citations) {
        const li = el('li');
        li.append(el('em', null, c.work ? `« ${c.work} »` : 'Œuvre'), document.createTextNode(c.text ? ` — « ${c.text} »` : ''));
        list.append(li);
      }
      details.append(list);
      article.append(details);
    }
    if (meta) article.append(el('p', 'meta', meta));
    ui.thread.append(article);
    article.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }

  /* --------------------------------------------------- repli déterministe */

  function composeLocal({ author, question, passages, act }) {
    const first = passages && passages[0];
    const work = first ? first.work : ((author.works && author.works[0] && author.works[0].title) || 'mes œuvres');
    const quote = first ? first.sentence : '';
    const prise = act === 'objection'
      ? "J’accorde un point, puis je distingue."
      : 'Sur cette question, je réponds depuis mes livres, non depuis une politesse.';
    const text = act === 'objection'
      ? `L’hôte, je te l’accorde en partie. Pourtant la question demeure, et « ${work} » la déplace : « ${quote} » Ce n’est pas ta personne que je presse, c’est ce que cette phrase ne peut plus soutenir. Ainsi la difficulté n’est pas dans les mots, mais dans ce que ta thèse engage.`
      : `L’hôte, voici ce que je peux signer. Dans « ${work} » : « ${quote} » Cela répond à ce que tu viens de poser, et cela suffit pour aujourd’hui : la suite est à qui voudra objecter. Je m’en tiens là, sans ajouter de maxime inutile. La question reste ouverte, et je la rends à la table.`;
    return { text, prise, citations: first ? [{ work, text: quote }] : [], engine: 'local' };
  }

  /* ------------------------------------------------------------- tour */

  async function ask(question) {
    if (state.busy || !state.author || !state.pack) return;
    state.busy = true;
    setStatus('Le convive relit ses œuvres…');
    ui.question.value = '';
    addMessage({ role: 'user', name: 'Vous', text: question });
    state.history.push({ name: 'L’hôte', text: question });

    const passages = retrieve(state.pack, `${question} ${state.history.slice(-2).map((h) => h.text).join(' ')}`, 5);
    let turn = null;

    try {
      const res = await fetch(`${API}/v1/salon/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorId: state.author.id,
          question,
          history: state.history.slice(-6),
          act: 'reponse',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.ok && data.text) {
          turn = {
            text: data.text,
            prise: data.prise || '',
            citations: data.citations || [],
            engine: data.engine || 'api',
            provider: data.provider || '',
            degraded: data.degraded || '',
          };
        }
      }
    } catch (e) {
      /* repli local */
    }

    if (!turn) turn = composeLocal({ author: state.author, question, passages, act: 'reponse' });

    const deg = turn.degraded;
    const degText = typeof deg === 'string' ? deg : (deg && (deg.reason || deg.to)) || '';
    addMessage({
      role: 'author',
      name: state.author.name,
      text: turn.text,
      prise: turn.prise,
      citations: turn.citations,
      meta: [turn.engine, turn.provider, degText].filter(Boolean).join(' · '),
    });
    state.history.push({ name: state.author.name, text: turn.text, prise: turn.prise });
    state.busy = false;
    setStatus('prêt');
  }

  /* ------------------------------------------------------------- init */

  function resetThread() {
    clear(ui.thread);
    ui.thread.append(el('p', 'empty', 'Posez une question pour ouvrir la table.'));
    state.history = [];
    setStatus('prêt');
  }

  async function selectAuthor(id) {
    const a = state.catalog.authors.find((x) => x.id === id);
    if (!a) return;
    state.author = a;
    state.pack = null;
    renderCard();
    resetThread();
    setStatus('chargement de la mémoire…');
    try {
      state.pack = await loadJSON(`kb/${a.id}.json`);
      renderCard();
      setStatus('prêt');
      ui.question.focus();
    } catch (e) {
      setStatus(`mémoire indisponible : ${e.message}`);
    }
  }

  async function init() {
    try {
      const [catalog, manifest] = await Promise.all([loadJSON('catalog.json'), loadJSON('kb-manifest.json')]);
      state.catalog = catalog;
      state.manifest = manifest;
      const ids = new Set(Object.keys((manifest && manifest.authors) || {}));
      const authors = (catalog.authors || []).filter((a) => ids.has(a.id)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      ui.author.replaceChildren();
      for (const a of authors) {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = `${a.name} — ${a.kind}`;
        ui.author.append(opt);
      }
      if (!authors.length) throw new Error('aucun auteur publié');
      const preferred = authors.find((a) => a.id === 'voltaire') || authors[0];
      ui.author.value = preferred.id;
      await selectAuthor(preferred.id);
      setStatus('prêt');
    } catch (e) {
      clear(ui.card);
      ui.card.append(el('p', 'error', `Le Salon n'a pas pu charger sa mémoire : ${e.message}`));
      setStatus('indisponible');
    }
  }

  ui.author.addEventListener('change', () => selectAuthor(ui.author.value));
  ui.reset.addEventListener('click', resetThread);
  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const q = ui.question.value.trim();
    if (q.length < 2) return;
    ask(q);
  });

  init();
})();
