/* Graphe de connaissances du cercle */
(function () {
  var CONCEPTS = [
    [/autonome|autonomie/, "autonomie"], [/ind[eé]pendant/, "indépendance"],
    [/volont[eé]/, "volonté"], [/libert[eé]|\blibre\b/, "liberté"],
    [/conscience/, "conscience"], [/raison|entendement/, "raison"],
    [/vertu/, "vertu"], [/providence|dieu/, "providence"],
    [/nature/, "nature"], [/contrat|souverain/, "contrat"]
  ];
  var COL = { dossier: "#7a2e24", auteur: "#2c2118", prise: "#2c4a6b", concept: "#8a5a12", oeuvre: "#3d6b4f" };
  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }
  function clip(s, n) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
  function conceptsIn(text) {
    var src = String(text || "").toLowerCase(), out = [];
    for (var i = 0; i < CONCEPTS.length; i++) {
      if (CONCEPTS[i][0].test(src) && out.indexOf(CONCEPTS[i][1]) < 0) out.push(CONCEPTS[i][1]);
    }
    return out.slice(0, 4);
  }
  function worksFromDom() {
    var out = [];
    [].forEach.call(document.querySelectorAll("ol.msgs li.msg p.proof"), function (p) {
      var li = p.closest("li.msg");
      var author = ((li && li.querySelector("header strong")) || {}).textContent || "";
      author = String(author).trim().toLowerCase().replace(/\s+/g, "");
      var m = String(p.textContent || "").match(/dans\s+[\u00ab"]?([^\u00bb"\u2014.]{3,60})/i);
      if (m && author) out.push({ author: author, title: m[1].trim() });
    });
    return out.slice(-8);
  }
  function build() {
    var st = (window.SalonConflict && window.SalonConflict.state) ? window.SalonConflict.state() : { dossier: "", prises: [], liens: [], ouverts: [] };
    var nodes = [], edges = [], seen = {};
    function add(n) { if (seen[n.id]) return; seen[n.id] = 1; nodes.push(n); }
    var dossier = st.dossier || ((document.querySelector(".protocol p") || {}).textContent || "question de table");
    dossier = String(dossier).replace(/\s+/g, " ").trim() || "question de table";
    add({ id: "dossier", kind: "dossier", label: clip(dossier, 64) });
    (st.prises || []).forEach(function (p) {
      var aid = "a:" + p.author;
      add({ id: aid, kind: "auteur", label: "@" + p.author });
      add({ id: p.id, kind: "prise", label: clip(p.text, 72) });
      edges.push({ from: aid, to: p.id, rel: "affirme" });
      edges.push({ from: p.id, to: "dossier", rel: "sur" });
      conceptsIn(p.text).concat(st.ouverts || []).forEach(function (c) {
        if (!c) return;
        var cid = "c:" + c;
        add({ id: cid, kind: "concept", label: c });
        edges.push({ from: p.id, to: cid, rel: "porte" });
      });
    });
    (st.liens || []).forEach(function (l) { edges.push({ from: l.from, to: l.to, rel: l.kind }); });
    worksFromDom().forEach(function (w) {
      var wid = "w:" + clip(w.title, 36);
      add({ id: wid, kind: "oeuvre", label: clip(w.title, 40) });
      edges.push({ from: "a:" + w.author, to: wid, rel: "cite" });
    });
    return { nodes: nodes, edges: edges, dossier: dossier };
  }
  function layout(nodes) {
    var w = 280, h = 240, cx = 140, cy = 118;
    var groups = { dossier: [], auteur: [], prise: [], concept: [], oeuvre: [] };
    nodes.forEach(function (n) { (groups[n.kind] || groups.prise).push(n); });
    var pos = {};
    pos.dossier = { x: cx, y: cy };
    function ring(list, r) {
      list.forEach(function (n, i) {
        var a = (-Math.PI / 2) + (i / Math.max(list.length, 1)) * Math.PI * 2;
        pos[n.id] = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.82 };
      });
    }
    ring(groups.auteur, 86);
    ring(groups.concept, 54);
    ring(groups.prise, 108);
    ring(groups.oeuvre, 72);
    return { w: w, h: h, pos: pos };
  }
  function svgOf(g) {
    if (!g.nodes.length || g.nodes.length === 1) {
      return '<svg viewBox="0 0 280 90" role="img"><text x="12" y="40" font-size="12" fill="#6b5b4a" font-family="Source Sans 3,sans-serif">Le graphe se remplit avec les prises.</text></svg>';
    }
    var L = layout(g.nodes);
    var edges = g.edges.map(function (e) {
      var a = L.pos[e.from], b = L.pos[e.to];
      if (!a || !b) return "";
      return '<line x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) + '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '" stroke="#c9b8a8" stroke-width="0.8"/>';
    }).join("");
    var dots = g.nodes.map(function (n) {
      var p = L.pos[n.id] || { x: 140, y: 118 };
      var r = n.kind === "dossier" ? 9 : n.kind === "auteur" ? 7 : 5;
      return '<g><circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + r + '" fill="' + (COL[n.kind] || "#2c2118") + '"/><title>' + esc(n.kind + " — " + n.label) + '</title><text x="' + p.x.toFixed(1) + '" y="' + (p.y + r + 9).toFixed(1) + '" text-anchor="middle" font-size="8" fill="#2c2118" font-family="Source Sans 3,sans-serif">' + esc(clip(n.label, 16)) + '</text></g>';
    }).join("");
    return '<svg viewBox="0 0 ' + L.w + ' ' + L.h + '" role="img">' + edges + dots + "</svg>";
  }
  function ensure() {
    var box = document.getElementById("salon-kg");
    if (box) return box;
    if (!document.getElementById("salon-kg-css")) {
      var st = document.createElement("style");
      st.id = "salon-kg-css";
      st.textContent = "#salon-kg{margin:0 0 .85rem;padding:.75rem .8rem;border:1px solid color-mix(in oklch,var(--ink) 14%,transparent);font-size:.86rem}#salon-kg h2{margin:0 0 .35rem;font-family:Fraunces,serif;font-size:1rem}#salon-kg .kg-meta{color:var(--muted);font-size:.78rem;margin:0 0 .4rem}#salon-kg svg{display:block;width:100%;height:auto}#salon-kg .kg-leg{display:flex;flex-wrap:wrap;gap:.4rem .7rem;list-style:none;padding:0;margin:.4rem 0 0;font-size:.7rem;color:var(--muted)}#salon-kg .kg-leg i{display:inline-block;width:.55rem;height:.55rem;border-radius:50%;margin-right:.25rem;vertical-align:middle}";
      document.head.appendChild(st);
    }
    box = document.createElement("aside");
    box.id = "salon-kg";
    box.setAttribute("aria-label", "Graphe de connaissances");
    var rail = document.getElementById("salon-rail");
    var viz = document.getElementById("salon-conflict-viz");
    if (rail) rail.appendChild(box);
    else if (viz) viz.insertAdjacentElement("afterend", box);
    else {
      var stream = document.querySelector(".stream");
      if (stream) stream.insertAdjacentElement("beforebegin", box);
      else document.body.appendChild(box);
    }
    return box;
  }
  function paint() {
    var g = build();
    var box = ensure();
    var counts = {};
    g.nodes.forEach(function (n) { counts[n.kind] = (counts[n.kind] || 0) + 1; });
    var leg = ["dossier", "auteur", "prise", "concept", "oeuvre"].map(function (k) {
      return "<li><i style=\"background:" + COL[k] + "\"></i>" + k + "</li>";
    }).join("");
    box.innerHTML = "<h2>Graphe de connaissances</h2><p class=\"kg-meta\">" + g.nodes.length + " nœuds · " + g.edges.length + " liens</p>" + svgOf(g) + "<ul class=\"kg-leg\">" + leg + "</ul>";
    try { window.SALON_KG = g; } catch (e) {}
  }
  window.SalonGraph = { paint: paint, graph: function () { return build(); } };
  function hook() {
    if (window.SalonConflict && window.SalonConflict.record && !window.SalonConflict.__kg) {
      var rec = window.SalonConflict.record;
      window.SalonConflict.record = function () {
        var r = rec.apply(this, arguments);
        try { paint(); } catch (e) {}
        return r;
      };
      var rst = window.SalonConflict.reset;
      window.SalonConflict.reset = function () {
        var r = rst.apply(this, arguments);
        try { paint(); } catch (e) {}
        return r;
      };
      window.SalonConflict.__kg = 1;
    }
  }
  function ready(fn) {
    if (document.body) { fn(); return; }
    setTimeout(function () { ready(fn); }, 40);
  }
  ready(function () {
    hook();
    paint();
    setInterval(function () { hook(); paint(); }, 2400);
  });
})();
