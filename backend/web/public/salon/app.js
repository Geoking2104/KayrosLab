/* Le Salon — table philosophique multi-auteurs (client autonome, sans build).
 * Les auteurs sont des agents : chacun répond depuis SON pack d'œuvres.
 * L'API /v1/salon/speak fait le retrieval hybride et la vérification ;
 * en cas d'indisponibilité, un composeur local prend le relais.
 */
(() => {
  'use strict';

  const BASE = new URL('./', window.location.href);
  const API = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)
    ? ''
    : 'https://api.kayroslab.com';

  const $ = (id) => document.getElementById(id);
  const PREFERS_STILL = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const ui = {
    seated: $('seated'),
    seatCount: $('seatCount'),
    search: $('search'),
    candidates: $('candidates'),
    circles: $('circles'),
    questionLabel: $('questionLabel'),
    thread: $('thread'),
    form: $('ask'),
    question: $('question'),
    open: $('open'),
    debate: $('debate'),
    reset: $('reset'),
    status: $('status'),
    phase: $('phase'),
    tensionFill: $('tensionFill'),
    tensionLabel: $('tensionLabel'),
    prises: $('prises'),
    turnCount: $('turnCount'),
    share: $('share'),
  };

  const state = {
    catalog: null,
    manifest: null,
    avatars: null,
    packs: new Map(),
    seated: [],
    question: '',
    turns: [],
    busy: false,
    round: 0,
  };

  const CIRCLES = [
    { name: 'Lumières', ids: ['voltaire', 'rousseau', 'montaigne'] },
    { name: 'Le pouvoir', ids: ['machiavel', 'marcaurele', 'suntzu'] },
    { name: 'Académie', ids: ['platon', 'aristote', 'montaigne'] },
    { name: 'Les voix du roman', ids: ['balzac', 'flaubert', 'maupassant'] },
  ];

  const MAX_SEATS = 4;
  const CLIENT_KEY = 'salon-client-v1';
  const SHARED_ID = new URL(window.location.href).searchParams.get('c');
  const CLIENT_ID = (() => {
    try {
      if (SHARED_ID && /^[a-z0-9-]{16,64}$/.test(SHARED_ID)) {
        localStorage.setItem(CLIENT_KEY, SHARED_ID);
        return SHARED_ID;
      }
      let id = localStorage.getItem(CLIENT_KEY);
      if (!/^[a-z0-9-]{16,64}$/.test(id || '')) {
        id = crypto.randomUUID
          ? crypto.randomUUID()
          : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(CLIENT_KEY, id);
      }
      return id;
    } catch {
      return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
  })();
  let saveTimer = null;
  let pendingIntent = 'append';
  let lastSync = 0;

  /* ------------------------------------------------------------- outils */

  function hash(text) {
    let h = 0;
    for (let i = 0; i < String(text).length; i += 1) h = ((h * 31) + String(text).charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function initials(name) {
    return String(name || '')
      .split(/[\s'’-]+/).filter(Boolean).slice(0, 2)
      .map((w) => w[0]).join('').toUpperCase();
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function picto(author, size = 'md') {
    const avatar = state.avatars && state.avatars.authors && state.avatars.authors[author.id];
    if (!author._noPortrait && avatar && avatar.file) {
      const img = document.createElement('img');
      img.className = `picto ${size} portrait`;
      img.src = new URL(avatar.file, BASE).toString();
      img.alt = '';
      // Pas de lazy : dans un conteneur à hauteur contrainte, le portrait ne
      // se chargeait jamais et la table restait en monogrammes.
      img.decoding = 'async';
      img.title = avatar.credit ? `${author.name} — ${avatar.credit}` : author.name;
      img.setAttribute('aria-hidden', 'true');
      // Un portrait cassé ne doit pas laisser un trou : on retombe sur le monogramme.
      img.addEventListener('error', () => {
        const fallback = picto({ ...author, _noPortrait: true }, size);
        img.replaceWith(fallback);
      }, { once: true });
      return img;
    }
    const node = el('span', `picto ${size}`, (author.monogram || initials(author.name)).slice(0, 3));
    node.style.setProperty('--hue', String(hash(author.id) % 360));
    node.title = author.name;
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function setStatus(text) { ui.status.textContent = text || ''; }

  async function loadJSON(name) {
    const res = await fetch(new URL(name, BASE), { cache: 'no-store' });
    if (!res.ok) throw new Error(`${name} : HTTP ${res.status}`);
    return res.json();
  }

  async function loadPack(id) {
    if (state.packs.has(id)) return state.packs.get(id);
    try {
      const pack = await loadJSON(`kb/${id}.json`);
      state.packs.set(id, pack);
      return pack;
    } catch {
      state.packs.set(id, null);
      return null;
    }
  }

  /* --------------------------------------------------------- texte local */

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

  function sentencesOf(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    return clean.split(/(?<=[.!?…])\s+(?=["«“„]?[A-ZÀ-ÖØ-Þ0-9])/u)
      .map((s) => s.replace(/^["«“„\][\s]+/, '').replace(/\s*["»”]\s*$/, '').trim())
      .filter((s) => s.length >= 40 && s.length <= 320 && /[.!?…»"]$/.test(s));
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

  function coverageOf(question, text) {
    const q = new Set(terms(question));
    if (!q.size) return { ratio: 0, covered: 0, total: 0 };
    const w = new Set(terms(text));
    let hit = 0;
    for (const t of q) if (w.has(t)) hit += 1;
    return { ratio: hit / q.size, covered: hit, total: q.size };
  }

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

  function expandedQuery(query) {
    const base = terms(query);
    const out = new Set(base);
    for (const w of base) {
      for (const [key, list] of Object.entries(CONCEPTS)) {
        if (key === w || list.includes(w)) list.forEach((x) => out.add(x));
      }
    }
    return [...out].join(' ');
  }

  function principalTerm(base) {
    for (const w of base) {
      for (const [key, list] of Object.entries(CONCEPTS)) {
        if (key === w || list.includes(w)) return key;
      }
    }
    return base.slice().sort((a, b) => b.length - a.length)[0] || '';
  }

  function retrieveLocal(pack, query, k = 5) {
    const expanded = expandedQuery(query);
    const all = (pack && pack.passages) || [];
    return all
      .map((p) => ({ work: p.w, sentence: bestSentence(expanded, p.s), score: relevance(expanded, `${p.w} ${p.s}`) }))
      .filter((p) => p.sentence)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  function avowalLocal(author, toName) {
    const thesis = author.blurb || 'ma thèse reste à préciser';
    const who = toName ? toName.charAt(0).toUpperCase() + toName.slice(1) : 'L’hôte';
    return {
      text: `${who}, je ne trouve dans mes œuvres aucune phrase qui réponde vraiment à cette question ; je ne citerai donc pas à faux. Ce que je peux signer, sans citation : ${thesis} C'est peu, mais c'est à moi ; le reste, la table le dira. La question reste ouverte, et je la rends à qui voudra objecter.`,
      prise: 'Sur cette question, mes livres ne fournissent pas de passage décisif.',
      citations: [],
      engine: 'local',
      provider: '',
      degraded: 'ancrage insuffisant',
      retrieval: null,
    };
  }

  function composeLocal({ author, question, passages, act, toName }) {
    const principal = principalTerm(terms(question));
    const principalSet = new Set([principal, ...(CONCEPTS[principal] || [])].filter(Boolean));
    const first = (passages || []).find((p) => terms(p.sentence).some((w) => principalSet.has(w)));
    const info = first ? coverageOf(question, first.sentence) : { ratio: 0, covered: 0, total: 0 };
    if (!first) return avowalLocal(author, toName);
    const work = first.work;
    const quote = first.sentence;
    const who = toName ? toName.charAt(0).toUpperCase() + toName.slice(1) : 'L’hôte';
    const prise = act === 'objection'
      ? "J’accorde un point, puis je distingue."
      : 'Sur cette question, je réponds depuis mes livres, non depuis une politesse.';
    const text = act === 'objection'
      ? `${who}, je te l’accorde en partie. Pourtant la question demeure, et « ${work} » la déplace : « ${quote} » Ce n’est pas ta personne que je presse, c’est ce que cette phrase ne peut plus soutenir. Ainsi la difficulté n’est pas dans les mots, mais dans ce que ta thèse engage.`
      : `${who}, voici ce que je peux signer. Dans « ${work} » : « ${quote} » Cela répond à ce que tu viens de poser, et cela suffit pour aujourd’hui : la suite est à qui voudra objecter. Je m’en tiens là, sans ajouter de maxime inutile. La question reste ouverte, et je la rends à la table.`;
    return {
      text, prise,
      citations: [{ work, text: quote }],
      engine: 'local', provider: '', degraded: '',
      retrieval: { mode: 'lexical', coverage: Number(info.ratio.toFixed(2)), candidates: passages.length, rerank: false },
    };
  }

  /* ----------------------------------------------------------- évolution */

  function linkOf(turn, prev) {
    if (!prev) return 'ouvre';
    const blob = `${turn.prise || ''} ${turn.text || ''}`.toLowerCase();
    if (turn.act === 'objection') {
      return /(distingue|pas encore|pourtant|cependant|en partie)/.test(blob) ? 'distingue' : 'contredit';
    }
    if (/(j['’]accorde|je te l['’]accorde|d['’]accord)/.test(blob)) return 'accorde';
    if (/(précise|precise|je tiens|autrement dit)/.test(blob)) return 'précise';
    return 'précise';
  }

  function tensionOf(turns) {
    const links = turns.map((t, i) => linkOf(t, turns[i - 1]));
    const contredit = links.filter((l) => l === 'contredit').length;
    const distingue = links.filter((l) => l === 'distingue').length;
    const acc = links.filter((l) => l === 'accorde').length;
    return Math.max(8, Math.min(100, 12 + contredit * 24 + distingue * 12 - acc * 4));
  }

  function phaseOf(tension) {
    if (tension >= 70) return 'opposition vive';
    if (tension >= 40) return 'tension ouverte';
    if (tension >= 20) return 'discussion';
    return 'apaisement';
  }

  const LINK_LABEL = {
    ouvre: 'ouvre', accorde: 'accorde', distingue: 'distingue',
    contredit: 'contredit', précise: 'précise', compose: 'compose',
  };

  /* --------------------------------------------------------------- rendu */

  function renderSeated() {
    clear(ui.seated);
    if (!state.seated.length) {
      ui.seated.append(el('p', 'empty-small', 'Aucun convive. Invitez un auteur ou choisissez un cercle.'));
    }
    for (const author of state.seated) {
      const card = el('article', 'seat');
      card.append(picto(author, 'md'));
      const body = el('div', 'seat-body');
      body.append(
        el('h3', null, author.name),
        el('p', 'seat-meta', [author.era, author.kind].filter(Boolean).join(' · ')),
        el('p', 'seat-works', `${(author.works || []).length} œuvres en contexte`),
      );
      card.append(body);
      const remove = el('button', 'remove', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Retirer ${author.name}`);
      remove.addEventListener('click', () => unseat(author.id));
      card.append(remove);
      ui.seated.append(card);
    }
    ui.seatCount.textContent = `${state.seated.length}/${MAX_SEATS}`;
  }

  function renderCandidates() {
    if (!state.catalog) return;
    const needle = ui.search.value.trim().toLowerCase();
    const seated = new Set(state.seated.map((a) => a.id));
    const published = new Set(Object.keys((state.manifest && state.manifest.authors) || {}));
    const list = state.catalog.authors
      .filter((a) => published.has(a.id) && !seated.has(a.id))
      .filter((a) => !needle || [a.name, a.kind, a.era].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .slice(0, 12);
    clear(ui.candidates);
    if (!list.length) {
      ui.candidates.append(el('p', 'empty-small', 'Aucun auteur disponible.'));
      return;
    }
    for (const author of list) {
      const btn = el('button', 'candidate');
      btn.type = 'button';
      btn.append(picto(author, 'sm'));
      const body = el('span', 'candidate-body');
      body.append(el('strong', null, author.name), el('small', null, `${author.kind} · ${author.era || ''}`));
      btn.append(body);
      btn.addEventListener('click', () => seat(author.id));
      ui.candidates.append(btn);
    }
  }

  function renderCircles() {
    clear(ui.circles);
    for (const circle of CIRCLES) {
      const ids = circle.ids.filter((id) => (state.catalog.authors || []).some((a) => a.id === id));
      if (ids.length < 2) continue;
      const btn = el('button', 'chip', circle.name);
      btn.type = 'button';
      btn.addEventListener('click', () => {
        for (const id of ids) seat(id);
      });
      ui.circles.append(btn);
    }
  }

  function renderQuestion() {
    ui.questionLabel.textContent = state.question || 'Aucune question posée.';
  }

  function actLabel(turn, index) {
    if (turn.toward === 'author' && turn.act === 'objection') return `objection à ${turn.toName}`;
    if (turn.toward === 'author') return `réponse à ${turn.toName}`;
    if (turn.act === 'objection') return 'objection à l’hôte';
    return index === 0 ? 'ouverture' : 'réponse à l’hôte';
  }

  /** Carte « X écrit… » : rend visible l'attente du modèle. */
  let writingCard = null;

  function showWriting(author) {
    hideWriting();
    const empty = ui.thread.querySelector('.empty');
    if (empty) empty.remove();
    const card = el('article', 'turn pending');
    card.style.setProperty('--hue', String(hash(author.id) % 360));
    const head = el('header', 'turn-head');
    head.append(picto(author, 'sm'));
    const who = el('div', 'who');
    who.append(el('h3', null, author.name), el('p', 'sub', 'écrit…'));
    head.append(who);
    card.append(head);
    const dots = el('div', 'writing');
    dots.append(el('span'), el('span'), el('span'));
    card.append(dots);
    ui.thread.append(card);
    ui.thread.scrollTop = ui.thread.scrollHeight;
    writingCard = card;
  }

  function hideWriting() {
    if (writingCard) { writingCard.remove(); writingCard = null; }
  }

  /** Écrit le texte mot à mot (durée bornée : ~1,4 s quel que soit le volume). */
  function revealText(node, text, done) {
    const parts = String(text || '').split(/(\s+)/);
    const step = Math.max(6, Math.min(36, 1400 / Math.max(1, parts.length)));
    let i = 0;
    node.classList.add('streaming');
    const timer = setInterval(() => {
      node.textContent = parts.slice(0, i).join('');
      i += 2;
      if (i >= parts.length) {
        clearInterval(timer);
        node.textContent = text;
        node.classList.remove('streaming');
        if (typeof done === 'function') done();
      }
    }, step);
  }

  function renderThread(scroll = false) {    clear(ui.thread);
    if (!state.turns.length) {
      ui.thread.append(el('p', 'empty', state.question
        ? 'La table est prête. Lancez le premier tour.'
        : 'Invitez au moins deux auteurs, puis posez une question pour ouvrir la table.'));
      return;
    }
    state.turns.forEach((turn, index) => {
      const card = el('article', 'turn');
      card.id = `turn-${index}`;
      card.style.setProperty('--hue', String(hash(turn.author.id) % 360));
      const head = el('header', 'turn-head');
      head.append(picto(turn.author, 'sm'));
      const who = el('div', 'who');
      who.append(el('h3', null, turn.author.name), el('p', 'sub', `${actLabel(turn, index)} · voix simulée`));
      head.append(who);
      card.append(head);
      if (turn.prise) card.append(el('p', 'prise', `Prise — ${turn.prise}`));
      const said = el('p', 'said');
      card.append(said);
      if (turn.fresh && !PREFERS_STILL) {
        // Révélation mot à mot : la réplique arrive déjà écrite, mais l'œil
        // voit la pensée se former au lieu d'un bloc qui surgit.
        revealText(said, turn.text, () => { delete turn.fresh; });
      } else {
        said.textContent = turn.text;
        delete turn.fresh;
      }
      if (turn.citations && turn.citations.length) {
        const details = el('details', 'cites');
        details.append(el('summary', null, `Citations vérifiées (${turn.citations.length})`));
        const list = el('ul');
        for (const c of turn.citations) {
          const li = el('li');
          li.append(el('em', null, c.work ? `« ${c.work} »` : 'Œuvre'));
          // La citation s'affiche dans la langue du salon ; l'original reste
          // visible en dessous comme preuve vérifiée.
          const shown = c.translation || c.text || '';
          const original = c.translated ? (c.original || '') : (c.translation ? (c.text || '') : '');
          li.append(document.createTextNode(shown ? ` — « ${shown} »` : ''));
          if (original && original !== shown) {
            li.append(el('span', 'translated', `original : « ${original} »`));
          }
          list.append(li);
        }
        details.append(list);
        card.append(details);
      }
      const degraded = typeof turn.degraded === 'string'
        ? turn.degraded
        : (turn.degraded && (turn.degraded.reason || turn.degraded.to)) || '';
      const bits = [turn.engine, turn.provider, degraded].filter(Boolean);
      if (turn.retrieval && typeof turn.retrieval.coverage === 'number' && turn.retrieval.coverage > 0) {
        bits.push(`couverture ${turn.retrieval.coverage}`);
      }
      if (bits.length) card.append(el('p', 'meta', bits.join(' · ')));
      ui.thread.append(card);
    });
    if (scroll) {
      const last = ui.thread.lastElementChild;
      if (last) last.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
  }

  function renderEvolution() {
    clear(ui.prises);
    ui.turnCount.textContent = `${state.turns.length} tour${state.turns.length > 1 ? 's' : ''}`;
    if (!state.turns.length) {
      ui.phase.textContent = 'La table n’a pas commencé.';
      ui.tensionFill.style.width = '0%';
      ui.tensionLabel.textContent = 'tension —';
      return;
    }
    const tension = tensionOf(state.turns);
    ui.phase.textContent = phaseOf(tension);
    ui.tensionFill.style.width = `${tension}%`;
    ui.tensionLabel.textContent = `tension ${tension}/100`;
    state.turns.forEach((turn, index) => {
      const link = linkOf(turn, state.turns[index - 1]);
      const li = el('li');
      const btn = el('button', 'prise-item');
      btn.type = 'button';
      const top = el('span', 'prise-top');
      top.append(picto(turn.author, 'xs'), el('span', 'p-name', turn.author.name), el('span', `link ${link}`, LINK_LABEL[link] || link));
      btn.append(top, el('span', 'p-text', turn.prise || turn.text.slice(0, 120)));
      btn.addEventListener('click', () => {
        const target = document.getElementById(`turn-${index}`);
        if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      li.append(btn);
      ui.prises.append(li);
    });
  }

  function updateControls() {
    ui.open.disabled = state.busy || state.seated.length < 2;
    ui.debate.disabled = state.busy || !state.question || state.turns.length < 2;
    ui.question.disabled = state.busy;
    ui.seatCount.textContent = `${state.seated.length}/${MAX_SEATS}`;
  }

  /** Sauvegarde serveur du cercle (identifiant anonyme par navigateur). */
  function saveRoom(intent = 'append') {
    if (!state.catalog) return;
    // Une action destructive (recommencer, retirer un convive) doit remplacer
    // l'état distant, pas fusionner : sinon le tour retiré reviendrait.
    if (intent === 'replace') pendingIntent = 'replace';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const intentNow = pendingIntent;
      pendingIntent = 'append';
      const room = {
        id: 'table',
        name: 'Salon',
        question: state.question,
        authorIds: state.seated.map((a) => a.id),
        turns: state.turns.map((t) => ({
          authorId: t.author.id,
          text: t.text,
          prise: t.prise,
          citations: (t.citations || []).slice(0, 4).map((c) => ({
            work: c.work,
            text: c.text,
            ...(c.translation ? { translation: c.translation, translationLang: c.translationLang } : {}),
            ...(c.translated ? { translated: true, original: c.original } : {}),
          })),
          origin: 'agent',
          grounded: true,
          act: t.act,
          to: t.toName || 'l’hôte',
          createdAt: new Date().toISOString(),
        })),
      };
      fetch(`${API}/v1/salon/room?id=${CLIENT_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room,
          intent: intentNow,
          baseUpdatedAt: lastSync ? new Date(lastSync).toISOString() : null,
        }),
        signal: AbortSignal.timeout(8000),
      }).then((r) => r.json()).then((data) => {
        if (!data) return;
        if (data.updatedAt) lastSync = Date.parse(data.updatedAt) || lastSync;
        if (data.merged && data.room) {
          applyRemoteRoom(data.room, data.updatedAt, { keepDraft: true });
          setStatus('cercle fusionné avec un autre onglet');
        }
      }).catch(() => {});
    }, 300);
  }

  /** Applique un cercle serveur (init et synchronisation entre onglets). */
  function applyRemoteRoom(remote, updatedAt, { scroll = false, keepDraft = false } = {}) {
    if (!remote || !state.catalog) return false;
    const published = new Set(Object.keys((state.manifest && state.manifest.authors) || {}));
    const byId = new Map((state.catalog.authors || []).filter((a) => published.has(a.id)).map((a) => [a.id, a]));
    const seated = (remote.authorIds || []).map((id) => byId.get(id)).filter(Boolean).slice(0, MAX_SEATS);
    if (!seated.length) return false;
    // Une synchro ne doit pas effacer une question en cours de frappe.
    const draft = keepDraft && ui.question.value.trim() && ui.question.value.trim() !== state.question.trim()
      ? ui.question.value
      : '';
    state.seated = seated;
    state.question = String(remote.question || '');
    ui.question.value = draft || state.question;
    state.turns = (remote.turns || []).map((t) => {
      const author = byId.get(t.authorId);
      if (!author) return null;
      const to = String(t.to || 'l’hôte');
      const toward = to && !['l’hôte', 'hôte', 'user', 'la table'].includes(to) ? 'author' : 'user';
      return {
        author,
        text: t.text || '',
        prise: t.prise || '',
        citations: t.citations || [],
        act: t.act || 'reponse',
        toward,
        toName: to,
        engine: 'restauré',
        provider: '',
        degraded: '',
        retrieval: null,
      };
    }).filter(Boolean).slice(-500);
    if (updatedAt) lastSync = Date.parse(updatedAt) || lastSync;
    renderSeated(); renderCandidates(); renderQuestion(); renderThread(scroll); renderEvolution(); updateControls();
    return true;
  }

  /** Relit le cercle si un autre onglet/appareil l'a modifié. */
  async function refreshRoom() {
    if (state.busy || document.hidden || !state.catalog) return;
    try {
      const res = await fetch(`${API}/v1/salon/room?id=${CLIENT_ID}`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.room) return;
      const at = Date.parse(data.updatedAt || 0);
      if (!Number.isFinite(at) || at <= lastSync) return;
      if (applyRemoteRoom(data.room, data.updatedAt, { keepDraft: true })) setStatus('cercle synchronisé');
    } catch { /* hors ligne */ }
  }

  async function shareRoom() {
    const url = new URL(window.location.href);
    url.searchParams.set('c', CLIENT_ID);
    url.searchParams.delete('v');
    const text = url.toString();
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Lien du cercle copié.');
    } catch {
      window.prompt('Copiez le lien du cercle :', text);
    }
  }

  /* ------------------------------------------------------------- actions */

  function seat(id) {
    if (state.seated.length >= MAX_SEATS) { setStatus('La table est pleine (4 convives).'); return; }
    if (state.seated.some((a) => a.id === id)) return;
    const author = state.catalog.authors.find((a) => a.id === id);
    if (!author) return;
    state.seated.push(author);
    localStorage.setItem('salon-seated-v2', JSON.stringify(state.seated.map((a) => a.id)));
    renderSeated(); renderCandidates(); updateControls();
    setStatus(`${author.name} prend place.`);
    saveRoom();
  }

  function unseat(id) {
    state.seated = state.seated.filter((a) => a.id !== id);
    localStorage.setItem('salon-seated-v2', JSON.stringify(state.seated.map((a) => a.id)));
    renderSeated(); renderCandidates(); updateControls();
    saveRoom('replace');
  }

  function addTurn(turn) {
    state.turns.push({ ...turn, fresh: true });
    renderThread(true);
    renderEvolution();
    updateControls();
    saveRoom();
  }

  async function callAPI(author, act, toward, toName) {
    const history = state.turns.slice(-6).map((t) => ({ name: t.author.name, text: t.text, prise: t.prise }));
    const res = await fetch(`${API}/v1/salon/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authorId: author.id,
        question: state.question,
        locale: document.documentElement.lang || 'fr',
        history,
        act,
        toward,
        toName,
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.ok || !data.text) return null;
    return data;
  }

  async function speakOne({ author, act, toward, toName }) {
    setStatus(`${author.name} parle…`);
    // Carte d'attente immédiate : sans elle, la table semble figée pendant
    // les quelques secondes de génération.
    showWriting(author, act, toward, toName);
    let data = null;
    try {
      data = await callAPI(author, act, toward, toName);
    } catch {
      data = null;
    }
    hideWriting();
    if (data) {
      addTurn({
        author,
        text: data.text,
        prise: data.prise || '',
        citations: data.citations || [],
        act, toward, toName,
        engine: data.engine || 'llm',
        provider: data.provider || '',
        degraded: data.degraded || '',
        retrieval: data.retrieval || null,
      });
      return;
    }
    const pack = await loadPack(author.id);
    const passages = pack ? retrieveLocal(pack, `${state.question} ${state.turns.at(-1)?.text || ''}`, 5) : [];
    const local = composeLocal({ author, question: state.question, passages, act, toName });
    addTurn({ author, act, toward, toName, ...local });
  }

  async function runRound(kind) {
    if (state.busy || state.seated.length < 2 || !state.question) return;
    state.busy = true;
    updateControls();
    const order = state.seated.slice();
    if (kind === 'debate') order.push(order.shift());
    for (let i = 0; i < order.length; i += 1) {
      const author = order[i];
      const prev = state.turns[state.turns.length - 1];
      let act = 'reponse';
      let toward = 'user';
      let toName = 'l’hôte';
      if (prev) {
        toward = 'author';
        toName = prev.author.name;
        act = i % 2 === 1 ? 'objection' : 'reponse';
      }
      await speakOne({ author, act, toward, toName });
    }
    state.busy = false;
    state.round += 1;
    updateControls();
    setStatus('prêt');
  }

  function resetDebate() {
    if (state.busy) return;
    state.question = '';
    state.turns = [];
    state.round = 0;
    ui.question.value = '';
    renderQuestion(); renderThread(); renderEvolution(); updateControls(); setStatus('prêt');
    saveRoom('replace');
  }

  async function init() {
    try {
      const [catalog, manifest] = await Promise.all([loadJSON('catalog.json'), loadJSON('kb-manifest.json')]);
      state.catalog = catalog;
      state.manifest = manifest;
      // Les portraits sont optionnels : leur absence ne doit pas empêcher la table.
      state.avatars = await loadJSON('avatars.json').catch(() => null);
      const published = new Set(Object.keys((manifest && manifest.authors) || {}));
      const byId = new Map((catalog.authors || []).filter((a) => published.has(a.id)).map((a) => [a.id, a]));

      let remote = null;
      let remoteAt = null;
      try {
        const res = await fetch(`${API}/v1/salon/room?id=${CLIENT_ID}`, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const data = await res.json();
          remote = data.room || null;
          remoteAt = data.updatedAt || null;
        }
      } catch { remote = null; }

      let seatedIds = [];
      try { seatedIds = JSON.parse(localStorage.getItem('salon-seated-v2') || '[]'); } catch { seatedIds = []; }
      if (!Array.isArray(seatedIds) || !seatedIds.length) seatedIds = ['voltaire', 'rousseau', 'montaigne'];
      state.seated = seatedIds.map((id) => byId.get(id)).filter(Boolean).slice(0, MAX_SEATS);

      if (remote && Array.isArray(remote.authorIds)) {
        applyRemoteRoom(remote, remoteAt, { scroll: true });
      }

      if (!state.seated.length) {
        const first = [...byId.values()].slice(0, 2);
        state.seated = first;
      }
      renderSeated(); renderCandidates(); renderCircles(); renderQuestion(); renderThread(); renderEvolution(); updateControls();
      setStatus('prêt');
    } catch (e) {
      clear(ui.thread);
      ui.thread.append(el('p', 'error', `Le Salon n'a pas pu charger sa mémoire : ${e.message}`));
      setStatus('indisponible');
    }
  }

  ui.search.addEventListener('input', renderCandidates);
  if (ui.share) ui.share.addEventListener('click', shareRoom);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshRoom(); });
  window.addEventListener('focus', refreshRoom);
  setInterval(refreshRoom, 15000);
  ui.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const q = ui.question.value.trim();
    if (q.length < 2 || state.seated.length < 2) return;
    state.question = q;
    state.turns = [];
    state.round = 0;
    renderQuestion(); renderThread(); renderEvolution();
    // Nouvelle question = nouvelle table : les tours de l'ancienne question ne
    // doivent pas revenir par fusion depuis un autre onglet.
    saveRoom('replace');
    runRound('open');
  });
  ui.debate.addEventListener('click', () => runRound('debate'));
  ui.reset.addEventListener('click', resetDebate);

  init();
})();
