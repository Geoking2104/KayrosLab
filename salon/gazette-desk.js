/* Gazette — propos tiré de l’URL, plusieurs répliques auteur + ouvrage. */
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
  var spin = 0;
  var lastFetched = "";

  function parseStatus(raw) {
    raw = String(raw || "").trim();
    if (/^\d{5,19}$/.test(raw)) return { id: raw, url: "https://x.com/i/web/status/" + raw };
    var m = raw.match(/(?:x\.com|twitter\.com)\/(?:i\/web\/status|([^/\s]+)\/status)\/(\d{5,19})/i);
    if (!m) return null;
    return { id: m[2], handle: m[1] && m[1] !== "i" ? m[1] : "", url: raw.split(/\s/)[0] };
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
        id: a.id, name: a.name || a.id, blurb: a.blurb || "",
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
  function worksOf(a) { return (a.works && a.works.length) ? a.works.slice(0, 5) : ["l’œuvre"]; }
  function clip(s, n) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
  }
  function sign(author, work) { return " — " + author.name + ", " + work; }
  function replies(author, thesis) {
    var works = worksOf(author);
    var idea = clip(author.blurb.replace(/[:.].*/, ""), 70);
    var th = clip(thesis || "la thèse", 72);
    var out = [];
    var moldsC = [
      function (w) { return "Cela peut se soutenir, sans en faire un dogme : " + th + "." + sign(author, w); },
      function (w) { return idea + " On accorde donc, avec " + w + ", que " + th + "." + sign(author, w); },
      function (w) { return w + " n’interdit pas cette lecture : " + th + "." + sign(author, w); }
    ];
    var moldsO = [
      function (w) { return "La thèse ne tient pas. " + w + " rappelle que " + idea.toLowerCase() + "." + sign(author, w); },
      function (w) { return "Objecter : " + th + " confond l’apparence et la cause." + sign(author, w); },
      function (w) { return "Non. Par " + w + ", on refuse que " + th + "." + sign(author, w); }
    ];
    var n = Math.max(3, Math.min(5, works.length + 1));
    for (var i = 0; i < n; i++) {
      var w = works[(i + spin) % works.length];
      out.push({ stance: "confirmation", text: clip(moldsC[(i + spin) % moldsC.length](w), 270), work: w });
      out.push({ stance: "infirmation", text: clip(moldsO[(i + spin + 1) % moldsO.length](w), 270), work: w });
    }
    return out;
  }
  function intent(text, statusId) {
    var u = "https://x.com/intent/tweet?text=" + encodeURIComponent(text);
    if (statusId) u += "&in_reply_to=" + encodeURIComponent(statusId);
    return u;
  }
  function decodeEntities(html) {
    var t = document.createElement("textarea");
    t.innerHTML = html || "";
    return t.value;
  }
  function textFromOembed(html) {
    var m = String(html || "").match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (!m) return "";
    return decodeEntities(m[1].replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  }
  function fillThesis(handle, text) {
    var box = document.getElementById("gz-text");
    if (!box || !text) return;
    var line = (handle ? "@" + handle.replace(/^@/, "") + " — " : "") + text;
    box.value = clip(line, 480);
    box.placeholder = "Propos repris du post.";
  }
  function fetchPost(parsed) {
    if (!parsed || !parsed.id || lastFetched === parsed.id) return Promise.resolve(false);
    lastFetched = parsed.id;
    var box = document.getElementById("gz-text");
    if (box && !box.value) box.placeholder = "On relève le propos…";
    var fx = fetch("https://api.fxtwitter.com/status/" + parsed.id, { headers: { accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("fx"); return r.json(); })
      .then(function (data) {
        var tw = data.tweet || data;
        var text = tw.text || tw.full_text || "";
        var handle = (tw.author && (tw.author.screen_name || tw.author.username)) || parsed.handle || "";
        if (!text) throw new Error("empty");
        fillThesis(handle, text);
        return true;
      });
    return fx.catch(function () {
      var twUrl = "https://twitter.com/i/web/status/" + parsed.id;
      return fetch("https://publish.twitter.com/oembed?omit_script=true&hide_thread=true&url=" + encodeURIComponent(twUrl))
        .then(function (r) { if (!r.ok) throw new Error("oem"); return r.json(); })
        .then(function (data) {
          var text = textFromOembed(data.html);
          if (!text) throw new Error("empty");
          fillThesis(data.author_name || parsed.handle, text);
          return true;
        });
    }).catch(function () {
      if (parsed.handle) fillThesis(parsed.handle, "(propos à coller si le post reste privé)");
      return false;
    });
  }
  function ingestThenCompose() {
    var parsed = parseStatus(document.getElementById("gz-url").value);
    if (!parsed) return;
    fetchPost(parsed).then(function () { compose(); });
  }
  function paintVoices(list) {
    var box = document.getElementById("gz-voices"); if (!box) return;
    box.innerHTML = "";
    list.forEach(function (a) {
      var lab = document.createElement("label");
      var on = DEFAULT_IDS.indexOf(a.id) !== -1;
      lab.innerHTML = '<input type="checkbox" value="' + a.id.replace(/"/g, "") + '"' + (on ? " checked" : "") + "> ' + a.name;
      box.appendChild(lab);
    });
  }
  function selected(list) {
    var ids = {};
    document.querySelectorAll("#gz-voices input:checked").forEach(function (el) { ids[el.value] = true; });
    var picked = list.filter(function (a) { return ids[a.id]; });
    return picked.length ? picked : list.filter(function (a) { return DEFAULT_IDS.indexOf(a.id) !== -1; });
  }
  function article(author, row, statusId) {
    var art = document.createElement("article");
    art.className = "col";
    var rubric = row.stance === "confirmation" ? "On accorde" : "On objecte";
    art.innerHTML = '<p class="rubric">' + rubric + "</p><h2>" + author.name + "</h2><p></p><cite>" + row.work + (author.kind ? " · " + author.kind : "") + '</cite><p class="acts"><button type="button" data-act="copy">Retenir</button><button type="button" data-act="x">Porter sur X</button></p>';
    art.querySelector("p").textContent = row.text;
    art.querySelector('[data-act="copy"]').addEventListener("click", function () {
      if (navigator.clipboard) navigator.clipboard.writeText(row.text);
      this.textContent = "Retenu.";
    });
    art.querySelector('[data-act="x"]').addEventListener("click", function () {
      if (navigator.clipboard) navigator.clipboard.writeText(row.text);
      window.open(intent(row.text, statusId), "_blank", "noopener,noreferrer");
    });
    return art;
  }
  function compose() {
    spin += 1;
    var thesis = document.getElementById("gz-text").value.trim();
    var parsed = parseStatus(document.getElementById("gz-url").value);
    var folio = document.getElementById("fx-gazette");
    folio.innerHTML = "";
    if (!thesis && !parsed) { folio.innerHTML = '<p class="empty">Portez d’abord une missive — un lien.</p>'; return; }
    if (!thesis && parsed) thesis = parsed.handle ? "@" + parsed.handle : "ce post";
    selected(catalog()).forEach(function (a) {
      replies(a, thesis).forEach(function (row) {
        folio.appendChild(article(a, row, parsed && parsed.id));
      });
    });
  }
  function boot() {
    var d = document.getElementById("gz-date");
    if (d) d.textContent = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    loadAuthorsFromSalon(function () { paintVoices(catalog()); });
    var run = document.getElementById("gz-run");
    if (run && !run.getAttribute("data-bound")) {
      run.setAttribute("data-bound", "1");
      run.addEventListener("click", ingestThenCompose);
    }
    var url = document.getElementById("gz-url");
    if (url && !url.getAttribute("data-ingest")) {
      url.setAttribute("data-ingest", "1");
      var timer = 0;
      function schedule() {
        clearTimeout(timer);
        timer = setTimeout(ingestThenCompose, 280);
      }
      url.addEventListener("paste", function () { setTimeout(ingestThenCompose, 40); });
      url.addEventListener("input", schedule);
      url.addEventListener("change", ingestThenCompose);
    }
  }
  if (!/\/salon\/flux\/?$/.test(location.pathname.replace(/index\.html$/, ""))) return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
