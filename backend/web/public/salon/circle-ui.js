/* Salon — archive du fil, encart auteur, fin de tour. */
(function () {
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
  function ensureNext() {
    if (document.getElementById("circle-next")) return document.getElementById("circle-next");
    var style = document.createElement("style");
    style.textContent = "details.past-thread{margin:0 0 1rem;padding:.5rem .75rem;border:1px dashed color-mix(in oklch,var(--ink) 16%,transparent)}details.past-thread>summary{cursor:pointer;color:var(--muted);font-size:.85rem;letter-spacing:.04em;text-transform:uppercase}li.is-past{opacity:.42}select.encart-who,select.next-role{font:inherit;margin-left:.4rem;max-width:12rem}#circle-next{margin:1rem 0;padding:.85rem 1rem;border:1px solid color-mix(in oklch,var(--ink) 14%,transparent)}#circle-next[hidden]{display:none!important}#circle-next .nx-row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}";
    document.head.appendChild(style);
    var nxt = document.createElement("div");
    nxt.id = "circle-next"; nxt.hidden = true;
    nxt.innerHTML = "<h2>Fin de discussion</h2><p>Continuez la table, ou intervenez sous un rôle.</p><div class=\"nx-row\"><button type=\"button\" class=\"btn\" data-nx=\"go\">Continuer la conversation</button><label>Intervenir comme <select class=\"next-role\" id=\"next-role\"><option value=\"hote\">hôte</option><option value=\"lecteur\">lecteur</option><option value=\"objecteur\">objecteur</option><option value=\"defenseur\">défenseur</option><option value=\"secretaire\">secrétaire</option></select></label><button type=\"button\" class=\"btn ghost\" data-nx=\"in\">Intervenir</button></div>";
    var compose = document.getElementById("compose");
    if (compose) compose.insertAdjacentElement("beforebegin", nxt);
    nxt.addEventListener("click", function (e) {
      var b = e.target.closest("[data-nx]"); if (!b) return;
      var draft = document.getElementById("draft");
      var talk = document.querySelector('[data-i18n="talk"]');
      if (b.getAttribute("data-nx") === "go") { if (talk) talk.click(); return; }
      var role = (document.getElementById("next-role") || {}).value || "hote";
      if (draft && !draft.value.trim()) { draft.placeholder = "Votre intervention en tant que " + role; draft.focus(); return; }
      if (draft) draft.value = "[" + role + "] " + draft.value.trim();
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
          if (n.classList.contains("msg") && !n.classList.contains("is-host")) bindEncart(n);
          if (n.classList.contains("turn-break")) { var nx = ensureNext(); nx.hidden = false; }
        });
      });
    }).observe(ol, { childList: true });
    [].forEach.call(ol.querySelectorAll(".msg:not(.is-host)"), bindEncart);
  }
  function hookLaunch() {
    var form = document.getElementById("open-circle");
    if (form && !form.dataset.uiArch) {
      form.dataset.uiArch = "1";
      form.addEventListener("submit", function () { setTimeout(archivePast, 0); });
    }
    var talk = document.querySelector('[data-i18n="talk"]');
    if (talk && !talk.dataset.uiArch) {
      talk.dataset.uiArch = "1";
      talk.addEventListener("click", function () { archivePast(); });
    }
  }
  ready(function () { ensureNext(); hookLaunch(); watch(); });
})();
