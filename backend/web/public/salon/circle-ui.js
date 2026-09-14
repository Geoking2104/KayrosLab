/* Salon — mémoire contextuelle compacte. */
(function () {
  var MEM_KEY = "salon-thread-memory-v2";
  var BUDGET = 900;
  var KEEP_RECENT = 2;
  var mem = loadMem();
  window.salonMemory = mem;

  function blank() {
    return { host: [], turns: [], byAuthor: {}, digest: {}, open: [] };
  }
  function loadMem() {
    try {
      var raw = sessionStorage.getItem(MEM_KEY);
      if (raw) {
        var m = JSON.parse(raw);
        if (!m.digest) m.digest = {};
        if (!m.open) m.open = [];
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
  function tokens(s) { return Math.ceil(String(s || "").length / 4); }
  function compact() {
    mem.host = mem.host.slice(-4);
    if (mem.host.length > 1) mem.host = [mem.host[0]].concat(mem.host.slice(-2));
    Object.keys(mem.byAuthor).forEach(function (id) {
      var arr = mem.byAuthor[id];
      if (arr.length <= KEEP_RECENT + 1) return;
      var old = arr.slice(0, -KEEP_RECENT);
      var fresh = arr.slice(-KEEP_RECENT);
      var prev = mem.digest[id] || "";
      var added = old.map(function (t) { return claim(t.text); }).filter(Boolean);
      var merged = (prev ? prev + " · " : "") + added.join(" · ");
      mem.digest[id] = clip(merged, 280);
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
    var id = li.dataset.author || "inconnu";
    var sig = id + "|" + clip(text, 60);
    if (mem.turns.some(function (t) { return t.sig === sig; })) return;
    var rec = { id: id, role: clip(role, 40), text: clip(text, 360), claim: claim(text), proof: clip(proof, 120), sig: sig };
    mem.turns.push(rec);
    if (!mem.byAuthor[id]) mem.byAuthor[id] = [];
    mem.byAuthor[id].push(rec);
    extractOpen(text);
    saveMem(); paintMem();
  }
  function pack(id) {
    var parts = [];
    var push = function (label, val, cap) {
      if (!val) return;
      var bit = label + val;
      if (tokens(parts.join(" ") + bit) > BUDGET) bit = clip(bit, cap || 120);
      if (tokens(parts.join(" ") + bit) <= BUDGET) parts.push(bit);
    };
    var anchor = mem.host[0] || "";
    var lastH = mem.host[mem.host.length - 1] || "";
    push("Ancre : ", clip(anchor, 160), 160);
    if (lastH && lastH !== anchor) push("Hôte : ", clip(lastH, 160), 160);
    if (mem.digest[id]) push("Ton fil : ", mem.digest[id], 200);
    var mine = (mem.byAuthor[id] || []).slice(-KEEP_RECENT);
    if (mine.length) push("Toi à l'instant : ", mine.map(function (t) { return "(" + t.role + ") " + t.claim; }).join(" · "), 220);
    var others = mem.turns.filter(function (t) { return t.id !== id; }).slice(-4);
    if (others.length) push("Table : ", others.map(function (t) { return "@" + t.id + " " + t.claim; }).join(" · "), 260);
    if (mem.open.length) push("Ouvert : ", mem.open.slice(-3).join(" | "), 180);
    return parts.join("\n") || "(mémoire vide)";
  }
  function dossier(id) {
    var packed = pack(id);
    return { packed: packed, mine: (mem.digest[id] || "") + " " + ((mem.byAuthor[id] || []).slice(-1)[0] || {}).claim || "", others: mem.turns.filter(function (t) { return t.id !== id; }).slice(-3).map(function (t) { return "@" + t.id + " " + t.claim; }).join(" · "), host: mem.host.slice(-1)[0] || "" };
  }
  function followUpPrompt() {
    var lastHost = mem.host[mem.host.length - 1] || "";
    var claims = seatedIds().map(function (id) {
      var last = (mem.byAuthor[id] || []).slice(-1)[0];
      var d = mem.digest[id];
      if (!last && !d) return null;
      return "@" + id + " : " + clip((last && last.claim) || d, 110);
    }).filter(Boolean);
    var open = mem.open.slice(-2).join(" ");
    var s = "Relance. Garde tes apports antérieurs. Ajoute un élément. Réponds à une objection déjà dite.";
    if (lastHost) s += " Hôte : " + clip(lastHost, 140);
    if (claims.length) s += " Claims : " + claims.join(" · ");
    if (open) s += " Encore ouvert : " + open;
    return clip(s, 520);
  }
  function paintMem() {
    var box = document.getElementById("circle-mem");
    if (!box) return;
    var n = mem.turns.length + Object.keys(mem.digest).length;
    box.hidden = n === 0 && !mem.host.length;
    var used = tokens(pack(seatedIds()[0] || ""));
    var lines = seatedIds().map(function (id) {
      var arr = mem.byAuthor[id] || [];
      var d = mem.digest[id];
      var last = arr[arr.length - 1];
      if (!d && !last) return "";
      return "<li><strong>@" + id + "</strong> · " + (d ? "digest + " : "") + arr.length + " récent" + (arr.length > 1 ? "s" : "") + " — " + clip((last && last.claim) || d || "", 100) + "</li>";
    }).join("");
    box.innerHTML = "<h2>Mémoire du cercle</h2><p class=\"cp-now\">" + used + " / " + BUDGET + " tokens estimés · " + mem.open.length + " question" + (mem.open.length > 1 ? "s" : "") + " ouverte" + (mem.open.length > 1 ? "s" : "") + "</p><ol>" + lines + "</ol>";
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
        var packed = pack(who);
        body.system = clip(sys, 280) + " Contexte compact. Ne répète pas tes claims. Ajoute un élément et tranche une question ouverte.";
        body.user = clip(body.user || "", 220) + "\n\n" + packed;
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
    nxt.innerHTML = "<h2>Fin de discussion</h2><p>Relance sur claims + questions ouvertes, pas sur le texte brut.</p><div class=\"nx-row\"><button type=\"button\" class=\"btn\" data-nx=\"go\">Continuer la conversation</button><label>Intervenir comme <select class=\"next-role\" id=\"next-role\"><option value=\"hote\">hôte</option><option value=\"lecteur\">lecteur</option><option value=\"objecteur\">objecteur</option><option value=\"defenseur\">défenseur</option><option value=\"secretaire\">secrétaire</option></select></label><button type=\"button\" class=\"btn ghost\" data-nx=\"in\">Intervenir</button></div>";
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
