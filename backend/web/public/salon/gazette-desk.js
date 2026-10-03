/* Gazette — le propos monte du lien, les auteurs répondent.
   Simple par défaut : collez une URL ou le propos puis « Importer le contenu »
   (relève automatique fxtwitter → vxtwitter → oembed pour un lien ; import
   direct pour un texte) ; les auteurs les plus proches répondent depuis leurs
   livres (moteur du Salon + corpus) et l'on peut sélectionner une réponse. */
(function () {
  var FALLBACK = [
    { id: "voltaire", name: "Voltaire", blurb: "L'ironie contre les dogmes.", works: ["Candide, ou l'optimisme", "Zadig", "Micromégas"], kind: "philosophe" },
    { id: "rousseau", name: "Rousseau", blurb: "La sincérité contre les masques.", works: ["Du contrat social", "Émile", "Les Confessions"], kind: "philosophe" },
    { id: "montaigne", name: "Montaigne", blurb: "Que sais-je ?", works: ["Les Essais"], kind: "essayiste" },
    { id: "diderot", name: "Diderot", blurb: "Éclairer, assembler, contredire.", works: ["Le Neveu de Rameau", "Jacques le Fataliste"], kind: "philosophe" },
    { id: "kant", name: "Kant", blurb: "Les limites de la raison.", works: ["Critique de la raison pure", "Critique de la raison pratique"], kind: "philosophe" },
    { id: "pascal", name: "Pascal", blurb: "Grandeur et misère de l'homme.", works: ["Pensées", "Les Provinciales"], kind: "philosophe" },
    { id: "nietzsche", name: "Nietzsche", blurb: "Renverser les idoles.", works: ["Ainsi parlait Zarathoustra", "Par-delà bien et mal"], kind: "philosophe" },
    { id: "platon", name: "Platon", blurb: "L'idée qui juge l'apparence.", works: ["La République", "Le Banquet", "Gorgias"], kind: "philosophe" },
    { id: "aristote", name: "Aristote", blurb: "Le juste milieu.", works: ["Éthique à Nicomaque", "Poétique"], kind: "philosophe" },
    { id: "seneca", name: "Sénèque", blurb: "Se posséder plutôt que posséder.", works: ["Lettres à Lucilius", "De la brièveté de la vie"], kind: "philosophe" },
    { id: "smith", name: "Adam Smith", blurb: "La sympathie et le marché.", works: ["La Richesse des nations", "Théorie des sentiments moraux"], kind: "économiste" },
    { id: "marx", name: "Marx", blurb: "Le rapport sous le discours moral.", works: ["Le Capital", "Manifeste du parti communiste"], kind: "économiste" },
    { id: "hugo", name: "Hugo", blurb: "La misère comme accusation.", works: ["Les Misérables", "Notre-Dame de Paris"], kind: "écrivain" },
    { id: "austen", name: "Jane Austen", blurb: "L'ironie comme scalpel.", works: ["Orgueil et Préjugés", "Emma"], kind: "écrivain" },
    { id: "hume", name: "Hume", blurb: "L'habitude plutôt que la nécessité.", works: ["Enquête sur l'entendement humain"], kind: "philosophe" },
    { id: "locke", name: "Locke", blurb: "L'expérience comme source.", works: ["Essai sur l'entendement humain"], kind: "philosophe" }
  ];
  var DEFAULT_IDS = ["voltaire", "rousseau", "montaigne", "kant"];
  var MAX_VOICES = 4;   // plumes proposées d'office (les plus pertinentes)
  var MAX_TEXTS = 2;    // extraits proposés par plume
  var lastFetched = "";
  var voicesTouched = false;
  var NAME_CACHE = null;

  /* ---------------------------------------------------------------- langues */
  /* Même règle que le reste du Salon : une seule langue à la fois.
     Ordre : salon-locale (stocké par la page principale) → lang du document → fr. */
  function locale() {
    var l = "";
    try { l = localStorage.getItem("salon-locale") || ""; } catch (e) {}
    if (l === "en") return "en";
    if (l === "fr") return "fr";
    try { if (document.documentElement && document.documentElement.lang === "en") return "en"; } catch (e) {}
    return "fr";
  }
  var COPY = {
    fr: {
      pageTitle: "Gazette du Salon",
      sub: "Les auteurs prennent la peau de leurs ouvrages, pour répondre à ce qui arrive.",
      meta: "Feuille du dehors · N° de séance",
      wordsub: "cercles littéraires",
      navCircles: "Cercles", navGazette: "Gazette", navAuthors: "Auteurs", navContact: "Contact",
      missive: "Missive (URL du post)",
      importBtn: "Importer le contenu",
      textLabel: "Texte porté à la table",
      textPh: "Collez le propos — c’est lui que les livres interrogeront.",
      voicesLabel: "Plumes proposées — les plus pertinentes d’abord",
      runBtn: "Demander aux auteurs",
      fetching: "On relève le propos…",
      fetched: "Propos relevé du post.",
      imported: "Propos importé — les auteurs peuvent répondre.",
      badLink: "Lien non reconnu — collez un lien x.com/twitter.com, ou le texte du propos.",
      failed: "Le post n’a pas pu être lu",
      failedPreview: " (aperçu hors-ligne)",
      failedTail: " — collez le texte du propos, puis « Demander aux auteurs ».",
      reading: "Lecture du lien…",
      readOk: "Importé ✓",
      readFail: "Lien non lu",
      noText: "Portez d’abord une missive — un lien, ou le propos.",
      notOnTable: "Le propos n’est pas encore à table — collez-le, ou vérifiez le lien.",
      loneUrl: "Ce lien n’a pas encore livré son texte — « Importer le contenu », ou collez le propos.",
      noMatch: "Rien d’assez proche dans les œuvres chargées — essayez un propos plus concret.",
      answer: "Réponse",
      extract: "Extrait",
      pick: "Sélectionner",
      picked: "Choisie ✓",
      copy: "Copier",
      copied: "Copié.",
      carry: "Porter sur X",
      takenFrom: "Propos repris du post.",
      dateLocale: "fr-FR",
    },
    en: {
      pageTitle: "Salon Gazette",
      sub: "The authors put on the skin of their works, to answer what arrives.",
      meta: "Sheet from outside · Session no.",
      wordsub: "literary circles",
      navCircles: "Circles", navGazette: "Gazette", navAuthors: "Authors", navContact: "Contact",
      missive: "Dispatch (post URL)",
      importBtn: "Fetch the content",
      textLabel: "Text brought to the table",
      textPh: "Paste the statement — the books will question it.",
      voicesLabel: "Proposed pens — most relevant first",
      runBtn: "Ask the authors",
      fetching: "Fetching the statement…",
      fetched: "Statement fetched from the post.",
      imported: "Statement imported — the authors can answer.",
      badLink: "Link not recognized — paste an x.com/twitter.com link, or the statement text.",
      failed: "The post could not be read",
      failedPreview: " (offline preview)",
      failedTail: " — paste the statement text, then “Ask the authors”.",
      reading: "Reading the link…",
      readOk: "Imported ✓",
      readFail: "Link not read",
      noText: "Bring a dispatch first — a link, or the statement.",
      notOnTable: "The statement is not at the table yet — paste it, or check the link.",
      loneUrl: "This link has not delivered its text yet — “Fetch the content”, or paste the statement.",
      noMatch: "Nothing close enough in the loaded works — try a more concrete statement.",
      answer: "Answer",
      extract: "Extract",
      pick: "Select",
      picked: "Chosen ✓",
      copy: "Copy",
      copied: "Copied.",
      carry: "Carry to X",
      takenFrom: "Statement taken from the post.",
      dateLocale: "en-GB",
    },
  };
  function t(key) { var l = locale(); return (COPY[l] || COPY.fr)[key] || COPY.fr[key] || key; }
  function copyFor(l) { return COPY[l] || COPY.fr; }

  function applyCopy() {
    var l = locale();
    try { document.documentElement.lang = l; } catch (e) {}
    try { document.title = t("pageTitle"); } catch (e) {}
    function set(id, val) { var el = document.getElementById(id); if (el && val != null) el.textContent = val; }
    function setPh(id, val) { var el = document.getElementById(id); if (el && val != null) el.placeholder = val; }
    set("gz-sub", t("sub")); set("gz-meta", t("meta")); set("gz-wordsub", t("wordsub"));
    set("gz-nav-circles", t("navCircles")); set("gz-nav-gazette", t("navGazette"));
    set("gz-nav-authors", t("navAuthors")); set("gz-nav-contact", t("navContact"));
    set("gz-url-label", t("missive")); setPh("gz-url", "https://x.com/…/status/…");
    set("gz-import", t("importBtn"));
    set("gz-text-label", t("textLabel")); setPh("gz-text", t("textPh"));
    set("gz-voices-label", t("voicesLabel")); set("gz-run", t("runBtn"));
  }

  /* ---------------------------------------------------------- url & propos */

  function parseStatus(raw) {
    raw = String(raw || "").trim();
    if (/^\d{1,19}$/.test(raw)) return { id: raw, url: "https://x.com/i/web/status/" + raw };
    var m = raw.match(/(?:x\.com|twitter\.com)\/(?:i\/web\/status|([^/\s]+)\/status)\/(\d{1,19})/i);
    if (!m) return null;
    return { id: m[2], handle: m[1] && m[1] !== "i" ? m[1] : "", url: raw.split(/\s/)[0] };
  }
  function extractUrl(text) {
    var m = String(text || "").match(/https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^\s]+/i);
    return m ? m[0] : "";
  }

  function isLoneUrl(s) { return /^https?:\/\/\S+$/i.test(String(s || "").trim()); }

  function note(msg) {
    var el = document.getElementById("gz-note");
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  function clip(s, n) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
  }

  function getJSON(url, timeoutMs) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { try { ctrl && ctrl.abort(); } catch (e) {} }, timeoutMs || 8000);
    return fetch(url, { headers: { accept: "application/json" }, signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error("http " + r.status); return r.json(); },
            function (e) { clearTimeout(timer); throw e; });
  }

  function fetchFx(parsed) {
    return getJSON("https://api.fxtwitter.com/status/" + parsed.id).then(function (data) {
      var tw = data.tweet || data;
      var text = tw.text || tw.full_text || "";
      if (!text) throw new Error("empty");
      var handle = (tw.author && (tw.author.screen_name || tw.author.username)) || parsed.handle || "";
      return { handle: handle, text: text };
    });
  }
  function fetchVx(parsed) {
    return getJSON("https://api.vxtwitter.com/status/" + parsed.id).then(function (data) {
      var text = data.text || data.full_text || "";
      if (!text) throw new Error("empty");
      return { handle: data.user_screen_name || parsed.handle || "", text: text };
    });
  }
  function isManagedPreview() {
    try { return /(^|\.)autoclawai\.space$/i.test(String(location.hostname || "")); } catch (e) { return false; }
  }

  function fetchFixupx(parsed) {
    return getJSON("https://api.fixupx.com/status/" + parsed.id).then(function (data) {
      var tw = data.tweet || data;
      var text = tw.text || tw.full_text || "";
      if (!text) throw new Error("empty");
      var handle = (tw.author && (tw.author.screen_name || tw.author.username)) || parsed.handle || "";
      return { handle: handle, text: text };
    });
  }
  function fetchOembed(parsed) {
    var twUrl = "https://twitter.com/i/web/status/" + parsed.id;
    return getJSON("https://publish.twitter.com/oembed?omit_script=true&hide_thread=true&url=" + encodeURIComponent(twUrl)).then(function (data) {
      var text = textFromOembed(data.html);
      if (!text) throw new Error("empty");
      return { handle: data.author_name || parsed.handle || "", text: text };
    });
  }

  function fetchPost(parsed, force) {
    if (!parsed || !parsed.id) return Promise.resolve(false);
    if (!force && lastFetched === parsed.id) return Promise.resolve(false);
    lastFetched = parsed.id;
    note(t("fetching"));
    return fetchFx(parsed)
      .catch(function () { return fetchVx(parsed); })
      .catch(function () { return fetchFixupx(parsed); })
      .catch(function () { return fetchOembed(parsed); })
      .then(function (hit) {
        if (!hit || !hit.text) throw new Error("empty");
        fillThesis(hit.handle || parsed.handle, hit.text);
        note(t("fetched"));
        return true;
      })
      .catch(function () {
        note(t("failed") + (isManagedPreview() ? t("failedPreview") : "") + t("failedTail"));
        var box = document.getElementById("gz-text");
        if (box && box.focus) { try { box.focus(); } catch (e) {} }
        return false;
      });
  }

  function fillThesis(handle, text) {
    var box = document.getElementById("gz-text");
    if (!box || !text) return;
    var line = (handle ? "@" + String(handle).replace(/^@/, "") + " — " : "") + text;
    box.value = clip(line, 480);
    box.placeholder = t("takenFrom");
  }

  function decodeEntities(text) {
    var MAP = {
      amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " ",
      hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»",
      eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", ecirc: "ê",
      rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”"
    };
    return String(text || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, function (m, code) {
      if (code.charAt(0) === "#") {
        var n = code.charAt(1).toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        if (!isFinite(n) || n <= 0) return m;
        return String.fromCodePoint ? String.fromCodePoint(n) : String.fromCharCode(n);
      }
      var key = code.toLowerCase();
      return MAP[key] !== undefined ? MAP[key] : m;
    });
  }
  function textFromOembed(html) {
    var m = String(html || "").match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (!m) return "";
    return decodeEntities(m[1].replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  }

  /* ------------------------------------------------------ corpus & auteurs */

  function engine() { return (typeof window !== "undefined" && window.SalonEngine) || null; }

  var CORPUS = null;
  var CORPUS_READY = null;
  function loadCorpus() {
    if (CORPUS_READY) return CORPUS_READY;
    CORPUS_READY = fetch("/salon/corpus.json", { cache: "force-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { CORPUS = j || null; return CORPUS; })
      .catch(function () { return null; });
    return CORPUS_READY;
  }

  function customs() {
    var out = [];
    try {
      ["salon-customs", "salon-authors-custom", "kayros-salon-customs"].forEach(function (k) {
        var raw = localStorage.getItem(k); if (!raw) return;
        var parsed = JSON.parse(raw);
        var list = Array.isArray(parsed) ? parsed : parsed.authors || parsed.customs || [];
        list.forEach(function (a) {
          if (a && a.id && a.name) out.push({
            id: String(a.id), name: a.name, blurb: a.blurb || "",
            works: Array.isArray(a.works) ? a.works.map(function (w) { return typeof w === "string" ? w : w.title || ""; }).filter(Boolean) : [],
            kind: a.kind || "invité"
          });
        });
      });
    } catch (e) {}
    return out;
  }
  function catalog() {
    var base = (typeof authors !== "undefined" && authors.length) ? authors : FALLBACK;
    var map = {};
    base.forEach(function (a) {
      map[a.id] = {
        id: a.id, name: a.name || a.id, blurb: a.blurb || "", blurbEn: a.blurbEn || "",
        works: Array.isArray(a.works) ? a.works.map(function (w) { return typeof w === "string" ? w : (w && w.title) || ""; }).filter(Boolean) : [],
        kind: a.kind || ""
      };
    });
    customs().forEach(function (a) { map[a.id] = a; });
    return Object.keys(map).map(function (k) { return map[k]; });
  }
  function loadAuthorsFromSalon(cb) {
    if (typeof authors !== "undefined") { cb(); return; }
    fetch("/salon/", { credentials: "same-origin" }).then(function (r) { return r.text(); }).then(function (html) {
      var m = html.match(/authors\s*=\s*(\[[\s\S]*?\n\s*\]);/);
      if (m) { try { window.authors = (0, eval)("(" + m[1] + ")"); } catch (e) {} }
      cb();
    }).catch(function () { cb(); });
  }
  function names() {
    if (NAME_CACHE) return NAME_CACHE;
    var m = {};
    FALLBACK.forEach(function (a) { m[a.id] = a.name; });
    catalog().forEach(function (a) { m[a.id] = a.name; });
    NAME_CACHE = m;
    return m;
  }
  function kinds() {
    var m = {};
    catalog().forEach(function (a) { m[a.id] = a.kind || ""; });
    return m;
  }
  function authorName(id) {
    var known = names()[id];
    if (known) return known;
    return id.charAt(0).toUpperCase() + id.slice(1);
  }
  function authorKind(id) { return kinds()[id] || ""; }

  /* ------------------------------------------------------ le classement */

  /** Classe les textes de chaque auteur contre le propos ; garde les plus proches. */
  function rankTexts(corpus, query) {
    var E = engine();
    if (!E || !E.retrieve || !E.scope || !corpus || !query) return [];
    var sc = E.scope(query);
    var out = [];
    Object.keys(corpus).forEach(function (aid) {
      var rows = E.retrieve(corpus[aid] || [], sc, MAX_TEXTS).filter(function (p) { return !p.weak; });
      if (!rows.length) return;
      out.push({
        authorId: aid,
        best: rows[0].score,
        rows: rows.map(function (p) {
          return { text: p.sentence || p.text || "", work: p.work || "", score: p.score };
        })
      });
    });
    out.sort(function (a, b) { return (b.best - a.best) || String(a.authorId).localeCompare(String(b.authorId)); });
    return out;
  }

  /* ------------------------------------------------------------- plumes */

  function checkedIds() {
    var out = [];
    document.querySelectorAll("#gz-voices input:checked").forEach(function (el) { out.push(el.value); });
    return out;
  }
  function voicesList(ranked) {
    var cat = catalog();
    var byId = {};
    cat.forEach(function (a) { byId[a.id] = a; });
    var out = [];
    var seen = {};
    (ranked || []).forEach(function (r) {
      var a = byId[r.authorId] || { id: r.authorId, name: authorName(r.authorId) };
      if (!seen[a.id]) { seen[a.id] = 1; out.push(a); }
    });
    cat.forEach(function (a) { if (!seen[a.id]) { seen[a.id] = 1; out.push(a); } });
    return out;
  }
  function paintVoices(ranked) {
    var box = document.getElementById("gz-voices");
    if (!box) return;
    var keep = checkedIds();
    var auto = ranked && !voicesTouched ? ranked.slice(0, MAX_VOICES).map(function (r) { return r.authorId; }) : null;
    var list = voicesList(ranked);
    box.innerHTML = "";
    list.forEach(function (a) {
      var lab = document.createElement("label");
      var input = document.createElement("input");
      input.type = "checkbox";
      input.value = a.id;
      input.checked = auto
        ? auto.indexOf(a.id) !== -1
        : (voicesTouched ? keep.indexOf(a.id) !== -1 : DEFAULT_IDS.indexOf(a.id) !== -1);
      input.addEventListener("change", function () { voicesTouched = true; compose(); });
      lab.appendChild(input);
      lab.appendChild(document.createTextNode(" " + a.name));
      box.appendChild(lab);
    });
  }
  function selected(ranked) {
    var ids = {};
    checkedIds().forEach(function (v) { ids[v] = 1; });
    return (ranked || []).filter(function (r) { return ids[r.authorId]; });
  }

  /* ----------------------------------------------- l'auteur qui répond */

  function authorObject(id) {
    var known = null;
    catalog().forEach(function (a) { if (a.id === id) known = a; });
    var fb = null;
    FALLBACK.forEach(function (a) { if (a.id === id) fb = a; });
    var base = known || fb || { id: id, name: authorName(id) };
    return {
      id: id,
      name: base.name || authorName(id),
      blurb: base.blurb || "",
      blurbEn: base.blurbEn || "",
      works: base.works || [],
      kind: base.kind || "",
    };
  }

  /** Demande à l'auteur de répondre au propos, depuis ses textes les plus proches. */
  function respond(authorId, question, corpus) {
    var E = engine();
    if (!E || !E.answer) return null;
    try {
      var out = E.answer({ author: authorObject(authorId), question: question, corpus: corpus || [], lang: locale() });
      if (!out || !out.text) return null;
      return {
        text: out.text,
        prise: out.prise || "",
        grounded: Boolean(out.grounded),
        work: out.passage && out.passage.work ? out.passage.work : "",
      };
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------ la feuille */

  function intent(text, statusId) {
    var u = "https://x.com/intent/tweet?text=" + encodeURIComponent(text);
    if (statusId) u += "&in_reply_to=" + encodeURIComponent(statusId);
    return u;
  }
  function article(authorId, spoken, statusId) {
    var art = document.createElement("article");
    art.className = "col";
    art.innerHTML = '<p class="rubric">' + (spoken.response ? t("answer") : t("extract")) + '</p><h2></h2><p></p><cite></cite>' +
      '<p class="acts"><button type="button" data-act="pick">' + t("pick") + '</button><button type="button" data-act="copy">' + t("copy") + '</button><button type="button" data-act="x">' + t("carry") + '</button></p>';
    art.querySelector("h2").textContent = authorName(authorId);
    var ps = art.querySelectorAll("p");
    ps[1].textContent = spoken.text;
    var kind = authorKind(authorId);
    var work = spoken.passage && spoken.passage.work ? spoken.passage.work : "";
    var citeBits = [];
    if (work) citeBits.push(work);
    if (kind) citeBits.push(kind);
    art.querySelector("cite").textContent = citeBits.join(" · ");
    var acts = art.querySelector(".acts");
    acts.querySelector('[data-act="pick"]').addEventListener("click", function () {
      var wasPicked = art.classList.contains("is-picked");
      document.querySelectorAll("#fx-gazette article.is-picked").forEach(function (el) {
        el.classList.remove("is-picked");
        var b = el.querySelector('[data-act="pick"]');
        if (b) b.textContent = t("pick");
      });
      if (!wasPicked) {
        art.classList.add("is-picked");
        this.textContent = t("picked");
      }
    });
    acts.querySelector('[data-act="copy"]').addEventListener("click", function () {
      if (navigator.clipboard && spoken.text) navigator.clipboard.writeText(spoken.text).catch(function () {});
      this.textContent = t("copied");
    });
    acts.querySelector('[data-act="x"]').addEventListener("click", function () {
      if (navigator.clipboard && spoken.text) navigator.clipboard.writeText(spoken.text).catch(function () {});
      window.open(intent(spoken.text, statusId), "_blank", "noopener,noreferrer");
    });
    return art;
  }

  function compose() {
    var folio = document.getElementById("fx-gazette");
    if (!folio) return Promise.resolve();
    var box = document.getElementById("gz-text");
    var urlBox = document.getElementById("gz-url");
    var thesis = box ? box.value.trim() : "";
    var parsed = urlBox ? parseStatus(urlBox.value) : null;
    if (!thesis || isLoneUrl(thesis)) {
      var msg;
      if (isLoneUrl(thesis)) msg = t("loneUrl");
      else if (parsed) msg = t("notOnTable");
      else msg = t("noText");
      folio.innerHTML = '<p class="empty">' + msg + "</p>";
      return Promise.resolve();
    }
    return loadCorpus().then(function (corpus) {
      var ranked = rankTexts(corpus || {}, thesis);
      if (!ranked.length) {
        folio.innerHTML = '<p class="empty">' + t("noMatch") + "</p>";
        return;
      }
      paintVoices(ranked);
      var picks = selected(ranked);
      if (!picks.length) picks = ranked.slice(0, MAX_VOICES);
      folio.innerHTML = "";
      picks.forEach(function (cand) {
        var out = respond(cand.authorId, thesis, corpus[cand.authorId] || []);
        var text = out && out.text ? out.text : (cand.rows[0] ? cand.rows[0].text : "");
        if (!text) return;
        folio.appendChild(article(cand.authorId, {
          text: text,
          response: Boolean(out && out.text),
          passage: { work: (out && out.work) || (cand.rows[0] && cand.rows[0].work) || "" },
        }, parsed && parsed.id));
      });
    });
  }

  function reveal() {
    var folio = document.getElementById("fx-gazette");
    if (folio && folio.scrollIntoView) {
      try { folio.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { folio.scrollIntoView(); }
    }
  }
  function fetchAndCompose(parsed, force, scroll) {
    return fetchPost(parsed, force).then(function (ok) {
      return compose().then(function () { if (scroll) reveal(); return ok; });
    });
  }
  function ingestThenCompose(force, scroll) {
    var urlBox = document.getElementById("gz-url");
    var raw = urlBox ? urlBox.value.trim() : "";
    var parsed = raw ? parseStatus(raw) : null;
    if (parsed) return fetchAndCompose(parsed, force, scroll);
    // Le lien peut aussi avoir été collé dans le champ du texte : on le relève quand même.
    var tbox = document.getElementById("gz-text");
    var tparsed = tbox ? parseStatus(extractUrl(tbox.value)) : null;
    if (tparsed) return fetchAndCompose(tparsed, force, scroll);
    if (/https?:\/\//i.test(raw)) {
      note(t("badLink"));
      return compose().then(function () { return false; });
    }
    if (raw.length >= 8) {
      // Propos collé directement : on l'importe dans le texte porté à la table.
      var box = document.getElementById("gz-text");
      if (box && raw !== box.value.trim()) {
        box.value = clip(raw, 480);
        note(t("imported"));
      }
      return compose().then(function () { if (scroll) reveal(); return true; });
    }
    return compose().then(function () { return false; });
  }

  /* --------------------------------------------------------------- amorce */

  function boot() {
    applyCopy();
    var d = document.getElementById("gz-date");
    if (d) d.textContent = new Date().toLocaleDateString(t("dateLocale"), { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    loadCorpus();
    loadAuthorsFromSalon(function () { NAME_CACHE = null; paintVoices(); });
    var run = document.getElementById("gz-run");
    if (run && !run.getAttribute("data-bound")) {
      run.setAttribute("data-bound", "1");
      run.addEventListener("click", function () { ingestThenCompose(true); });
    }
    var imp = document.getElementById("gz-import");
    if (imp && !imp.getAttribute("data-bound")) {
      imp.setAttribute("data-bound", "1");
      imp.addEventListener("click", function () {
        var btn = this;
        if (btn.getAttribute("data-busy")) return;
        btn.setAttribute("data-busy", "1");
        btn.textContent = t("reading");
        ingestThenCompose(true, true).then(function (ok) {
          btn.removeAttribute("data-busy");
          btn.textContent = ok ? t("readOk") : t("readFail");
          setTimeout(function () { btn.textContent = t("importBtn"); }, 2600);
        }, function () {
          btn.removeAttribute("data-busy");
          btn.textContent = t("importBtn");
        });
      });
    }
    var url = document.getElementById("gz-url");
    if (url && !url.getAttribute("data-ingest")) {
      url.setAttribute("data-ingest", "1");
      var t1 = 0;
      function schedule() { clearTimeout(t1); t1 = setTimeout(function () { ingestThenCompose(false); }, 300); }
      url.addEventListener("paste", function () { setTimeout(function () { ingestThenCompose(false); }, 40); });
      url.addEventListener("input", schedule);
      url.addEventListener("change", schedule);
    }
    var box = document.getElementById("gz-text");
    if (box && !box.getAttribute("data-ingest")) {
      box.setAttribute("data-ingest", "1");
      var t2 = 0;
      box.addEventListener("input", function () {
        clearTimeout(t2);
        t2 = setTimeout(function () {
          var url = extractUrl(box.value);
          var parsed = url ? parseStatus(url) : null;
          if (parsed) fetchAndCompose(parsed, false);
          else compose();
        }, 400);
      });
    }
  }

  /* ---------------------------------------------------- exports (tests) */

  var API = { parseStatus: parseStatus, rankTexts: rankTexts, respond: respond, isLoneUrl: isLoneUrl, copyFor: copyFor, locale: locale, textFromOembed: textFromOembed, decodeEntities: decodeEntities };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SalonGazette = API;

  if (typeof document === "undefined") return;
  if (!/\/salon\/flux\/?$/.test(location.pathname.replace(/index\.html$/, ""))) return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
