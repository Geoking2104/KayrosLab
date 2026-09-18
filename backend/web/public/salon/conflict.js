/* ConflictState — prises liées, nœuds ouverts, tension dérivée */
(function () {
  var KIND_FR = { ouvre: "ouvre", accorde: "accorde", distingue: "distingue", contredit: "contredit", precise: "précise", compose: "compose" };
  function empty(dossier) {
    return { dossier: String(dossier || "").trim(), prises: [], liens: [], ouverts: [] };
  }
  function classify(role, text, hasPrior) {
    var blob = String(role || "") + " " + String(text || "");
    blob = blob.toLowerCase();
    if (!hasPrior) return "ouvre";
    if (/secr[eé]taire|minute|compose|reste ouvert/.test(blob)) return "compose";
    if (/objecte|contredit|ce n['’]est pas|je refuse|à l['’]inverse/.test(blob)) return "contredit";
    if (/objecteur|distingue|pourtant|cependant|ce n['’]est pas encore/.test(blob)) return "distingue";
    if (/d[eé]fenseur|pr[eé]cise|je tiens|contre l['’]objection/.test(blob)) return "precise";
    if (/j['’]accorde|je te l['’]accorde/.test(blob)) return "accorde";
    return "precise";
  }
  function nodes(prise, prior) {
    var src = (prior || "") + " " + prise;
    src = src.toLowerCase();
    var out = [], pairs = [
      [/autonome|autonomie/, "autonomie"],
      [/ind[eé]pendant/, "indépendance"],
      [/volont[eé]/, "volonté"],
      [/libert[eé]|\blibre\b/, "liberté"],
      [/conscience/, "conscience"],
      [/\bgrain\b|instance|session/, "grain du sujet"],
      [/d[eé]finition/, "définition"]
    ];
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i][0].test(src) && out.indexOf(pairs[i][1]) < 0) out.push(pairs[i][1]);
    }
    return out.slice(0, 3);
  }
  function unresolved(state) {
    var composed = {};
    state.liens.forEach(function (l) { if (l.kind === "compose") composed[l.to] = 1; });
    return state.liens.filter(function (l) {
      return (l.kind === "contredit" || l.kind === "distingue") && !composed[l.from];
    });
  }
  function tensionOf(state) {
    var open = unresolved(state);
    var c = 0, d = 0;
    open.forEach(function (l) { if (l.kind === "contredit") c++; else d++; });
    var t = 12 + c * 28 + d * 14 + state.ouverts.length * 6;
    if (t < 8) t = 8; if (t > 100) t = 100;
    return t;
  }
  function phaseOf(t) {
    return t >= 70 ? "opposition vive" : t >= 40 ? "tension ouverte" : t >= 20 ? "discussion" : "apaisement";
  }
  function byId(state) {
    var m = {};
    state.prises.forEach(function (p) { m[p.id] = p; });
    return m;
  }
  function describe(state) {
    var last = state.liens[state.liens.length - 1];
    var t = tensionOf(state);
    if (!last) {
      return state.prises[0]
        ? "@" + state.prises[0].author + " ouvre — « " + state.prises[0].text + " »"
        : "Pas encore de prise.";
    }
    var map = byId(state);
    var from = map[last.from], to = map[last.to];
    var open = state.ouverts.length ? " — ouvert : " + state.ouverts.join(", ") : "";
    return "@" + (from ? from.author : "?") + " " + KIND_FR[last.kind] + " " + (to ? "@" + to.author : "la table") + open + " · " + phaseOf(t) + " (" + t + ").";
  }
  var state = empty("");
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
    var prise = { id: id, author: (input && input.author) || "convive", text: text, tour: state.prises.length + 1 };
    var kind = classify(input && input.role, (input && input.text) || text, !!prior);
    if (prior) state.liens.push({ from: id, to: prior.id, kind: kind });
    if (kind === "compose") state.ouverts = [];
    else {
      nodes(text, prior && prior.text).forEach(function (n) {
        if (state.ouverts.indexOf(n) < 0) state.ouverts.push(n);
      });
      state.ouverts = state.ouverts.slice(-4);
    }
    state.prises.push(prise);
    paint();
    return state;
  }
  function paint() {
    var box = document.getElementById("circle-dyn");
    if (!box) return;
    box.hidden = false;
    var t = tensionOf(state);
    var fill = document.getElementById("dy-fill");
    if (fill) fill.style.width = t + "%";
    var read = document.getElementById("dy-read");
    if (read) read.textContent = describe(state);
    var ol = document.getElementById("dy-beats");
    if (ol) {
      var map = byId(state);
      ol.innerHTML = state.liens.slice(-8).map(function (l) {
        var from = map[l.from], to = map[l.to];
        var clip = from ? String(from.text).slice(0, 88) : "";
        return "<li>@" + (from ? from.author : "?") + " " + KIND_FR[l.kind] + " @" + (to ? to.author : "?") + (clip ? " — « " + clip + " »" : "") + "</li>";
      }).join("");
    }
    try { window.SALON_CONFLICT = state; } catch (e) {}
  }
  window.SalonConflict = { reset: reset, record: record, state: function () { return state; }, tension: function () { return tensionOf(state); }, paint: paint };
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form || !form.id) return;
    if (form.id === "open-circle") {
      setTimeout(function () {
        var q = document.querySelector(".protocol p");
        reset(q ? q.textContent : "");
      }, 0);
    }
  }, true);
})();
