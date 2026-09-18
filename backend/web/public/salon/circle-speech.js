/* Overlay: contrat de parole PRISE / REPLIQUE sur le foyer public */
(function () {
  var orig = window.fetch;
  if (!orig) return;
  function firstSentence(text) {
    var t = String(text || "").replace(/\s+/g, " ").trim();
    if (!t) return "";
    var parts = t.split(/(?<=[.!?\u2026])\s+/);
    var i = 0;
    while (i < parts.length && parts[i].length < 24) i++;
    var s = (parts[i] || parts[0] || "").trim();
    if (s && !/[.!?\u2026]$/.test(s)) s += ".";
    return s.slice(0, 240);
  }
  function parsePrise(raw) {
    var src = String(raw || "").replace(/\r\n/g, "\n").trim();
    var pm = src.match(/^\s*PRISE\s*:\s*(.+)$/im);
    var bm = src.match(/REPLIQUE\s*:\s*([\s\S]+)/i);
    var prise = pm ? pm[1].replace(/^[\u00ab"]+|[\u00bb"]+$/g, "").trim() : "";
    var text = bm ? bm[1].trim() : src.replace(/^\s*PRISE\s*:.*$/im, "").replace(/^\s*REPLIQUE\s*:\s*/im, "").trim();
    text = String(text || "").replace(/\s+/g, " ").trim();
    if (text && !/[.!?\u2026\u00bb"]$/.test(text)) {
      var last = text.lastIndexOf(".");
      text = last > 40 ? text.slice(0, last + 1) : text + ".";
    }
    if (!prise) prise = firstSentence(text);
    return { prise: prise.slice(0, 220), text: text };
  }
  window.fetch = function (url, opts) {
    var u = String(url || "");
    if (u.indexOf("/v1/demo/chat") === -1 || !opts || !opts.body) return orig.apply(this, arguments);
    try {
      var body = JSON.parse(opts.body);
      var extra = [
        "Tu reflechis en quatre temps sans les nommer: ecoute; memoire; jugement; parole.",
        "Format exact:",
        "PRISE: <these d'une phrase>",
        "REPLIQUE:",
        "<90 a 170 mots, phrases completes, premiere personne, un destinataire>",
        "Interdit: phrase tronquee; collage d'extrait hors sujet; liste; Je prends la question; On me connait ainsi."
      ].join(" ");
      body.system = String(body.system || "") + "\n\n" + extra;
      opts = Object.assign({}, opts, { body: JSON.stringify(body) });
    } catch (e) {}
    return orig.call(this, url, opts).then(function (res) {
      var clone = res.clone();
      return clone.json().then(function (j) {
        var raw = (j && (j.text || j.content)) || "";
        var spoken = parsePrise(raw);
        if (spoken.text) {
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
