/* ConflictState + graphe + sentiment dans le temps */
(function () {
  var KIND_FR = { ouvre: "ouvre", accorde: "accorde", distingue: "distingue", contredit: "contredit", precise: "précise", compose: "compose" };
  var KIND_COL = { ouvre: "#6b5b4a", accorde: "#3d6b4f", distingue: "#8a5a12", contredit: "#7a2e24", precise: "#2c4a6b", compose: "#4a3d6b" };
  var KIND_SENT = { ouvre: 0.12, accorde: 0.38, distingue: -0.22, contredit: -0.48, precise: 0.1, compose: 0.42 };
  function empty(dossier) {
    return { dossier: String(dossier || "").trim(), prises: [], liens: [], ouverts: [] };
  }
  function classify(role, text, hasPrior) {
    var blob = (String(role || "") + " " + String(text || "")).toLowerCase();
    if (!hasPrior) return "ouvre";
    if (/secr[eé]taire|minute|compose|reste ouvert/.test(blob)) return "compose";
    if (/objecte|contredit|ce n['’]est pas|je refuse|à l['’]inverse/.test(blob)) return "contredit";
    if (/objecteur|distingue|pourtant|cependant|ce n['’]est pas encore/.test(blob)) return "distingue";
    if (/d[eé]fenseur|pr[eé]cise|je tiens|contre l['’]objection/.test(blob)) return "precise";
    if (/j['’]accorde|je te l['’]accorde/.test(blob)) return "accorde";
    return "precise";
  }
  function nodes(prise, prior) {
    var src = ((prior || "") + " " + prise).toLowerCase();
    var out = [], pairs = [
      [/autonome|autonomie/, "autonomie"], [/ind[eé]pendant/, "indépendance"],
      [/volont[eé]/, "volonté"], [/libert[eé]|\blibre\b/, "liberté"],
      [/conscience/, "conscience"], [/\bgrain\b|instance|session/, "grain du sujet"],
      [/d[eé]finition/, "définition"]
    ];
    for (var i = 0; i < pairs.length; i++) if (pairs[i][0].test(src) && out.indexOf(pairs[i][1]) < 0) out.push(pairs[i][1]);
    return out.slice(0, 3);
  }
  function lexicalBias(text) {
    var t = String(text || "").toLowerCase();
    var p = (t.match(/j['’]accorde|oui|juste|exact|bien dit|d['’]accord/g) || []).length;
    var n = (t.match(/je refuse|ce n['’]est pas|hélas|erreur|impossible|à l['’]inverse/g) || []).length;
    return Math.max(-0.2, Math.min(0.2, (p - n) * 0.08));
  }
  function sentimentSeries(state) {
    var map = {};
    state.liens.forEach(function (l) { map[l.from] = l.kind; });
    var acc = 0;
    return state.prises.map(function (p, i) {
      var kind = map[p.id] || (i === 0 ? "ouvre" : "precise");
      acc += (KIND_SENT[kind] || 0) + lexicalBias(p.text);
      if (acc > 1) acc = 1; if (acc < -1) acc = -1;
      return { tour: p.tour, author: p.author, kind: kind, value: Math.round(acc * 100) / 100 };
    });
  }
  function unresolved(state) {
    var composed = {};
    state.liens.forEach(function (l) { if (l.kind === "compose") composed[l.to] = 1; });
    return state.liens.filter(function (l) { return (l.kind === "contredit" || l.kind === "distingue") && !composed[l.from]; });
  }
  function tensionOf(state) {
    var open = unresolved(state), c = 0, d = 0;
    open.forEach(function (l) { if (l.kind === "contredit") c++; else d++; });
    return Math.max(8, Math.min(100, 12 + c * 28 + d * 14 + state.ouverts.length * 6));
  }
  function phaseOf(t) {
    return t >= 70 ? "opposition vive" : t >= 40 ? "tension ouverte" : t >= 20 ? "discussion" : "apaisement";
  }
  function moodOf(v) {
    return v >= 0.25 ? "accord croissant" : v <= -0.25 ? "dissonance" : "équilibre tendu";
  }
  function byId(state) {
    var m = {}; state.prises.forEach(function (p) { m[p.id] = p; }); return m;
  }
  function describe(state) {
    var last = state.liens[state.liens.length - 1], t = tensionOf(state);
    var ser = sentimentSeries(state);
    var now = ser.length ? ser[ser.length - 1].value : 0;
    if (!last) {
      return state.prises[0] ? "@" + state.prises[0].author + " ouvre — « " + state.prises[0].text + " »" : "Pas encore de prise. Ouvrez un cercle.";
    }
    var map = byId(state), from = map[last.from], to = map[last.to];
    var open = state.ouverts.length ? " — ouvert : " + state.ouverts.join(", ") : "";
    return "@" + (from ? from.author : "?") + " " + KIND_FR[last.kind] + " " + (to ? "@" + to.author : "la table") + open + " · " + phaseOf(t) + " (" + t + ") · " + moodOf(now) + " (" + now + ").";
  }
  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  }
  function clip(s, n) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }
  function ensureBox() {
    var box = document.getElementById("salon-conflict-viz");
    if (box) return box;
    if (!document.getElementById("salon-conflict-css")) {
      var st = document.createElement("style");
      st.id = "salon-conflict-css";
      st.textContent = [
        "#salon-conflict-viz{margin:1rem 0 1.25rem;padding:1rem 1.1rem 1.15rem;border:1px solid color-mix(in oklch,var(--ink) 16%,transparent);background:color-mix(in oklch,var(--paper) 92%,white)}",
        "#salon-conflict-viz h2{margin:0 0 .35rem;font-family:Fraunces,serif;font-size:1.15rem}",
        "#salon-conflict-viz h3{margin:.9rem 0 .35rem;font-size:.78rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600}",
        "#salon-conflict-viz .cf-read{margin:0 0 .7rem;color:var(--muted);font-size:.92rem}",
        "#salon-conflict-viz .cf-bar{height:.35rem;background:color-mix(in oklch,var(--ink) 10%,transparent);margin:0 0 .85rem}",
        "#salon-conflict-viz .cf-fill{height:100%;background:var(--accent,#7a2e24);width:8%;transition:width .35s ease}",
        "#salon-conflict-viz svg{display:block;width:100%;height:auto}",
        "#salon-conflict-viz .cf-chips{display:flex;flex-wrap:wrap;gap:.35rem;margin:.65rem 0 0;padding:0;list-style:none}",
        "#salon-conflict-viz .cf-chips li{font-size:.78rem;letter-spacing:.04em;text-transform:uppercase;border:1px solid color-mix(in oklch,var(--accent,#7a2e24) 45%,transparent);padding:.15rem .45rem;color:var(--accent,#7a2e24)}",
        "#salon-conflict-viz .cf-legend{display:flex;flex-wrap:wrap;gap:.55rem .9rem;margin:.7rem 0 0;padding:0;list-style:none;font-size:.75rem;color:var(--muted)}",
        "#salon-conflict-viz .cf-legend i{display:inline-block;width:.7rem;height:.7rem;margin-right:.28rem;vertical-align:middle;border-radius:50%}"
      ].join("");
      document.head.appendChild(st);
    }
    box = document.createElement("aside");
    box.id = "salon-conflict-viz";
    box.setAttribute("aria-label", "Dynamique des conflits sémantiques");
    var dyn = document.getElementById("circle-dyn");
    var stream = document.querySelector(".stream");
    if (dyn) dyn.insertAdjacentElement("afterend", box);
    else if (stream) stream.insertBefore(box, stream.firstChild);
    else document.body.appendChild(box);
    return box;
  }
  function graphSvg(state) {
    var n = state.prises.length;
    var w = 640, h = n ? 168 : 96;
    if (!n) {
      return '<svg viewBox="0 0 640 96" role="img"><text x="24" y="42" fill="#6b5b4a" font-size="14" font-family="Source Sans 3,sans-serif">Aucune prise — le graphe apparaît dès le premier tour.</text><text x="24" y="64" fill="#6b5b4a" font-size="12" font-family="Source Sans 3,sans-serif">ouvre → distingue / contredit → précise → compose</text></svg>';
    }
    var pad = 48, span = Math.max(1, n - 1);
    var pts = state.prises.map(function (p, i) {
      return { p: p, x: pad + (i / span) * (w - pad * 2), y: 78 + (i % 2 === 0 ? -18 : 18) };
    });
    var pos = {};
    pts.forEach(function (o) { pos[o.p.id] = o; });
    var edges = state.liens.map(function (l) {
      var a = pos[l.to], b = pos[l.from];
      if (!a || !b) return "";
      var mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - 36;
      var col = KIND_COL[l.kind] || "#6b5b4a";
      return '<path d="M' + a.x + ' ' + a.y + ' Q ' + mx + ' ' + my + ' ' + b.x + ' ' + b.y + '" fill="none" stroke="' + col + '" stroke-width="1.6"/><text x="' + mx + '" y="' + (my + 12) + '" text-anchor="middle" font-size="10" fill="' + col + '" font-family="Source Sans 3,sans-serif">' + esc(KIND_FR[l.kind]) + "</text>";
    }).join("");
    var dots = pts.map(function (o) {
      return '<g><circle cx="' + o.x + '" cy="' + o.y + '" r="11" fill="#2c2118"/><text x="' + o.x + '" y="' + (o.y + 28) + '" text-anchor="middle" font-size="11" fill="#2c2118" font-family="Source Sans 3,sans-serif">@' + esc(clip(o.p.author, 12)) + '</text><title>' + esc(o.p.author + " — " + o.p.text) + "</title></g>";
    }).join("");
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img">' + edges + dots + "</svg>";
  }
  function sentimentSvg(state) {
    var ser = sentimentSeries(state);
    var w = 640, h = 120, pad = 36;
    if (!ser.length) {
      return '<svg viewBox="0 0 640 80" role="img"><text x="24" y="44" fill="#6b5b4a" font-size="13" font-family="Source Sans 3,sans-serif">Le sentiment s’accumule tour à tour : accord monte, contradiction descend.</text></svg>';
    }
    var span = Math.max(1, ser.length - 1);
    function x(i) { return pad + (i / span) * (w - pad * 2); }
    function y(v) { return 16 + (1 - (v + 1) / 2) * (h - 40); }
    var mid = y(0);
    var pts = ser.map(function (s, i) { return x(i) + "," + y(s.value); }).join(" ");
    var last = ser[ser.length - 1];
    var dots = ser.map(function (s, i) {
      var col = s.value >= 0.2 ? "#3d6b4f" : s.value <= -0.2 ? "#7a2e24" : "#8a5a12";
      return '<circle cx="' + x(i) + '" cy="' + y(s.value) + '" r="4" fill="' + col + '"><title>t' + s.tour + " @" + esc(s.author) + " " + esc(KIND_FR[s.kind] || s.kind) + " · " + s.value + "</title></circle>";
    }).join("");
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img"><line x1="' + pad + '" x2="' + (w - pad) + '" y1="' + mid + '" y2="' + mid + '" stroke="#c9b8a8" stroke-dasharray="3 4"/><text x="8" y="22" font-size="10" fill="#3d6b4f">+</text><text x="8" y="' + (h - 18) + '" font-size="10" fill="#7a2e24">−</text><polyline fill="none" stroke="#2c2118" stroke-width="1.7" points="' + pts + '"/>' + dots + '<text x="' + (w - pad) + '" y="14" text-anchor="end" font-size="11" fill="#2c2118" font-family="Source Sans 3,sans-serif">' + esc(moodOf(last.value)) + " · " + last.value + '</text></svg>';
  }
  var state = empty("");
  function paint() {
    var box = ensureBox();
    var t = tensionOf(state);
    var chips = state.ouverts.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("");
    var legend = Object.keys(KIND_FR).map(function (k) {
      return "<li><i style=\"background:" + KIND_COL[k] + "\"></i>" + KIND_FR[k] + "</li>";
    }).join("");
    box.innerHTML = "<h2>Dynamique des conflits</h2><p class=\"cf-read\">" + esc(describe(state)) + "</p><div class=\"cf-bar\" aria-hidden=\"true\"><div class=\"cf-fill\" style=\"width:" + t + "%\"></div></div>" + graphSvg(state) + "<h3>Sentiment au fil des tours</h3>" + sentimentSvg(state) + (chips ? "<ul class=\"cf-chips\">" + chips + "</ul>" : "") + "<ul class=\"cf-legend\">" + legend + "</ul>";
    var dyn = document.getElementById("circle-dyn");
    if (dyn) {
      dyn.hidden = false;
      var fill = document.getElementById("dy-fill"); if (fill) fill.style.width = t + "%";
      var read = document.getElementById("dy-read"); if (read) read.textContent = describe(state);
      var ol = document.getElementById("dy-beats");
      if (ol) {
        var map = byId(state);
        ol.innerHTML = state.liens.slice(-8).map(function (l) {
          var from = map[l.from], to = map[l.to];
          return "<li>@" + esc(from ? from.author : "?") + " " + KIND_FR[l.kind] + " @" + esc(to ? to.author : "?") + (from ? " — « " + esc(clip(from.text, 88)) + " »" : "") + "</li>";
        }).join("");
      }
    }
    try { window.SALON_CONFLICT = state; } catch (e) {}
  }
  function reset(dossier) { state = empty(dossier); paint(); return state; }
  function record(input) {
    var text = String((input && input.prise) || "").replace(/\s+/g, " ").trim();
    if (!text) return state;
    if (!state.dossier) {
      var p = document.querySelector(".protocol p");
      state.dossier = p ? String(p.textContent || "").replace(/\s+/g, " ").trim() : "";
    }
    var prior = state.prises[state.prises.length - 1];
    var id = "p" + (state.prises.length + 1);
    var kind = classify(input && input.role, (input && input.text) || text, !!prior);
    if (prior) state.liens.push({ from: id, to: prior.id, kind: kind });
    if (kind === "compose") state.ouverts = [];
    else {
      nodes(text, prior && prior.text).forEach(function (n) { if (state.ouverts.indexOf(n) < 0) state.ouverts.push(n); });
      state.ouverts = state.ouverts.slice(-4);
    }
    state.prises.push({ id: id, author: (input && input.author) || "convive", text: text, tour: state.prises.length + 1 });
    paint();
    return state;
  }
  window.SalonConflict = { reset: reset, record: record, state: function () { return state; }, tension: function () { return tensionOf(state); }, sentiment: function () { return sentimentSeries(state); }, paint: paint };
  function ready(fn) {
    if (document.querySelector(".stream") || document.getElementById("circle-dyn") || document.body) { fn(); return; }
    setTimeout(function () { ready(fn); }, 40);
  }
  ready(function () {
    paint();
    document.addEventListener("submit", function (e) {
      if (e.target && e.target.id === "open-circle") {
        setTimeout(function () {
          var q = document.querySelector(".protocol p");
          reset(q ? q.textContent : "");
        }, 0);
      }
    }, true);
  });
})();
