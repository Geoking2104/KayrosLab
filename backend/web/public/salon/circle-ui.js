/* Salon — archive, encarts, mémoire d'échange, relances. */
(function () {
  var MEM_KEY = "salon-thread-memory";
  var mem = loadMem();
  window.salonMemory = mem;

  function loadMem() {
    try {
      var raw = sessionStorage.getItem(MEM_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { host: [], turns: [], byAuthor: {} };
  }
  function saveMem() {
    try { sessionStorage.setItem(MEM_KEY, JSON.stringify(mem)); } catch (e) {}
    window.salonMemory = mem;
  }
  function resetMem() {
    mem = { host: [], turns: [], byAuthor: {} };
    saveMem();
  }
  function clip(t, n) {
    t = String(t || "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
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
      var lastH = mem.host[mem.host.length - 1];
      if (lastH === text) return;
      mem.host.push(text);
      saveMem();
      paintMem();
      return;
    }
    var id = li.dataset.author || "inconnu";
    var sig = id + "|" + clip(text, 80);
    if (mem.turns.some(function (t) { return t.sig === sig; })) return;
    var rec = { id: id, role: role, text: clip(text, 420), proof: clip(proof, 180), sig: sig };
    mem.turns.push(rec);
    if (!mem.byAuthor[id]) mem.byAuthor[id] = [];
    mem.byAuthor[id].push(rec);
    saveMem();
    paintMem();
  }
  function dossier(id) {
    var mine = (mem.byAuthor[id] || []).map(function (t, i) {
      return (i + 1) + ". (" + t.role + ") " + t.text;
    }).join(" ");
    var others = mem.turns.filter(function (t) { return t.id !== id; }).slice(-6).map(function (t) {
      return "@" + t.id + " : " + clip(t.text, 140);
    }).join(" | ");
    var host = mem.host.slice(-3).join(" / ");
    return {
      mine: mine || "(première prise)",
      others: others || "(rien encore des autres)",
      host: host || ""
    };
  }
  function followUpPrompt() {
    var lastHost = mem.host[mem.host.length - 1] || "";
    var parts = seatedIds().map(function (id) {
      var last = (mem.byAuthor[id] || []).slice(-1)[0];
      return last ? "@" + id + " a posé : " + clip(last.text, 160) : null;
    }).filter(Boolean);
    var open = "Relance. Ne recommencez pas à zéro. Reprenez l'élément que vous avez apporté et répondez à ce que les autres ont ajouté.";
    if (lastHost) open += " Question de l'hôte : " + clip(lastHost, 200);
    if (parts.length) open += " Déjà sur la table — " + parts.join(" · ");
    return open;
  }
  function paintMem() {
    var box = document.getElementById("circle-mem");
    if (!box) return;
    var n = mem.turns.length;
    box.hidden = n === 0 && !mem.host.length;
    var host = mem.host[mem.host.length - 1] || "—";
    var lines = Object.keys(mem.byAuthor).map(function (id) {
      var arr = mem.byAuthor[id];
      return "<li><strong>@" + id + "</strong> · " + arr.length + " apport" + (arr.length > 1 ? "s" : "") + " — " + clip(arr[arr.length - 1].text, 110) + "</li>";
    }).join("");
    box.innerHTML = "<h2>Mémoire du cercle</h2><p class=\"cp-now\">" + n + " prise" + (n > 1 ? "s" : "") + " · hôte : " + clip(host, 140) + "</p><ol>" + lines + "</ol>";
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
        var who = "";
        var sys = String(body.system || "");
        var m = sys.match(/Tu es ([^.]+)\./);
        if (m) {
          var name = m[1];
          var hit = seatedIds().find(function (id) { return nameOf(id).indexOf(name) === 0 || name.indexOf(nameOf(id)) === 0; });
          who = hit || "";
        }
        var d = dossier(who);
        body.system = sys + " Tu as déjà dit : " + d.mine + " Les autres : " + d.others + " Relance à partir de ces éléments. N'efface rien. Ajoute un élément nouveau.";
        body.user = (body.user || "") + "\n\nMémoire du cercle :\nHôte : " + d.host + "\nToi : " + d.mine + "\nTable : " + d.others;
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
      var next = sel.value;
      li.dataset.author = next;
      var st = li.querySelector("header strong");
      if (st) st.textContent = nameOf(next);
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
        if (stream) stream.insertBefore(memBox, stream.querySelector("#compose") || stream.firstChild);
      }
    }
    if (document.getElementById("circle-next")) return document.getElementById("circle-next");
    var nxt = document.createElement("div");
    nxt.id = "circle-next"; nxt.hidden = true;
    nxt.innerHTML = "<h2>Fin de discussion</h2><p>La relance reprend les apports déjà dits.</p><div class=\"nx-row\"><button type=\"button\" class=\"btn\" data-nx=\"go\">Continuer la conversation</button><label>Intervenir comme <select class=\"next-role\" id=\"next-role\"><option value=\"hote\">hôte</option><option value=\"lecteur\">lecteur</option><option value=\"objecteur\">objecteur</option><option value=\"defenseur\">défenseur</option><option value=\"secretaire\">secrétaire</option></select></label><button type=\"button\" class=\"btn ghost\" data-nx=\"in\">Intervenir</button></div>";
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
      if (draft) draft.value = "[" + role + "] " + draft.value.trim() + " \u2014 " + followUpPrompt();
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
    }).observe(ol, { childList: true, subtree: true, characterData: true });
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
