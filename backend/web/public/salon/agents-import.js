/* Salon #agents — import Gutenberg + catalogue dynamique. */
(function () {
  function boot() {
    if (typeof authors === "undefined" || !document.getElementById("agents")) {
      setTimeout(boot, 40);
      return;
    }
    enhanceAgentsPane();
    paintCatalogCount();
  }
  function paintCatalogCount() {
    if (typeof authors === "undefined" || typeof msg !== "function") return;
    var n = authors.length;
    if (I18N && I18N.fr && I18N.fr["circle.what"]) I18N.fr["circle.what"] = I18N.fr["circle.what"].replace("54 déjà", "{n} déjà");
    if (I18N && I18N.en && I18N.en["circle.what"]) I18N.en["circle.what"] = I18N.en["circle.what"].replace("54 already", "{n} already");
    document.querySelectorAll('[data-i18n="flows"], [data-i18n="circle.what"]').forEach(function (el) {
      el.dataset.n = String(n);
      el.textContent = msg(el.getAttribute("data-i18n"), { n: n });
    });
    var nEl = document.getElementById("agent-n");
    var q = document.getElementById("agent-q");
    var k = document.getElementById("agent-kind");
    if (nEl && !(q && q.value) && !(k && k.value)) nEl.textContent = String(n);
  }
  function enhanceAgentsPane() {
    var cta = document.getElementById("add-author");
    if (cta) { cta.hidden = true; cta.style.display = "none"; }
    var form = document.getElementById("create-author");
    if (form) {
      form.hidden = false;
      var cancel = document.getElementById("create-cancel");
      if (cancel) cancel.hidden = true;
    }
    if (!document.getElementById("import-author")) injectImportBox(form);
    bindImport();
    if (form && !form.dataset.catalogHook) {
      form.dataset.catalogHook = "1";
      form.addEventListener("submit", function () {
        setTimeout(function () {
          try { if (typeof persistSoon === "function") persistSoon(); } catch (e) {}
          try { if (typeof renderGuests === "function") renderGuests(); } catch (e) {}
          try { if (typeof renderAgents === "function") renderAgents(); } catch (e) {}
          paintCatalogCount();
        }, 0);
      });
    }
    if (typeof renderAgents === "function" && !renderAgents.__catalogWrapped) {
      var prev = renderAgents;
      renderAgents = function () { prev(); paintCatalogCount(); };
      renderAgents.__catalogWrapped = true;
    }
    if (typeof applyI18n === "function" && !applyI18n.__catalogWrapped) {
      var prevI18n = applyI18n;
      applyI18n = function () {
        document.querySelectorAll('[data-i18n="flows"], [data-i18n="circle.what"]').forEach(function (el) {
          el.dataset.n = String(authors.length);
        });
        prevI18n();
        paintCatalogCount();
      };
      applyI18n.__catalogWrapped = true;
    }
  }
  function injectImportBox(form) {
    var box = document.createElement("div");
    box.className = "import-box";
    box.id = "import-author";
    box.innerHTML = "<h2>Importer un auteur du domaine public</h2><p class=\"hint\">Base ouverte Project Gutenberg. Choisissez un auteur, puis exactement cinq œuvres — elles complètent le catalogue et deviennent la mémoire de l’agent.</p><form id=\"import-search\" class=\"row\"><input id=\"import-q\" type=\"search\" minlength=\"2\" required placeholder=\"Hugo, Austen, Montesquieu…\" /><button class=\"btn\" type=\"submit\">Chercher</button></form><p class=\"import-meta\" id=\"import-status\" hidden></p><p class=\"err\" id=\"import-error\" hidden></p><ul class=\"import-hits\" id=\"import-authors\" hidden></ul><div id=\"import-pick\" hidden><p class=\"import-meta\" id=\"import-pick-head\"></p><ul class=\"import-works\" id=\"import-works\"></ul><div class=\"row\" style=\"margin-top:0.7rem\"><button class=\"btn\" type=\"button\" id=\"import-commit\" disabled>Constituer la mémoire (5)</button></div></div>";
    var style = document.createElement("style");
    style.textContent = ".import-box{margin:1.1rem 0 0;padding:1rem 1.1rem 1.15rem;border:1px solid color-mix(in oklch,var(--ink) 14%,transparent);background:color-mix(in oklch,var(--paper) 92%,var(--accent));}.import-box h2{margin:0 0 .35rem;font-size:1.15rem}.import-box .hint,.import-meta{color:var(--muted);font-size:.92rem}.import-box .row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}.import-box input[type=search]{flex:1;min-width:12rem}.import-hits,.import-works{list-style:none;margin:.7rem 0 0;padding:0;display:grid;gap:.28rem}.import-hits button{width:100%;text-align:left;background:transparent;border:1px solid color-mix(in oklch,var(--ink) 12%,transparent);padding:.45rem .6rem;cursor:pointer;color:inherit;font:inherit}.import-hits button.is-on,.import-hits button:hover{border-color:var(--accent)}.import-hits button span,.import-works small{display:block;color:var(--muted);font-size:.82rem}.import-works label{display:flex;gap:.55rem;align-items:flex-start;padding:.28rem 0}.import-box .err{color:#8b1e1e;margin:.5rem 0 0}#add-author{display:none!important}#create-author{display:grid!important}#create-cancel{display:none!important}";
    document.head.appendChild(style);
    if (form && form.parentNode) form.parentNode.insertBefore(box, form.nextSibling);
    else {
      var agents = document.getElementById("agents");
      if (agents) agents.insertBefore(box, agents.children[1] || null);
    }
  }
  function bindImport() {
    if (bindImport.done) return;
    bindImport.done = true;
    var state = { authors: [], selected: null, works: [] };
    function escLocal(s) { return typeof esc === "function" ? esc(s) : String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
    function slugHandle(name) { return String(name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").slice(0, 18) || "auteur"; }
    function textUrlOf(book) { var f = book.formats || {}; return f["text/plain; charset=utf-8"] || f["text/plain"] || (Object.entries(f).find(function (kv) { return kv[0].indexOf("text/plain") === 0; }) || [])[1] || ""; }
    function uniqueHandle(base) { var id = base, n = 2; while (authors.some(function (a) { return a.id === id; })) { id = base + n; n += 1; } return id; }
    function setErr(t) { var el = document.getElementById("import-error"); if (!el) return; el.hidden = !t; el.textContent = t || ""; }
    function setSt(t) { var el = document.getElementById("import-status"); if (!el) return; el.hidden = !t; el.textContent = t || ""; }
    function commitAuthor(entry) {
      var existing = authors.find(function (a) { return a.id === entry.id || a.name === entry.name || a.nameEn === entry.nameEn; });
      if (existing) { existing.works = entry.works; existing.memory = entry.memory; existing.source = entry.source; }
      else authors.push(entry);
      try { if (typeof renderGuests === "function") renderGuests(); } catch (e) {}
      try { if (typeof renderAgents === "function") renderAgents(); } catch (e) {}
      try { if (typeof persistSoon === "function") persistSoon(); } catch (e) {}
      paintCatalogCount();
      var id = (existing || entry).id;
      try { fillFiche(id); show("fiche", id); } catch (e) {}
    }
    var search = document.getElementById("import-search");
    if (search) search.addEventListener("submit", function (e) {
      e.preventDefault();
      var q = String((document.getElementById("import-q") || {}).value || "").trim();
      if (q.length < 2) return;
      setErr(""); setSt("Recherche…");
      var list = document.getElementById("import-authors");
      var pick = document.getElementById("import-pick");
      if (list) list.hidden = true;
      if (pick) pick.hidden = true;
      fetch("https://gutendex.com/books?search=" + encodeURIComponent(q) + "&copyright=false")
        .then(function (res) { if (!res.ok) throw new Error("http"); return res.json(); })
        .then(function (json) {
          var by = new Map();
          (json.results || []).forEach(function (book) {
            (book.authors || []).forEach(function (a) {
              var name = String(a.name || "").trim();
              if (!name) return;
              var key = name.toLowerCase();
              if (!by.has(key)) by.set(key, { name: name, birth: a.birth_year, death: a.death_year, books: [] });
              var row = by.get(key);
              if (textUrlOf(book) && !row.books.some(function (b) { return b.id === book.id; })) row.books.push({ id: book.id, title: book.title, url: textUrlOf(book) });
            });
          });
          state.authors = Array.from(by.values()).filter(function (a) { return a.books.length >= 1; }).sort(function (a, b) { return b.books.length - a.books.length; });
          if (!state.authors.length) { setSt("Aucun auteur libre trouvé."); return; }
          setSt(state.authors.length + " auteurs trouvés");
          list.innerHTML = state.authors.map(function (a, i) {
            var era = [a.birth, a.death].filter(Boolean).join("–") || "domaine public";
            return "<li><button type=\"button\" data-i=\"" + i + "\">" + escLocal(a.name) + "<span>" + escLocal(era) + " · " + a.books.length + " œuvre(s)</span></button></li>";
          }).join("");
          list.hidden = false;
        })
        .catch(function () { setSt(""); setErr("La base ouverte n’a pas répondu."); });
    });
    var authorsList = document.getElementById("import-authors");
    if (authorsList) authorsList.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-i]");
      if (!btn) return;
      authorsList.querySelectorAll("button").forEach(function (b) { b.classList.toggle("is-on", b === btn); });
      var picked = state.authors[Number(btn.dataset.i)];
      if (!picked) return;
      state.selected = picked;
      setSt("Recherche…");
      fetch("https://gutendex.com/books?search=" + encodeURIComponent(picked.name) + "&copyright=false")
        .then(function (res) { return res.ok ? res.json() : { results: [] }; })
        .then(function (json) {
          var books = []; var seen = {};
          picked.books.forEach(function (b) { seen[b.id] = true; books.push(b); });
          var surname = picked.name.split(",")[0].toLowerCase();
          (json.results || []).forEach(function (book) {
            var url = textUrlOf(book);
            if (!url || seen[book.id]) return;
            var names = (book.authors || []).map(function (a) { return a.name.toLowerCase(); });
            if (!names.some(function (n) { return n.indexOf(surname) >= 0 || picked.name.toLowerCase().indexOf(n.split(",")[0]) >= 0; })) return;
            seen[book.id] = true;
            books.push({ id: book.id, title: book.title, url: url });
          });
          state.works = books.slice(0, 24);
          document.getElementById("import-works").innerHTML = state.works.map(function (w, i) {
            return "<li><label><input type=\"checkbox\" data-i=\"" + i + "\" /><span>" + escLocal(w.title) + "<small>Gutenberg #" + w.id + "</small></span></label></li>";
          }).join("");
          document.getElementById("import-pick-head").textContent = "Œuvres de " + picked.name + " — cochez 5";
          document.getElementById("import-pick").hidden = false;
          document.getElementById("import-commit").disabled = true;
          setSt("");
        })
        .catch(function () { setErr("La base ouverte n’a pas répondu."); });
    });
    var worksList = document.getElementById("import-works");
    if (worksList) worksList.addEventListener("change", function () {
      var boxes = Array.prototype.slice.call(document.querySelectorAll("#import-works input[type=checkbox]"));
      var checked = boxes.filter(function (b) { return b.checked; });
      if (checked.length > 5) checked.slice(5).forEach(function (b) { b.checked = false; });
      document.getElementById("import-commit").disabled = document.querySelectorAll("#import-works input[type=checkbox]:checked").length !== 5;
    });
    var commitBtn = document.getElementById("import-commit");
    if (commitBtn) commitBtn.addEventListener("click", function () {
      var picked = state.selected;
      if (!picked) return;
      var works = Array.prototype.slice.call(document.querySelectorAll("#import-works input[type=checkbox]:checked")).map(function (b) { return state.works[Number(b.dataset.i)]; }).filter(Boolean);
      if (works.length !== 5) { setErr("Choisissez exactement cinq œuvres."); return; }
      setErr(""); setSt("Chargement des textes…");
      var memory = [];
      var chain = Promise.resolve();
      works.forEach(function (work) {
        chain = chain.then(function () {
          return fetch(work.url).then(function (res) { return res.ok ? res.text() : ""; }).catch(function () { return ""; }).then(function (raw) {
            raw = String(raw || "").replace(/\u0000/g, "");
            var start = raw.search(/\r?\n\r?\n/);
            var sample = raw.slice(Math.max(0, start), Math.max(0, start) + 1800).trim();
            memory.push({ title: work.title, gutenbergId: work.id, url: work.url, sample: sample.slice(0, 1200) });
          });
        });
      });
      chain.then(function () {
        var display = picked.name.replace(/^([^,]+),\s*(.+)$/, "$2 $1");
        var handle = uniqueHandle(slugHandle(picked.name.split(",")[0]));
        var era = [picked.birth, picked.death].filter(Boolean).join("–") || "domaine public";
        commitAuthor({ id: handle, name: display, nameEn: picked.name, kind: "écrivain", blurb: "Voix constituée depuis cinq œuvres du domaine public (Project Gutenberg).", blurbEn: "Voice built from five public-domain works (Project Gutenberg).", era: era, eraEn: era, avatar: "", monogram: (display || "A").slice(0, 1).toUpperCase(), method: "auto", works: works.map(function (w) { return w.title; }), memory: memory, source: "gutenberg" });
        setSt("");
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
