/* Overlay foyer : fil sémantique + titres français + ConflictState */
(function () {
  var TITLES = window.SALON_TITLES || {};
  var KEYS = Object.keys(TITLES).sort(function (a, b) { return b.length - a.length; });
  function rewriteTitles(s) {
    var out = String(s || "");
    for (var i = 0; i < KEYS.length; i++) {
      var src = KEYS[i];
      if (out.indexOf(src) >= 0) out = out.split(src).join(TITLES[src]);
    }
    return out;
  }
  function tableQuestion() {
    var p = document.querySelector(".protocol p");
    return p ? String(p.textContent || "").replace(/\s+/g, " ").trim() : "";
  }
  function thread() {
    var q = tableQuestion();
    var items = [].slice.call(document.querySelectorAll("ol.msgs li.msg"));
    var lines = [];
    items.slice(-8).forEach(function (li) {
      var name = ((li.querySelector("header strong") || {}).textContent || "").trim();
      var body = ((li.querySelector("p") || {}).textContent || "").replace(/\s+/g, " ").trim();
      var proof = ((li.querySelector("p.proof") || {}).textContent || "").trim();
      if (!body || /salon reflechit/i.test(body)) return;
      var prise = "";
      var m = proof.match(/Prise\s*[—\-]\s*(.+)/i);
      if (m) prise = m[1].replace(/\s{2,}.*$/, "").trim();
      lines.push({ name: name || (li.classList.contains("is-host") ? "Hôte" : "Convive"), text: body, prise: prise, host: li.classList.contains("is-host"), authorId: li.getAttribute("data-author") || "" });
    });
    var lastGuest = null;
    for (var i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].host) { lastGuest = lines[i]; break; }
    }
    return { q: q, lines: lines, lastGuest: lastGuest };
  }
  function roleOf(system) {
    var s = String(system || "").toLowerCase();
    if (/objecteur/.test(s)) return "objecteur";
    if (/defenseur/.test(s)) return "defenseur";
    if (/secretaire/.test(s)) return "secretaire";
    if (/lecteur/.test(s)) return "lecteur";
    return "invite";
  }
  function authorOf(system) {
    var m = String(system || "").match(/Tu incarnes\s+([^.(]+)/i) || String(system || "").match(/Tu es\s+([^.(]+)/i);
    return m ? m[1].trim().toLowerCase().replace(/\s+/g, "") : "convive";
  }
  function firstSentence(text) {
    var t = String(text || "").replace(/\s+/g, " ").trim();
    if (!t) return "";
    var parts = t.split(/(?<=[.!?…])\s+/);
    var i = 0;
    while (i < parts.length && parts[i].length < 24) i++;
    var s = (parts[i] || parts[0] || "").trim();
    if (s && !/[.!?…]$/.test(s)) s += ".";
    return s.slice(0, 240);
  }
  function parsePrise(raw) {
    var src = rewriteTitles(String(raw || "").replace(/\r\n/g, "\n").trim());
    var pm = src.match(/^\s*PRISE\s*:\s*(.+)$/im);
    var bm = src.match(/REPLIQUE\s*:\s*([\s\S]+)/i);
    var prise = pm ? pm[1].replace(/^[\u00ab"]+|[\u00bb"]+$/g, "").trim() : "";
    var text = bm ? bm[1].trim() : src.replace(/^\s*PRISE\s*:.*$/im, "").replace(/^\s*REPLIQUE\s*:\s*/im, "").trim();
    text = String(text || "").replace(/\s+/g, " ").trim();
    if (text && !/[.!?…\u00bb"]$/.test(text)) {
      var last = text.lastIndexOf(".");
      text = last > 40 ? text.slice(0, last + 1) : text + ".";
    }
    text = rewriteTitles(text);
    prise = rewriteTitles(prise || firstSentence(text));
    return { prise: prise.slice(0, 220), text: text };
  }
  function userBlock(system, asked) {
    var th = thread();
    var role = roleOf(system);
    var last = th.lastGuest;
    var conflict = window.SalonConflict && window.SalonConflict.state ? window.SalonConflict.state() : null;
    var open = conflict && conflict.ouverts && conflict.ouverts.length ? "Nœuds ouverts : " + conflict.ouverts.join(", ") + "." : "";
    var duty =
      role === "objecteur" && last
        ? "Tu objectes à la prise précédente. Nomme-la. Tu n'ouvres pas un autre sujet. Lien : distingue ou contredit."
        : role === "defenseur" && last
          ? "Tu précises contre l'objection, toujours sur la question de table. Lien : précise."
          : role === "secretaire"
            ? "Tu minutes : question, prises tenues, nœuds encore ouverts. Lien : compose. Pas de verdict hors fil."
            : "Tu réponds d'abord à la question de table. Une thèse, puis l'ancrage. Lien : ouvre.";
    var fil = th.lines.map(function (l) {
      return (l.name || "?") + (l.prise ? " [prise : " + l.prise + "]" : "") + " : " + l.text;
    }).join("\n");
    return [
      "Question de table (fil directeur) : " + (th.q || asked),
      last ? "Dernier tour : " + last.name + (last.prise ? " — prise : " + last.prise : "") + ". " + last.text : "Tu ouvres.",
      duty,
      open,
      "Chaque phrase enchaîne la précédente. Pas de dossier nouveau.",
      "Titres : uniquement le titre français reçu.",
      fil ? "Fil récent :\n" + fil : "",
      "Question de l'hôte : " + asked
    ].filter(Boolean).join("\n\n");
  }
  function remember(system, spoken) {
    if (!window.SalonConflict || !spoken || !spoken.prise) return;
    try {
      window.SalonConflict.record({
        author: authorOf(system),
        prise: spoken.prise,
        text: spoken.text,
        role: roleOf(system)
      });
    } catch (e) {}
  }
  var orig = window.fetch;
  if (!orig) return;
  window.fetch = function (url, opts) {
    var u = String(url || "");
    if (u.indexOf("/v1/demo/chat") === -1 || !opts || !opts.body) return orig.apply(this, arguments);
    var system = "";
    try {
      var body = JSON.parse(opts.body);
      system = String(body.system || "");
      /* Ne pas écraser le prompt du moteur : il porte déjà question, cadrage,
       * fil et passages (voir salon-engine.js). On n\'ajoute le contrat et le fil
       * que si l\'appel est encore l\'ancien. */
      if (system.indexOf("Contrat :") === -1) {
        body.system = system + "\n\nTu réfléchis : écoute la question et la dernière prise ; ancre-toi seulement si le lieu répond à CETTE question ; PRISE puis 3 à 7 phrases closes. Interdit : titre étranger ; phrase tronquée ; collage hors sujet.";
      }
      var usr = String(body.user || "");
      if (usr.indexOf("fil directeur") === -1) {
        body.user = userBlock(system, usr.replace(/^Question de l'hote:\s*/i, ""));
      }
      opts = Object.assign({}, opts, { body: JSON.stringify(body) });
    } catch (e) {}
    return orig.call(this, url, opts).then(function (res) {
      var clone = res.clone();
      return clone.json().then(function (j) {
        var raw = (j && (j.text || j.content)) || "";
        var spoken = parsePrise(raw);
        if (spoken.text) {
          remember(system, spoken);
          j.text = spoken.text;
          j.content = spoken.text;
          j.prise = spoken.prise;
          return new Response(JSON.stringify(j), { status: res.status, headers: { "content-type": "application/json" } });
        }
        return res;
      }).catch(function () { return res; });
    });
  };
})();
