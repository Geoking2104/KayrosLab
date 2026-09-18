/* Gazette du Salon — feuille ancienne, plusieurs plumes. */
(function () {
  var FALLBACK = [
    { id: "voltaire", name: "Voltaire", blurb: "L'ironie contre les dogmes.", works: ["Candide, ou l'optimisme"], kind: "philosophe" },
    { id: "rousseau", name: "Rousseau", blurb: "La sincérité contre les masques.", works: ["Du contrat social"], kind: "philosophe" },
    { id: "montaigne", name: "Montaigne", blurb: "Que sais-je ?", works: ["Les Essais"], kind: "essayiste" },
    { id: "diderot", name: "Diderot", blurb: "Éclairer, assembler, contredire.", works: ["Le Neveu de Rameau"], kind: "philosophe" },
    { id: "kant", name: "Kant", blurb: "Les limites de la raison.", works: ["Critique de la raison pure"], kind: "philosophe" },
    { id: "pascal", name: "Pascal", blurb: "Grandeur et misère de l'homme.", works: ["Pensées"], kind: "philosophe" },
    { id: "nietzsche", name: "Nietzsche", blurb: "Renverser les idoles.", works: ["Ainsi parlait Zarathoustra"], kind: "philosophe" },
    { id: "platon", name: "Platon", blurb: "L'idée qui juge l'apparence.", works: ["La République"], kind: "philosophe" },
    { id: "aristote", name: "Aristote", blurb: "Le juste milieu.", works: ["Éthique à Nicomaque"], kind: "philosophe" },
    { id: "seneca", name: "Sénèque", blurb: "Se posséder plutôt que posséder.", works: ["Lettres à Lucilius"], kind: "philosophe" },
    { id: "smith", name: "Adam Smith", blurb: "La sympathie et le marché.", works: ["La Richesse des nations"], kind: "économiste" },
    { id: "marx", name: "Marx", blurb: "Le rapport sous le discours moral.", works: ["Le Capital"], kind: "économiste" },
    { id: "hugo", name: "Hugo", blurb: "La misère comme accusation.", works: ["Les Misérables"], kind: "écrivain" },
    { id: "austen", name: "Jane Austen", blurb: "L'ironie comme scalpel.", works: ["Orgueil et Préjugés"], kind: "écrivain" },
    { id: "hume", name: "Hume", blurb: "L'habitude plutôt que la nécessité.", works: ["Enquête sur l'entendement humain"], kind: "philosophe" },
    { id: "locke", name: "Locke", blurb: "L'expérience comme source.", works: ["Essai sur l'entendement humain"], kind: "philosophe" }
  ];
  var DEFAULT_IDS = ["voltaire", "rousseau", "montaigne", "kant"];

  function parseStatus(raw) {
    raw = String(raw || "").trim();
    if (/^\d{5,19}$/.test(raw)) return { id: raw, url: "https://x.com/i/web/status/" + raw };
    var m = raw.match(/(?:x\.com|twitter\.com)\/(?:i\/web\/status|[^/\s]+\/status)\/(\d{5,19})/i);
    if (m) return { id: m[1], url: raw.split(/\s/)[0] };
    return null;
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
  function workOf(a) { return (a.works && a.works[0]) || "l’œuvre"; }
  function clip(s, n) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
  }
  function phrases(author, thesis) {
    var work = workOf(author);
    var idea = clip(author.blurb.replace(/[:.].*/, ""), 90);
    var th = clip(thesis || "la thèse telle qu’énoncée", 80);
    var confirm = [
      "Cela peut se soutenir, si l’on n’en fait pas un dogme : " + th + " — " + work + ".",
      idea + " Accorder donc, avec mesure, que " + th + ".",
      "On lira cela comme " + work + " lit le monde : " + th + " n’est pas absurde."
    ];
    var object = [
      "La thèse ne tient pas. " + work + " rappelle que " + idea.toLowerCase() + ".",
      "Objecter : " + th + " confond l’apparence et la cause — voir " + work + ".",
      "Non. " + author.name + ", par " + work + ", refuse que " + th + "."
    ];
    var i = (author.id + thesis).length % 3;
    return { confirmation: clip(confirm[i], 260), infirmation: clip(object[i], 260) };
  }
  function intent(text, statusId) {
    var u = "https://x.com/intent/tweet?text=" + encodeURIComponent(text);
    if (statusId) u += "&in_reply_to=" + encodeURIComponent(statusId);
    return u;
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
  function article(author, stance, text, statusId) {
    var art = document.createElement("article");
    art.className = "col";
    var rubric = stance === "confirmation" ? "On accorde" : "On objecte";
    art.innerHTML = '<p class="rubric">' + rubric + "</p><h2>" + author.name + "</h2><p></p><cite>" + workOf(author) + (author.kind ? " · " + author.kind : "") + '</cite><p class="acts"><button type="button" data-act="copy">Retenir</button><button type="button" data-act="x">Porter sur X</button></p>';
    art.querySelector("p").textContent = text;
    art.querySelector('[data-act="copy"]').addEventListener("click", function () {
      if (navigator.clipboard) navigator.clipboard.writeText(text);
      this.textContent = "Retenu.";
    });
    art.querySelector('[data-act="x"]').addEventListener("click", function () {
      if (navigator.clipboard) navigator.clipboard.writeText(text);
      window.open(intent(text, statusId), "_blank", "noopener,noreferrer");
    });
    return art;
  }
  function compose() {
    var list = catalog();
    var thesis = document.getElementById("gz-text").value.trim();
    var parsed = parseStatus(document.getElementById("gz-url").value);
    var folio = document.getElementById("fx-gazette");
    folio.innerHTML = "";
    if (!thesis && !parsed) { folio.innerHTML = '<p class="empty">Portez d’abord une missive — un lien, un propos.</p>'; return; }
    if (!thesis && parsed) thesis = "ce que dit le post " + parsed.id;
    selected(list).forEach(function (a) {
      var p = phrases(a, thesis);
      folio.appendChild(article(a, "confirmation", p.confirmation, parsed && parsed.id));
      folio.appendChild(article(a, "infirmation", p.infirmation, parsed && parsed.id));
    });
  }
  function boot() {
    var d = document.getElementById("gz-date");
    if (d) d.textContent = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    loadAuthorsFromSalon(function () { paintVoices(catalog()); });
    var run = document.getElementById("gz-run");
    if (run && !run.getAttribute("data-bound")) {
      run.setAttribute("data-bound", "1");
      run.addEventListener("click", compose);
    }
  }
  if (!/\/salon\/flux\/?$/.test(location.pathname.replace(/index\.html$/, ""))) return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
