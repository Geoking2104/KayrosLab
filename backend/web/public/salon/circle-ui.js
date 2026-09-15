/* Salon — mémoire JSON v3 + validation. */
(function () {
  var MEM_KEY = "salon-thread-memory-v3";
  var KEEP_RECENT = 2;
  var mem = loadMem();
  window.salonMemory = mem;

  function blank() {
    return { v: 3, host: [], turns: [], byAuthor: {}, digest: {}, open: [] };
  }
  function loadMem() {
    try {
      var raw = sessionStorage.getItem(MEM_KEY);
      if (raw) {
        var m = JSON.parse(raw);
        if (!m.digest) m.digest = {};
        if (!m.open) m.open = [];
        m.v = 3;
        return m;
      }
    } catch (e) {}
    return blank();
  }
  function saveMem() {
    compact();
    try { sessionStorage.setItem(MEM_KEY, JSON.stringify(mem)); } catch (e) {}
    window.salonMemory = mem;
  }
  function resetMem() {
    mem = blank();
    saveMem();
    paintMem();
  }
  function clip(t, n) {
    t = String(t || "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
  }
  function claim(text) {
    var t = String(text || "").replace(/\s+/g, " ").trim();
    var cut = t.split(/(?<=[.!?])\s+/)[0] || t;
    return clip(cut, 140);
  }
  function strOrNull(v, n) {
    if (v == null || v === "") return null;
    v = clip(String(v), n);
    return v || null;
  }
  function idOk(v) {
    v = String(v || "").toLowerCase();
    return /^[a-z0-9_]{1,40}$/.test(v) ? v : null;
  }
  function sanitizeContext(raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    var recent = raw.self && Array.isArray(raw.self.recent) ? raw.self.recent : [];
    var table = Array.isArray(raw.table) ? raw.table : [];
    var open = Array.isArray(raw.open) ? raw.open : [];
    return {
      v: 3,
      speaker: idOk(raw.speaker),
      anchor: strOrNull(raw.anchor, 160),
      host: strOrNull(raw.host, 160),
      self: {
        digest: strOrNull(raw.self && raw.self.digest, 280),
        recent: recent.slice(0, 2).map(function (t) {
          return { role: clip((t && t.role) || "invite", 40), claim: clip((t && t.claim) || "", 140) };
        }).filter(function (t) { return !!t.claim; })
      },
      table: table.slice(0, 4).map(function (t) {
        return { id: idOk(t && t.id) || "inconnu", role: clip((t && t.role) || "", 40), claim: clip((t && t.claim) || "", 140) };
      }).filter(function (t) { return !!t.claim; }),
      open: open.slice(0, 3).map(function (q) { return clip(q, 90); }).filter(Boolean)
    };
  }
  function validContext(ctx) {
    try {
      if (!ctx || ctx.v !== 3) return false;
      if (!ctx.self || !Array.isArray(ctx.self.recent)) return false;
      if (!Array.isArray(ctx.table) || !Array.isArray(ctx.open)) return false;
      if (ctx.speaker != null && !idOk(ctx.speaker)) return false;
      if (ctx.self.recent.length > 2 || ctx.table.length > 4 || ctx.open.length > 3) return false;
      JSON.parse(JSON.stringify(ctx));
      return true;
    } catch (e) { return false; }
  }
  function compact() {
    mem.host = mem.host.slice(-4);
    if (mem.host.length > 1) mem.host = [mem.host[0]].concat(mem.host.slice(-2));
    Object.keys(mem.byAuthor).forEach(function (id) {
      var arr = mem.byAuthor[id];
      if (arr.length <= KEEP_RECENT + 1) return;
      var old = arr.slice(0, -KEEP_RECENT);
      var fresh = arr.slice(-KEEP_RECENT);
      var prev = mem.digest[id] || "";
      var added = old.map(function (t) { return t.claim || claim(t.text); }).filter(Boolean);
      mem.digest[id] = clip((prev ? prev + " · " : "") + added.join(" · "), 280);
      mem.byAuthor[id] = fresh;
    });
    mem.turns = mem.turns.slice(-12);
    mem.open = mem.open.slice(-6);
  }
  function extractOpen(text) {
    var qs = String(text || "").match(/[^?]{12,80}\?/g);
    if (!qs) return;
    qs.slice(0, 2).forEach(function (q) {
      q = q.replace(/\s+/g, " ").trim();
      if (mem.open.indexOf(q) < 0) mem.open.push(q);
    });
  }
  function ready(fn) {
    if (document.getElementById("compose")) { fn(); return; }
    setTimeout(function () { ready(fn); }, 50);
  }
  function msgsOl() { return document.querySelector(".stream ol.msgs") || document.querySelector("ol.msgs"); }
  function seatedIds() {
    if (typeof selectedIds === "function") try { var s = selectedIds(); if (s && s.length) return s; } catch (e) {}
    return ["voltaire", "rousseau", "montaigne", "kant"];
  }
  function nameOf(id) {
    var a = typeof authors !== "undefined" ? authors.find(function (x) { return x.id === id; }) : null;
    if (a && typeof authorName === "function") return authorName(a);
    return a ? (a.name || id) : id;
  }
  function rememberLi(li) {
    if (!li || !li.classList || !li.classList.contains("msg")) return;
    var text = (li.querySelector("p") && li.querySelector("p").textContent) || "";
    if (!text || /r[eé]fl[eé]chit/i.test(text)) return;
    var proof = (li.querySelector("p.proof") && li.querySelector("p.proof").textContent) || "";
    var role = ((li.querySelector("header span") || {}).textContent || "").replace(/\s+/g, " ").trim();
    if (li.classList.contains("is-host")) {
      if (mem.host[mem.host.length - 1] === text) return;
      mem.host.push(clip(text, 280));
      extractOpen(text);
      saveMem(); paintMem(); return;
    }
    var id = idOk(li.dataset.author) || "inconnu";
    var sig = id + "|" + clip(text, 60);
    if (mem.turns.some(function (t) { return t.sig === sig; })) return;
    var rec = { id: id, role: clip(role, 40), text: clip(text, 360), claim: claim(text), proof: clip(proof, 120), sig: sig };
    mem.turns.push(rec);
    if (!mem.byAuthor[id]) mem.byAuthor[id] = [];
    mem.byAuthor[id].push(rec);
    extractOpen(text);
    saveMem(); paintMem();
  }
  function contextJSON(id) {
    var anchor = mem.host[0] || "";
    var lastH = mem.host[mem.host.length - 1] || "";
    return sanitizeContext({
      v: 3,
      speaker: id || null,
      anchor: clip(anchor, 160) || null,
      host: lastH && lastH !== anchor ? clip(lastH, 160) : null,
      self: {
        digest: mem.digest[id] || null,
        recent: (mem.byAuthor[id] || []).slice(-KEEP_RECENT).map(function (t) {
          return { role: t.role, claim: t.claim };
        })
      },
      table: mem.turns.filter(function (t) { return t.id !== id; }).slice(-4).map(function (t) {
        return { id: t.id, role: t.role, claim: t.claim };
      }),
      open: mem.open.slice(-3)
    });
  }
  function followUpPrompt() {
    var ctx = contextJSON("");
    var claims = (ctx.table || []).map(function (t) { return "@" + t.id + " : " + t.claim; });
    var seen = {};
    claims = claims.filter(function (c) { if (seen[c]) return false; seen[c] = 1; return true; });
    var s = "Relance. Garde tes apports. Ajoute un élément. Réponds à une objection déjà dite.";
    if (ctx.host || ctx.anchor) s += " Hôte : " + clip(ctx.host || ctx.anchor, 140);
    if (claims.length) s += " Claims : " + claims.join(" · ");
    if (ctx.open.length) s += " Encore ouvert : " + ctx.open.join(" | ");
    return clip(s, 520);
  }
  function paintMem() {
    var box = document.getElementById("circle-mem");
    if (!box) return;
    var n = mem.turns.length + Object.keys(mem.digest).length;
    box.hidden = n === 0 && !mem.host.length;
    var ok = validContext(contextJSON(seatedIds()[0] || ""));
    var lines = seatedIds().map(function (id) {
      var arr = mem.byAuthor[id] || [];
      var d = mem.digest[id];
      var last = arr[arr.length - 1];
      if (!d && !last) return "";
      return "<li><strong>@" + id + "</strong> · " + (d ? "digest + " : "") + arr.length + " récent" + (arr.length > 1 ? "s" : "") + " — " + clip((last && last.claim) || d || "", 100) + "</li>";
    }).join("");
    box.innerHTML = "<h2>Mémoire du cercle</h2><p class=\"cp-now\">schéma v3 " + (ok ? "valide" : "corrigé") + " · " + mem.turns.length + " prise" + (mem.turns.length > 1 ? "s" : "") + " · " + mem.open.length + " ouverte" + (mem.open.length > 1 ? "s" : "") + "</p><ol>" + lines + "</ol>";
  }
  function wrapFetch() {
    if (window.fetch && window.fetch.__salonMem) return;
    var orig = window.fetch.bind(window);
    function hooked(url, opts) {
      opts = opts || {};
      var u = String(url || "");
      if (u.indexOf("/v1/demo/chat") === -1) return orig(url, opts);
      try {
        var body = opts.body ? JSON.parse(opts.body) : {};
        var sys = String(body.system || "");
        var who = "";
        var m = sys.match(/Tu es ([^.]+)\./);
        if (m) {
          var name = m[1];
          who = seatedIds().find(function (id) { return nameOf(id).indexOf(name) === 0 || name.indexOf(nameOf(id)) === 0; }) || "";
        }
        var ctx = contextJSON(who);
        if (!validContext(ctx)) ctx = sanitizeContext({});
        body.system = clip(sys, 280);
        body.user = clip(String(body.user || "").replace(/\n+M[eé]moire[\s\S]*$/, ""), 280);
        body.context = ctx;
        opts = Object.assign({}, opts, { body: JSON.stringify(body) });
      } catch (e) {}
      return orig(url, opts);
    }
    hooked.__salonMem = true;
    window.fetch = hooked;
  }
  function archivePast() {
    var ol = msgsOl(); if (!ol) return;
    var kids = [].filter.call(ol.children, function (n) { return !n.classList.contains("past-thread"); });
    if (kids.length < 2) return;
    var box = document.createElement("details");
    box.className = "past-thread";
    box.innerHTML = "<summary>Discussion précédente — rouvrir</summary>";
    var wrap = document.createElement("ol");
    kids.forEach(function (n) { n.classList.add("is-past"); wrap.appendChild(n); });
    box.appendChild(wrap);
    ol.insertBefore(box, ol.firstChild);
  }
  function options(cur) {
    return seatedIds().map(function (id) {
      return "<option value=\"" + id + "\"" + (id === cur ? " selected" : "") + ">@" + id + " \u00b7 " + nameOf(id) + "</option>";
    }).join("");
  }
  function bindEncart(li) {
    if (!li || li.classList.contains("is-host") || li.querySelector("select.encart-who")) return;
    var head = li.querySelector("header span"); if (!head) return;
    var sel = document.createElement("select");
    sel.className = "encart-who";
    sel.setAttribute("aria-label", "Changer l'auteur");
    sel.innerHTML = options(li.dataset.author || "");
    sel.addEventListener("change", function () {
      li.dataset.author = sel.value;
      var st = li.querySelector("header strong");
      if (st) st.textContent = nameOf(sel.value);
    });
    head.appendChild(sel);
  }
  function ensureChrome() {
    if (!document.getElementById("salon-mem-css")) {
      var style = document.createElement("style");
      style.id = "salon-mem-css";
      style.textContent = "details.past-thread{margin:0 0 1rem;padding:.5rem .75rem;border:1px dashed color-mix(in oklch,var(--ink) 16%,transparent)}details.past-thread>summary{cursor:pointer;color:var(--muted);font-size:.85rem;letter-spacing:.04em;text-transform:uppercase}li.is-past{opacity:.42}select.encart-who,select.next-role{font:inherit;margin-left:.4rem;max-width:12rem}#circle-next,#circle-mem{margin:1rem 0;padding:.85rem 1rem;border:1px solid color-mix(in oklch,var(--ink) 14%,transparent)}#circle-next[hidden],#circle-mem[hidden]{display:none!important}#circle-next .nx-row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}#circle-mem ol{margin:.4rem 0 0;padding:0;list-style:none}#circle-mem li{font-size:.9rem;padding:.2rem 0;border-top:1px solid color-mix(in oklch,var(--ink) 8%,transparent)}";
      document.head.appendChild(style);
    }
    if (!document.getElementById("circle-mem")) {
      var memBox = document.createElement("div");
      memBox.id = "circle-mem"; memBox.hidden = true;
      var dyn = document.getElementById("circle-dyn");
      if (dyn) dyn.insertAdjacentElement("afterend", memBox);
      else {
        var stream = document.querySelector(".stream");
        if (stream) stream.insertBefore(memBox, stream.firstChild);
      }
    }
    if (document.getElementById("circle-next")) return document.getElementById("circle-next");
    var nxt = document.createElement("div");
    nxt.id = "circle-next"; nxt.hidden = true;
    nxt.innerHTML = "<h2>Fin de discussion</h2><p>Relance sur claims + questions ouvertes.</p><div class=\"nx-row\"><button type=\"button\" class=\"btn\" data-nx=\"go\">Continuer la conversation</button><label>Intervenir comme <select class=\"next-role\" id=\"next-role\"><option value=\"hote\">hôte</option><option value=\"lecteur\">lecteur</option><option value=\"objecteur\">objecteur</option><option value=\"defenseur\">défenseur</option><option value=\"secretaire\">secrétaire</option></select></label><button type=\"button\" class=\"btn ghost\" data-nx=\"in\">Intervenir</button></div>";
    var compose = document.getElementById("compose");
    if (compose) compose.insertAdjacentElement("beforebegin", nxt);
    nxt.addEventListener("click", function (e) {
      var b = e.target.closest("[data-nx]"); if (!b) return;
      var draft = document.getElementById("draft");
      var talk = document.querySelector('[data-i18n="talk"]');
      if (b.getAttribute("data-nx") === "go") {
        if (draft) draft.value = followUpPrompt();
        if (talk) talk.click();
        return;
      }
      var role = (document.getElementById("next-role") || {}).value || "hote";
      if (draft && !draft.value.trim()) { draft.placeholder = "Votre intervention en tant que " + role; draft.focus(); return; }
      if (draft) draft.value = "[" + role + "] " + clip(draft.value.trim(), 240);
      if (talk) talk.click();
    });
    return nxt;
  }
  function watch() {
    var ol = msgsOl(); if (!ol || ol.dataset.uiWatch) return;
    ol.dataset.uiWatch = "1";
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        [].forEach.call(m.addedNodes, function (n) {
          if (n.nodeType !== 1) return;
          if (n.classList.contains("msg")) {
            if (!n.classList.contains("is-host")) bindEncart(n);
            setTimeout(function () { rememberLi(n); }, 80);
          }
          if (n.classList.contains("turn-break")) ensureChrome().hidden = false;
        });
      });
    }).observe(ol, { childList: true, subtree: true });
    [].forEach.call(ol.querySelectorAll(".msg"), function (li) { bindEncart(li); rememberLi(li); });
  }
  function hookLaunch() {
    var form = document.getElementById("open-circle");
    if (form && !form.dataset.uiArch) {
      form.dataset.uiArch = "1";
      form.addEventListener("submit", function () { resetMem(); setTimeout(archivePast, 0); });
    }
    var talk = document.querySelector('[data-i18n="talk"]');
    if (talk && !talk.dataset.uiArch) {
      talk.dataset.uiArch = "1";
      talk.addEventListener("click", function () { archivePast(); });
    }
  }
  ready(function () { wrapFetch(); ensureChrome(); paintMem(); hookLaunch(); watch(); });
})();
