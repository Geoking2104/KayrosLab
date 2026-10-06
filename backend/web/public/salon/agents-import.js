/* Salon #agents — import Gutenberg (OPDS), proposition auto, validation.
 *
 * Recherche : catalogue ouvert Project Gutenberg via OPDS (CORS ouvert),
 * avec hypothèses de nom (requêtes relâchées + distance d'édition) quand
 * l'orthographe hésite. Œuvres : flux de l'auteur (/ebooks/author/<id>.opds).
 * Textes : relais api.kayroslab.com (/v1/salon/gutenberg/text) car les .txt
 * de gutenberg.org n'envoient pas d'en-tête CORS ; repli direct puis proxy.
 * Il faut six œuvres pour caractériser la personnalité de l'agent.
 */
(function () {
  var REQUIRED_WORKS = 6;
  var OPDS = "https://www.gutenberg.org";
  var API = (typeof SALON_API === "string" && SALON_API) ? SALON_API : "https://api.kayroslab.com";
  var draft = null;

  function boot() {
    if (typeof authors === "undefined" || !document.getElementById("agents")) { setTimeout(boot, 40); return; }
    enhanceAgentsPane(); paintCatalogCount();
    var note = document.getElementById("import-preview-note");
    if (note) { try { if (/(^|\.)autoclawai\.space$/i.test(String(location.hostname || ""))) note.hidden = false; } catch (e) {} }
  }
  function paintCatalogCount() {
    if (typeof authors === "undefined" || typeof msg !== "function") return;
    var n = authors.length;
    if (I18N && I18N.fr && I18N.fr["circle.what"]) I18N.fr["circle.what"] = I18N.fr["circle.what"].replace("54 déjà", "{n} déjà");
    if (I18N && I18N.en && I18N.en["circle.what"]) I18N.en["circle.what"] = I18N.en["circle.what"].replace("54 already", "{n} already");
    document.querySelectorAll('[data-i18n="flows"], [data-i18n="circle.what"]').forEach(function (el) {
      el.dataset.n = String(n); el.textContent = msg(el.getAttribute("data-i18n"), { n: n });
    });
    var nEl = document.getElementById("agent-n"); var q = document.getElementById("agent-q"); var k = document.getElementById("agent-kind");
    if (nEl && !(q && q.value) && !(k && k.value)) nEl.textContent = String(n);
  }
  function enhanceAgentsPane() {
    var cta = document.getElementById("add-author"); if (cta) { cta.hidden = true; cta.style.display = "none"; }
    var form = document.getElementById("create-author");
    if (form) { form.hidden = false; var cancel = document.getElementById("create-cancel"); if (cancel) cancel.hidden = true; ensureVisualField(form); }
    if (!document.getElementById("import-author")) injectImportBox(form);
    bindImport();
    if (form && !form.dataset.catalogHook) {
      form.dataset.catalogHook = "1";
      form.addEventListener("submit", function () {
        setTimeout(function () {
          form.hidden = false;
          var handleEl = form.querySelector('[name="handle"]');
          var handle = handleEl ? String(handleEl.value || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "") : "";
          var added = authors.filter(function (a) { return a.id === handle; }).pop() || authors[authors.length - 1];
          if (added && draft) {
            added.works = draft.works || added.works; added.memory = draft.memory || added.memory; added.source = "gutenberg";
            added.nameEn = draft.nameEn || added.nameEn; added.eraEn = draft.era || added.eraEn;
            added.blurbEn = draft.blurbEn || added.blurbEn; added.blurbFr = draft.blurbFr || added.blurbFr;
            var avatarInput = form.querySelector('[name="avatar"]');
            added.avatar = (avatarInput && avatarInput.value.trim()) || draft.avatar || added.avatar || "";
            added.monogram = (added.name || "?").slice(0, 1).toUpperCase(); draft = null;
          } else if (added) {
            var av = form.querySelector('[name="avatar"]'); if (av && av.value.trim()) added.avatar = av.value.trim();
          }
          try { if (typeof persistSoon === "function") persistSoon(); } catch (e) {}
          try { if (typeof renderGuests === "function") renderGuests(); } catch (e) {}
          try { if (typeof renderAgents === "function") renderAgents(); } catch (e) {}
          paintCatalogCount();
        }, 0);
      });
    }
    if (typeof renderAgents === "function" && !renderAgents.__catalogWrapped) { var prev = renderAgents; renderAgents = function () { prev(); paintCatalogCount(); }; renderAgents.__catalogWrapped = true; }
    if (typeof applyI18n === "function" && !applyI18n.__catalogWrapped) {
      var prevI18n = applyI18n;
      applyI18n = function () {
        document.querySelectorAll('[data-i18n="flows"], [data-i18n="circle.what"]').forEach(function (el) { el.dataset.n = String(authors.length); });
        prevI18n(); paintCatalogCount();
      }; applyI18n.__catalogWrapped = true;
    }
  }
  function ensureVisualField(form) {
    if (form.querySelector('[name="avatar"]')) return;
    var box = document.createElement("div"); box.className = "portrait-edit"; box.id = "create-visual";
    box.innerHTML = "<span class=\"portrait-label\">Visuel du profil</span><div class=\"portrait-row\"><div class=\"portrait-frame\"><img id=\"create-portrait-img\" alt=\"Proposition de portrait\" /></div><label class=\"portrait-url\"><span>Source</span><input name=\"avatar\" type=\"url\" maxlength=\"400\" placeholder=\"URL proposée\" /></label></div><p class=\"import-meta\" id=\"create-propose-note\" hidden>Proposition automatique à relire avant de publier.</p>";
    var note = form.querySelector(".create-note"); if (note) form.insertBefore(box, note); else form.insertBefore(box, form.querySelector(".row"));
    var img = box.querySelector("img"); var input = box.querySelector("input");
    input.addEventListener("input", function () { if (input.value.trim()) img.src = input.value.trim(); });
  }
  function injectImportBox(form) {
    var box = document.createElement("div"); box.className = "import-box"; box.id = "import-author";
    box.innerHTML = "<h2>Importer un auteur du domaine public</h2><p class=\"hint\">Catalogue ouvert Project Gutenberg. Cherchez un auteur : si l'orthographe hésite, le module propose les noms les plus proches. Choisissez ensuite <strong>six œuvres</strong> (Gutenberg ou fichiers .txt) : elles complètent le catalogue et deviennent la mémoire de l'agent. L'identité (nom, @, époque, résumé, visuel) est ensuite proposée automatiquement — vous la corrigez et vous la validez.</p><form id=\"import-search\" class=\"row\"><input id=\"import-q\" type=\"search\" minlength=\"2\" required placeholder=\"Hugo, Austen, Montesquieu\" /><button class=\"btn\" type=\"submit\">Chercher</button></form><p class=\"import-meta\" id=\"import-status\" hidden></p><p class=\"err\" id=\"import-error\" hidden></p><p class=\"import-meta\" id=\"import-preview-note\" hidden>Aperçu hébergé : les appels à Gutenberg et au relais texte y sont bloqués — l'import fonctionne sur le site public (kayroslab.com).</p><p class=\"import-meta\" id=\"import-authors-head\" hidden></p><ul class=\"import-hits\" id=\"import-authors\" hidden></ul><div id=\"import-pick\" hidden><p class=\"import-meta\" id=\"import-pick-head\"></p><ul class=\"import-works\" id=\"import-works\"></ul><div class=\"row import-local-row\"><label class=\"btn import-file-label\">Ajouter des fichiers .txt<input type=\"file\" id=\"import-file\" accept=\".txt,text/plain\" multiple hidden /></label><span class=\"import-meta\" id=\"import-local-count\"></span></div><ul class=\"import-works\" id=\"import-local-list\"></ul><div class=\"row\" style=\"margin-top:0.7rem\"><button class=\"btn\" type=\"button\" id=\"import-commit\" disabled>Proposer la fiche</button></div></div>";
    var style = document.createElement("style");
    style.textContent = ".import-box{margin:0 0 1.15rem;padding:1rem 1.1rem 1.15rem;border:1px solid color-mix(in oklch,var(--ink) 14%,transparent);background:color-mix(in oklch,var(--paper) 92%,var(--accent));}.import-box h2{margin:0 0 .35rem;font-size:1.15rem}.import-box .hint,.import-meta{color:var(--muted);font-size:.92rem}.import-box .row,.portrait-row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}.import-box input[type=search]{flex:1;min-width:12rem}.import-hits,.import-works{list-style:none;margin:.7rem 0 0;padding:0;display:grid;gap:.28rem}.import-hits button{width:100%;text-align:left;background:transparent;border:1px solid color-mix(in oklch,var(--ink) 12%,transparent);padding:.45rem .6rem;cursor:pointer;color:inherit;font:inherit}.import-hits button.is-on,.import-hits button:hover{border-color:var(--accent)}.import-hits button span,.import-works small{display:block;color:var(--muted);font-size:.82rem}.import-works label{display:flex;gap:.55rem;align-items:flex-start;padding:.28rem 0}.import-local-row{gap:.7rem;margin-top:.5rem}.import-file-label{cursor:pointer;display:inline-flex;align-items:center}.import-local-list button{background:transparent;border:0;color:#8b1e1e;cursor:pointer;font:inherit;padding:0 .3rem}.import-box .err{color:#8b1e1e;margin:.5rem 0 0}#add-author{display:none!important}#create-author{display:grid!important}#create-cancel{display:none!important}.portrait-edit{margin:.85rem 0 .4rem}.portrait-label{display:block;font-size:.82rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-bottom:.4rem}.portrait-frame{width:72px;height:72px;border-radius:50%;overflow:hidden;background:color-mix(in oklch,var(--ink) 8%,var(--paper));flex:0 0 72px}.portrait-frame img{width:100%;height:100%;object-fit:cover;display:block}.portrait-url{flex:1;min-width:12rem}";
    document.head.appendChild(style);
    if (form && form.parentNode) form.parentNode.insertBefore(box, form);
    else { var agents = document.getElementById("agents"); if (agents) agents.insertBefore(box, agents.children[1] || null); }
  }

  /* ------------------------------------------------- recherche : OPDS + hypothèses */

  function stripAccents(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
  function normName(s) { return stripAccents(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }
  function levDist(a, b) {
    a = String(a); b = String(b);
    if (!a.length) return b.length; if (!b.length) return a.length;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur.slice();
    }
    return prev[b.length];
  }
  function tokenSim(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (b.indexOf(a) === 0 || a.indexOf(b) === 0) return Math.max(Math.min(a.length, b.length) / Math.max(a.length, b.length), 0.7);
    return 1 - levDist(a, b) / Math.max(a.length, b.length);
  }
  function scoreName(query, name) {
    var q = normName(query), n = normName(name);
    if (!q || !n) return 0;
    if (q === n) return 1;
    var qt = q.split(" ").filter(function (w) { return w.length > 1; });
    var nt = n.split(" ").filter(Boolean);
    if (!qt.length || !nt.length) return 0;
    var scores = qt.map(function (t) {
      var best = 0;
      nt.forEach(function (x) { var s = tokenSim(t, x); if (s > best) best = s; });
      return best;
    });
    var minTok = Math.min.apply(null, scores);
    var avgTok = scores.reduce(function (a, b) { return a + b; }, 0) / scores.length;
    var score = 0.5 * minTok + 0.5 * avgTok;
    var allTok = qt.every(function (t) { return nt.some(function (x) { return x.indexOf(t) === 0; }); });
    if (allTok) score = Math.max(score, 0.85);
    return Math.min(score, 1);
  }
  function queryVariants(q) {
    var out = [];
    function add(s) { s = String(s || "").trim(); if (s.length >= 2 && out.indexOf(s) < 0) out.push(s); }
    add(q);
    var noAcc = stripAccents(q).replace(/\s+/g, " ").trim();
    add(noAcc);
    var words = noAcc.split(" ").filter(Boolean);
    if (words.length > 1) { add(words[0]); add(words[words.length - 1]); }
    var last = words[words.length - 1] || "";
    for (var cut = 1; cut <= 3; cut++) if (last.length - cut >= 3) add(last.slice(0, last.length - cut));
    return out.slice(0, 6);
  }
  function parseFeed(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, "application/xml");
    var entries = Array.prototype.slice.call(doc.querySelectorAll("entry")).map(function (en) {
      var id = (en.querySelector("id") || {}).textContent || "";
      var m = id.match(/\/ebooks\/(\d+)\.opds/);
      var title = ((en.querySelector("title") || {}).textContent || "").trim();
      var creator = ((en.querySelector('content[type="text"]') || {}).textContent || "").trim();
      var authorHref = "";
      var links = en.querySelectorAll('link[href*="/ebooks/author/"]');
      if (links.length) authorHref = links[0].getAttribute("href") || "";
      return { id: m ? m[1] : "", title: title, creator: creator, authorHref: authorHref };
    }).filter(function (e) { return e.id && !/^(See also|Authors|Subjects|Books)$/i.test(e.title); });
    var next = doc.querySelector('link[rel="next"]');
    return { entries: entries, next: next ? (next.getAttribute("href") || "") : "" };
  }
  function fetchFeed(url) {
    return fetch(url, { headers: { accept: "application/atom+xml,application/xml;q=0.9,*/*;q=0.8" } })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.text(); })
      .then(parseFeed);
  }
  function setErr(t) { var el = document.getElementById("import-error"); if (!el) return; el.hidden = !t; el.textContent = t || ""; }
  function setSt(t) { var el = document.getElementById("import-status"); if (!el) return; el.hidden = !t; el.textContent = t || ""; }
  function escLocal(s) { if (typeof esc === "function") return esc(s); return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function displayName(gutenbergName) { return String(gutenbergName || "").replace(/^([^,]+),\s*(.+)$/, "$2 $1").trim(); }
  function slugHandle(name) { return String(name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").slice(0, 18) || "auteur"; }
  function uniqueHandle(base) { var id = base, n = 2; while (authors.some(function (a) { return a.id === id; })) { id = base + n; n += 1; } return id; }
  function firstSentences(text, maxLen) {
    var clean = String(text || "").replace(/\r/g, "\n").replace(/^\s*(\*\*\*|---+|The Project Gutenberg).*$/gim, "").replace(/\[[0-9]+\]/g, "").replace(/\s+/g, " ").trim();
    if (!clean) return "";
    var parts = clean.split(/[.!?]\s+/).filter(function (s) { return s.length > 40 && !/gutenberg|ebook|copyright/i.test(s); });
    var out = (parts.slice(0, 2).join(" ") || clean).slice(0, maxLen);
    return out.replace(/\s+\S*$/, "") + (out.length >= maxLen ? "..." : "");
  }
  function sampleFromText(raw) {
    var t = String(raw || "").replace(/\r/g, "");
    var m = t.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG/i);
    if (m >= 0) t = t.slice(m + 80);
    else { var cut = t.indexOf("\n\n\n"); if (cut > 0 && cut < 6000) t = t.slice(cut); }
    return t.replace(/\s+/g, " ").trim().slice(0, 1400);
  }
  function yearsFromText(s) {
    var ys = String(s || "").match(/\b1[0-9]{3}\b|\b20[0-2][0-9]\b/g) || [];
    var u = Array.from(new Set(ys.map(Number))).sort(function (a, b) { return a - b; });
    if (u.length >= 2) return u[0] + "-" + u[u.length - 1];
    if (u.length === 1) return String(u[0]);
    return "";
  }
  function trLangOf(s) {
    var t = String(s || "");
    var fr = (t.match(/[àâçéèêëîïôùûüÿœ]/gi) || []).length * 3 + (t.match(/\b(le|la|les|des|une?|est|nous|vous|dans|pour|qui|que|pas)\b/gi) || []).length;
    var en = (t.match(/\b(the|of|and|to|in|that|is|it|with|for|as|not)\b/gi) || []).length;
    return fr > en ? "fr" : "en";
  }
  function curLocale() {
    try { var s = localStorage.getItem("salon-locale"); if (s === "en" || s === "fr") return s; } catch (e) {}
    try { return (document.documentElement.getAttribute("lang") || "fr").slice(0, 2) === "en" ? "en" : "fr"; } catch (e) {}
    return "fr";
  }
  function L(fr, en) { return curLocale() === "en" ? en : fr; }
  /* Traduit côté serveur avant d'importer : la mémoire livrée est bilingue. */
  function translateTexts(texts, to) {
    if (!texts || !texts.length) return Promise.resolve(null);
    return fetch(API + "/v1/salon/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: to, texts: texts }),
      signal: AbortSignal.timeout(60000),
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (j && j.ok && Array.isArray(j.translations) && j.translations.length === texts.length) return j.translations;
      return null;
    }).then(function (trs) {
      if (!trs) return null;
      // Un fournisseur dégradé (mock) ne doit jamais devenir une « traduction » livrée.
      return trs.map(function (t) { return (t && !/^\[mock\]/i.test(String(t))) ? t : null; });
    }).catch(function () { return null; });
  }
  function gutenbergText(id) {
    var direct = "https://www.gutenberg.org/cache/epub/" + id + "/pg" + id + ".txt";
    var tries = [
      function () { return fetch(API + "/v1/salon/gutenberg/text?id=" + id, { signal: AbortSignal.timeout(20000) }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { if (j && j.ok && j.text) return j.text; throw new Error("relais"); }); },
      function () { return fetch(direct).then(function (r) { if (!r.ok) throw new Error("direct"); return r.text(); }); },
      function () { return fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(direct)).then(function (r) { if (!r.ok) throw new Error("proxy"); return r.text(); }); },
    ];
    var p = Promise.reject(new Error("relais"));
    tries.forEach(function (f) { p = p.catch(f); });
    return p;
  }
  function wikiLookup(name) {
    var titles = [name, name.replace(/^([^,]+),\s*(.+)$/, "$2 $1")]; var langs = ["fr", "en"]; var chain = Promise.resolve(null);
    langs.forEach(function (lang) { titles.forEach(function (title) {
      chain = chain.then(function (hit) {
        if (hit) return hit;
        return fetch("https://" + lang + ".wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title)).then(function (res) { return res.ok ? res.json() : null; }).catch(function () { return null; }).then(function (json) {
          if (!json || json.type === "disambiguation" || !json.extract) return null;
          return { extract: json.extract, thumb: json.thumbnail && json.thumbnail.source, title: json.title, lang: lang };
        });
      });
    }); });
    return chain;
  }
  function proposeIntoForm(proposal) {
    var form = document.getElementById("create-author"); if (!form) return; form.hidden = false;
    var name = form.querySelector('[name="name"]'); var handle = form.querySelector('[name="handle"]');
    var era = form.querySelector('[name="era"]'); var blurb = form.querySelector('[name="blurb"]');
    var avatar = form.querySelector('[name="avatar"]'); var img = document.getElementById("create-portrait-img");
    if (name) name.value = proposal.name; if (handle) handle.value = proposal.handle;
    if (era) era.value = proposal.era; if (blurb) blurb.value = proposal.blurb;
    if (avatar) avatar.value = proposal.avatar || "";
    if (img) { if (proposal.avatar) img.src = proposal.avatar; else img.removeAttribute("src"); }
    var note = document.getElementById("create-propose-note");
    if (note) { note.hidden = false; note.textContent = "Proposition automatique. Corrigez puis validez avec Convier."; }
    var title = form.querySelector("h2"); if (title) title.textContent = "Valider la fiche proposée";
    form.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  /* ------------------------------------------------------------- onglets */

  function bindImport() {
    if (bindImport.done) return; bindImport.done = true;
    var state = { authors: [], selected: null, works: [], local: [], texts: {} };

    function totalSelected() {
      return document.querySelectorAll("#import-works input[type=checkbox]:checked").length + state.local.length;
    }
    function updateCommit() {
      var btn = document.getElementById("import-commit");
      if (btn) btn.disabled = totalSelected() !== REQUIRED_WORKS;
      var lc = document.getElementById("import-local-count");
      if (lc) lc.textContent = state.local.length ? (state.local.length + " fichier(s) local(aux)") : "";
    }
    function renderLocal() {
      var ul = document.getElementById("import-local-list");
      if (ul) ul.innerHTML = state.local.map(function (f, i) {
        return "<li><span>" + escLocal(f.title) + " <small>fichier local</small></span> <button type=\"button\" data-local=\"" + i + "\" aria-label=\"Retirer\">×</button></li>";
      }).join("");
      updateCommit();
    }

    document.getElementById("import-search").addEventListener("submit", function (e) {
      e.preventDefault();
      var q = String((document.getElementById("import-q") || {}).value || "").trim(); if (q.length < 2) return;
      setErr(""); setSt("Recherche dans le catalogue Gutenberg…");
      var list = document.getElementById("import-authors"); var pick = document.getElementById("import-pick");
      var head = document.getElementById("import-authors-head");
      if (list) list.hidden = true; if (pick) pick.hidden = true; if (head) head.hidden = true;
      var variants = queryVariants(q);
      Promise.all(variants.map(function (qv) {
        return fetchFeed(OPDS + "/ebooks/search.opds/?query=" + encodeURIComponent(qv)).catch(function () { return { entries: [], next: "" }; });
      })).then(function (packs) {
        if (!packs.some(function (p) { return p.entries.length; })) throw new Error("vide");
        var by = {};
        packs.forEach(function (p) {
          p.entries.forEach(function (en) {
            if (!en.creator) return;
            var key = normName(en.creator);
            if (!by[key]) by[key] = { name: en.creator, books: [], seen: {} };
            var a = by[key];
            if (a.seen[en.id]) return;
            a.seen[en.id] = 1;
            a.books.push({ id: en.id, title: en.title });
          });
        });
        var rows = Object.keys(by).map(function (k) {
          var a = by[k]; a.score = scoreName(q, a.name); return a;
        }).sort(function (a, b) { return (b.score - a.score) || (b.books.length - a.books.length); }).slice(0, 10);
        state.authors = rows;
        if (!rows.length) { setSt(""); setErr("Aucun auteur trouvé. Vérifiez l'orthographe, ou essayez le nom seul (ex. « Hugo »)."); return; }
        var best = rows[0].score;
        head.hidden = false;
        head.textContent = best < 0.72
          ? "Nom incertain — hypothèses les plus proches :"
          : (best < 0.9 ? "Résultats proches — corrigez le nom si besoin :" : rows.length + " auteur(s) trouvé(s) :");
        list.innerHTML = rows.map(function (a, i) {
          var pct = Math.round(a.score * 100);
          return "<li><button type=\"button\" data-i=\"" + i + "\">" + escLocal(a.name) + "<span>" + a.books.length + " œuvre(s) au catalogue" + (pct < 100 ? " · correspondance " + pct + " %" : "") + "</span></button></li>";
        }).join("");
        list.hidden = false; setSt("");
      }).catch(function () { setSt(""); setErr("Le catalogue Gutenberg n'a pas répondu. Réessayez dans un instant."); });
    });

    document.getElementById("import-authors").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-i]"); if (!btn) return;
      document.querySelectorAll("#import-authors button").forEach(function (b) { b.classList.toggle("is-on", b === btn); });
      var picked = state.authors[Number(btn.dataset.i)]; if (!picked) return;
      state.selected = picked; state.local = []; state.texts = {};
      renderLocal();
      var pick = document.getElementById("import-pick"); pick.hidden = false;
      document.getElementById("import-pick-head").textContent = "Œuvres de " + picked.name + " — cochez " + REQUIRED_WORKS + " (ou ajoutez des fichiers)";
      var worksUl = document.getElementById("import-works");
      worksUl.innerHTML = ""; document.getElementById("import-commit").disabled = true;
      setSt("Recherche des œuvres…");
      var first = picked.books[0];
      var authorId = null;
      fetchFeed(OPDS + "/ebooks/" + first.id + ".opds").then(function (bf) {
        var href = bf.entries[0] && bf.entries[0].authorHref;
        var m = href && href.match(/author\/(\d+)\.opds/);
        authorId = m ? m[1] : null;
        if (!authorId) return null;
        return fetchFeed(OPDS + "/ebooks/author/" + authorId + ".opds");
      }).then(function (af) {
        var works = [];
        var seen = {};
        if (af) {
          af.entries.forEach(function (en) { if (en.creator && normName(en.creator) && !seen[en.id]) { seen[en.id] = 1; works.push({ id: en.id, title: en.title }); } });
          if (works.length < REQUIRED_WORKS && af.next) {
            return fetchFeed(OPDS + af.next).then(function (af2) {
              af2.entries.forEach(function (en) { if (!seen[en.id]) { seen[en.id] = 1; works.push({ id: en.id, title: en.title }); } });
              return works;
            });
          }
        } else {
          picked.books.forEach(function (b) { if (!seen[b.id]) { seen[b.id] = 1; works.push(b); } });
        }
        return works;
      }).then(function (works) {
        state.works = works.slice(0, 40);
        worksUl.innerHTML = state.works.map(function (w, i) {
          return "<li><label><input type=\"checkbox\" data-i=\"" + i + "\" /><span>" + escLocal(w.title) + "<small>Gutenberg #" + w.id + "</small></span></label></li>";
        }).join("");
        updateCommit();
        setSt(works.length >= REQUIRED_WORKS
          ? (works.length + " œuvres trouvées — cochez-en " + REQUIRED_WORKS + ".")
          : (works.length + " œuvre(s) trouvée(s) seulement — il en faut " + REQUIRED_WORKS + " pour caractériser la personnalité. Ajoutez des fichiers .txt si besoin."));
      }).catch(function () { setErr("Les œuvres de cet auteur n'ont pas pu être listées."); setSt(""); });
    });

    document.getElementById("import-works").addEventListener("change", function () {
      var boxes = Array.prototype.slice.call(document.querySelectorAll("#import-works input[type=checkbox]"));
      var checked = boxes.filter(function (b) { return b.checked; });
      var allowed = REQUIRED_WORKS - state.local.length;
      if (checked.length > allowed) checked.slice(Math.max(allowed, 0)).forEach(function (b) { b.checked = false; });
      updateCommit();
    });

    document.getElementById("import-file").addEventListener("change", function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      e.target.value = "";
      setErr("");
      var room = REQUIRED_WORKS - totalSelected();
      if (files.length > room) { setErr("Six œuvres au total — retirez une sélection avant d'ajouter d'autres fichiers."); files = files.slice(0, Math.max(room, 0)); }
      var chain = Promise.resolve();
      files.forEach(function (f) {
        chain = chain.then(function () {
          return f.text().then(function (raw) {
            state.local.push({ title: f.name.replace(/\.txt$/i, ""), text: String(raw || "") });
            renderLocal();
          });
        });
      });
      chain.catch(function () { setErr("Un fichier n'a pas pu être lu."); });
    });

    document.getElementById("import-local-list").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-local]"); if (!btn) return;
      state.local.splice(Number(btn.dataset.local), 1);
      renderLocal();
    });

    document.getElementById("import-commit").addEventListener("click", function () {
      var picked = state.selected; if (!picked) return;
      var picks = Array.prototype.slice.call(document.querySelectorAll("#import-works input[type=checkbox]:checked")).map(function (b) { return state.works[Number(b.dataset.i)]; }).filter(Boolean);
      picks = picks.concat(state.local.map(function (f) { return { id: null, title: f.title, local: true }; }));
      if (picks.length !== REQUIRED_WORKS) { setErr("Choisissez exactement " + REQUIRED_WORKS + " œuvres."); return; }
      setErr(""); setSt("Lecture des textes (0/" + picks.length + ")…");
      var memory = []; var done = 0; var fails = 0;
      var chain = Promise.resolve();
      picks.forEach(function (w) {
        chain = chain.then(function () {
          if (w.local) {
            var f = state.local.find(function (x) { return x.title === w.title; });
            return Promise.resolve(f ? f.text : "");
          }
          return gutenbergText(w.id).catch(function () { fails += 1; return ""; });
        }).then(function (raw) {
          memory.push({ title: w.title, gutenbergId: w.id || null, url: w.id ? ("https://www.gutenberg.org/ebooks/" + w.id) : "", sample: sampleFromText(raw) });
          done += 1; setSt("Lecture des textes (" + done + "/" + picks.length + ")…");
        });
      });
      chain.then(function () {
        var read = memory.filter(function (m) { return m.sample; }).length;
        if (!read) { setErr("Aucun texte n'a pu être lu — vérifiez la connexion, ou ajoutez des fichiers .txt."); setSt(""); return; }
        var name = displayName(picked.name);
        // Traduire la mémoire avant de l'enregistrer : chaque langue affichable est fournie.
        setSt("Traduction des textes…");
        var frTxt = [], frIdx = [], enTxt = [], enIdx = [];
        memory.forEach(function (m, i) {
          if (!m.sample) return;
          var src = trLangOf(m.sample);
          if (src !== "fr") { frIdx.push(i); frTxt.push(m.sample); }
          if (src !== "en") { enIdx.push(i); enTxt.push(m.sample); }
        });
        return Promise.all([translateTexts(frTxt, "fr"), translateTexts(enTxt, "en")]).then(function (res) {
          var frTr = res[0], enTr = res[1];
          if (frTr) frIdx.forEach(function (i, k) { if (frTr[k] && frTr[k] !== memory[i].sample) memory[i].sampleFr = frTr[k]; });
          if (enTr) enIdx.forEach(function (i, k) { if (enTr[k] && enTr[k] !== memory[i].sample) memory[i].sampleEn = enTr[k]; });
          var missed = memory.filter(function (m) { return m.sample && !m.sampleFr && !m.sampleEn && trLangOf(m.sample) === curLocale(); }).length;
          return wikiLookup(name).then(function (wiki) {
            var srcLang = wiki && wiki.lang ? String(wiki.lang).slice(0, 2) : null;
            var extract = wiki && wiki.extract ? wiki.extract.slice(0, 360) : "";
            var thumb = (wiki && wiki.thumb) || "";
            var finish = function (blurbFr, blurbEn) {
              var loc = curLocale();
              var voice = firstSentences(memory.map(function (m) { return loc === "en" ? (m.sampleEn || m.sample) : (m.sampleFr || m.sample); }).join(" "), 220);
              var era = (extract && yearsFromText(extract)) || L("domaine public", "public domain");
              var titles = memory.map(function (m) { return m.title; });
              var fallbackFr = (name + " (" + era + "). Voix constituée à partir de " + titles.slice(0, 3).join(", ") + ". " + voice).slice(0, 400);
              var fallbackEn = (name + " (" + era + "). Voice built from " + titles.slice(0, 3).join(", ") + ". " + voice).slice(0, 400);
              var bFr = blurbFr || fallbackFr;
              var bEn = blurbEn || fallbackEn;
              draft = {
                name: name, nameEn: picked.name, handle: uniqueHandle(slugHandle(name)), era: era,
                blurb: loc === "en" ? bEn : bFr, blurbFr: bFr, blurbEn: bEn,
                avatar: thumb, works: titles, memory: memory,
              };
              proposeIntoForm(draft);
              setSt(read + "/" + picks.length + " textes lus" + (fails ? " (" + fails + " non lus)" : "")
                + (missed ? " · " + missed + " texte(s) sans traduction" : "")
                + " — fiche proposée. Relisez nom, @, époque, résumé et visuel, puis publiez.");
            };
            if (!extract) { finish("", ""); return; }
            if (srcLang === "fr") {
              return translateTexts([extract], "en").then(function (trs) {
                finish(extract, trs && trs[0] && trs[0] !== extract ? trs[0] : "");
              });
            }
            if (srcLang === "en") {
              return translateTexts([extract], "fr").then(function (trs) {
                finish(trs && trs[0] && trs[0] !== extract ? trs[0] : "", extract);
              });
            }
            finish(extract, "");
          });
        });
      }).catch(function () { setErr("La proposition n'a pas pu être constituée."); setSt(""); });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
