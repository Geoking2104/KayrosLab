/* Mise en scène : dialogue au centre, dynamique à gauche, statut, relance */
(function () {
  var busy = false;
  var tick = null;
  var pct = 0;
  var phase = "idle";

  function css() {
    var st = document.getElementById("salon-stage-css");
    if (!st) { st = document.createElement("style"); st.id = "salon-stage-css"; document.head.appendChild(st); }
    st.textContent = [
      "html{overflow-x:hidden}",
      "body.salon-staged .hero, body.salon-staged .catalog, body.salon-staged #open-circle, body.salon-staged footer.site{display:none!important}",
      "body.salon-staged .mast{position:sticky;top:0;z-index:4;background:var(--paper,#f4efe6);padding:.4rem .8rem;border-bottom:1px solid color-mix(in oklch,var(--ink) 10%,transparent)}",
      ".salon-stage{display:grid;grid-template-columns:minmax(220px,280px) minmax(0,1fr);grid-template-areas:'rail center';gap:1.25rem;align-items:start;max-width:1180px;margin:0 auto;padding:1rem 1.1rem calc(3rem + env(safe-area-inset-bottom));width:100%;box-sizing:border-box}",
      "#salon-rail{grid-area:rail;position:sticky;top:.75rem;max-height:calc(100vh - 1.5rem);overflow:auto;padding-right:.2rem;-webkit-overflow-scrolling:touch}",
      "#salon-center{grid-area:center;min-width:0;max-width:100%}",
      "#salon-rail #circle-dyn,#salon-rail #salon-conflict-viz,#salon-rail #circle-mem,#salon-rail #salon-kg{margin:0 0 .85rem;font-size:.88rem;max-width:100%;overflow:hidden}",
      "#salon-rail svg{max-width:100%;height:auto;max-height:160px}",
      "#salon-center .stream{margin:0;max-width:100%}",
      "#salon-center ol.msgs{min-height:36vh;overflow-wrap:anywhere;word-break:break-word}",
      "#salon-center li.msg{max-width:100%}",
      "#salon-status{display:none;margin:.6rem 0 .85rem;padding:.55rem .75rem;border:1px dashed color-mix(in oklch,var(--ink) 18%,transparent)}",
      "#salon-status.is-on{display:block}",
      "#salon-status .st-row{display:flex;justify-content:space-between;gap:.75rem;font-size:.86rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}",
      "#salon-status .st-bar{height:.32rem;margin-top:.4rem;background:color-mix(in oklch,var(--ink) 10%,transparent)}",
      "#salon-status .st-fill{height:100%;width:0;background:var(--accent,#7a2e24);transition:width .2s linear}",
      "#salon-relance{display:none;margin:.85rem 0 0;padding:.85rem 1rem;border:1px solid color-mix(in oklch,var(--ink) 16%,transparent)}",
      "#salon-relance.is-on{display:block}",
      "#salon-relance h2{margin:0 0 .35rem;font-family:Fraunces,serif;font-size:1.05rem}",
      "#salon-relance .rl-row{display:flex;flex-wrap:wrap;gap:.45rem;margin-top:.55rem}",
      "#salon-relance button{font:inherit;cursor:pointer;padding:.55rem .8rem;min-height:44px;border:1px solid color-mix(in oklch,var(--ink) 22%,transparent);background:transparent}",
      "#salon-relance button.primary{background:var(--ink,#2c2118);color:var(--paper,#f4efe6)}",
      "#compose{position:sticky;bottom:0;background:var(--paper,#f4efe6);padding:.6rem 0 calc(.35rem + env(safe-area-inset-bottom));z-index:3}",
      "#compose textarea,#compose input,#draft{max-width:100%;box-sizing:border-box;font-size:16px}",
      ".salon-back{margin:0 0 .75rem;font-size:.82rem}",
      ".salon-back a{color:inherit}",
      "@media(max-width:860px){",
      ".salon-stage{grid-template-columns:1fr;grid-template-areas:'center' 'rail';gap:.85rem;padding:.75rem .75rem calc(4rem + env(safe-area-inset-bottom))}",
      "#salon-rail{position:relative;top:auto;max-height:none;order:2}",
      "#salon-rail details.rail-pack{border:1px solid color-mix(in oklch,var(--ink) 14%,transparent);padding:.4rem .6rem}",
      "#salon-rail details.rail-pack>summary{cursor:pointer;font-size:.82rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);min-height:44px;display:flex;align-items:center}",
      "#salon-center ol.msgs{min-height:48vh}",
      "body.salon-staged .mast nav{overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch}",
      "}",
      "@media(max-width:420px){#salon-relance button{flex:1 1 calc(50% - .45rem)}}"
    ].join("");
  }

  function streamEl() { return document.querySelector(".stream"); }
  function composeEl() { return document.getElementById("compose"); }
  function msgsOl() { return document.querySelector(".stream ol.msgs") || document.querySelector("ol.msgs"); }
  function isMobile() { return window.matchMedia && window.matchMedia("(max-width:860px)").matches; }

  function activate() { if (!msgsOl()) return; stageOn(); watch(); dock(); }
  function stageOn() {
    css();
    if (document.getElementById("salon-stage")) {
      document.body.classList.add("salon-staged");
      dock();
      return;
    }
    var stream = streamEl();
    if (!stream) return;
    var wrap = document.createElement("div");
    wrap.id = "salon-stage";
    wrap.className = "salon-stage";
    var rail = document.createElement("aside");
    rail.id = "salon-rail";
    rail.setAttribute("aria-label", "Dynamique et connaissances");
    var center = document.createElement("section");
    center.id = "salon-center";
    var back = document.createElement("p");
    back.className = "salon-back";
    back.innerHTML = '<a href="#" data-leave-stage>Retour à la table</a>';
    var status = document.createElement("div");
    status.id = "salon-status";
    status.innerHTML = '<div class="st-row"><span id="st-label">À l’écoute</span><span id="st-pct">0 %</span></div><div class="st-bar" aria-hidden="true"><div class="st-fill" id="st-fill"></div></div>';
    var relance = document.createElement("div");
    relance.id = "salon-relance";
    relance.innerHTML = "<h2>La table s’arrête</h2><p class=\"rl-copy\">Le dernier tour est clos. Relancez le fil, ou changez de rôle.</p><div class=\"rl-row\"></div>";
    var parent = stream.parentNode;
    parent.insertBefore(wrap, stream);
    wrap.appendChild(center);
    wrap.appendChild(rail);
    center.appendChild(back);
    center.appendChild(stream);
    center.appendChild(status);
    center.appendChild(relance);
    var compose = composeEl();
    if (compose) center.appendChild(compose);
    document.body.classList.add("salon-staged");
    dock();
    wrap.addEventListener("click", function (e) {
      var a = e.target.closest("[data-leave-stage]");
      if (!a) return;
      e.preventDefault();
      document.body.classList.remove("salon-staged");
    });
    bindRelance();
  }

  function packRail(rail) {
    if (!isMobile()) {
      var pack = rail.querySelector("details.rail-pack");
      if (pack) {
        while (pack.firstChild) {
          if (pack.firstChild.tagName === "SUMMARY") { pack.removeChild(pack.firstChild); continue; }
          rail.appendChild(pack.firstChild);
        }
        pack.remove();
      }
      return;
    }
    var pack = rail.querySelector("details.rail-pack");
    if (!pack) {
      pack = document.createElement("details");
      pack.className = "rail-pack";
      var sum = document.createElement("summary");
      sum.textContent = "Dynamique et graphes";
      pack.appendChild(sum);
      rail.insertBefore(pack, rail.firstChild);
    }
    ["circle-dyn", "salon-conflict-viz", "salon-kg", "circle-mem"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode !== pack) pack.appendChild(el);
    });
  }

  function dock() {
    var rail = document.getElementById("salon-rail");
    if (!rail) return;
    ["circle-dyn", "salon-conflict-viz", "salon-kg", "circle-mem"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode !== rail && !(el.parentNode && el.parentNode.classList && el.parentNode.classList.contains("rail-pack"))) {
        rail.appendChild(el);
      }
    });
    packRail(rail);
    var nxt = document.getElementById("circle-next");
    if (nxt) nxt.hidden = true;
  }

  function setStatus(on, label, value) {
    var box = document.getElementById("salon-status");
    if (!box) return;
    box.classList.toggle("is-on", !!on);
    var lab = document.getElementById("st-label");
    var pctEl = document.getElementById("st-pct");
    var fill = document.getElementById("st-fill");
    if (lab) lab.textContent = label || "";
    var n = Math.max(0, Math.min(100, Math.round(value || 0)));
    if (pctEl) pctEl.textContent = n + " %";
    if (fill) fill.style.width = n + "%";
    box.setAttribute("aria-busy", on ? "true" : "false");
  }

  function startThink(who) {
    busy = true;
    phase = "think";
    pct = 4;
    hideRelance();
    setStatus(true, (who ? who + " réfléchit" : "Le salon réfléchit"), pct);
    clearInterval(tick);
    tick = setInterval(function () {
      if (!busy) return;
      if (phase === "think" && pct < 58) pct += 2 + Math.random() * 4;
      else if (phase === "write" && pct < 92) pct += 1 + Math.random() * 3;
      else if (pct < 96) pct += 0.4;
      setStatus(true, phase === "write" ? (who ? who + " écrit" : "Écriture") : (who ? who + " réfléchit" : "Réflexion"), pct);
    }, 180);
  }

  function markWrite() { phase = "write"; if (pct < 60) pct = 62; }

  function stopThink() {
    busy = false;
    phase = "idle";
    clearInterval(tick);
    setStatus(true, "Tour clos", 100);
    setTimeout(function () { setStatus(false, "", 0); maybeRelance(); }, 700);
  }

  function hideRelance() {
    var box = document.getElementById("salon-relance");
    if (box) box.classList.remove("is-on");
  }

  function lastGuestName() {
    var items = [].slice.call(document.querySelectorAll("ol.msgs li.msg"));
    for (var i = items.length - 1; i >= 0; i--) {
      if (items[i].classList.contains("is-host")) continue;
      var st = items[i].querySelector("header strong");
      if (st) return st.textContent.trim();
    }
    return "le dernier convive";
  }

  function draft() { return document.getElementById("draft"); }
  function talkBtn() { return document.querySelector('[data-i18n="talk"]'); }

  function fire(text) {
    var d = draft();
    var b = talkBtn();
    if (d) d.value = text;
    if (b) b.click();
    hideRelance();
  }

  function bindRelance() {
    var box = document.getElementById("salon-relance");
    if (!box || box.dataset.bound) return;
    box.dataset.bound = "1";
    box.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-rl]");
      if (!btn) return;
      var kind = btn.getAttribute("data-rl");
      var q = ((document.querySelector(".protocol p") || {}).textContent || "").replace(/\s+/g, " ").trim();
      var who = lastGuestName();
      if (kind === "suite") fire("Relance. Reste sur la question : " + q + " Réponds à la dernière prise de " + who + ". Avance d’un cran, sans changer de dossier.");
      else if (kind === "objet") fire("[objecteur] Objecte à la prise de " + who + ", sur la question : " + q);
      else if (kind === "defense") fire("[defenseur] Précise et tiens la thèse contre l’objection, question : " + q);
      else if (kind === "minute") fire("[secretaire] Minute le conflit : question, prises tenues, nœuds encore ouverts.");
      else if (kind === "hote") {
        var d = draft();
        if (d) { d.placeholder = "Votre relance d’hôte"; d.focus(); }
        hideRelance();
      }
    });
  }

  function showRelance() {
    var box = document.getElementById("salon-relance");
    if (!box) return;
    var row = box.querySelector(".rl-row");
    if (row) {
      row.innerHTML = [
        '<button type="button" class="primary" data-rl="suite">Continuer le fil</button>',
        '<button type="button" data-rl="objet">Faire objecter</button>',
        '<button type="button" data-rl="defense">Faire défendre</button>',
        '<button type="button" data-rl="minute">Faire minuter</button>',
        '<button type="button" data-rl="hote">Intervenir comme hôte</button>'
      ].join("");
    }
    var copy = box.querySelector(".rl-copy");
    if (copy) copy.textContent = "Dernier tour : " + lastGuestName() + ". Choisissez comment le fil reprend.";
    box.classList.add("is-on");
  }

  function maybeRelance() {
    if (busy) return;
    var ol = msgsOl();
    if (!ol) return;
    var hasTurn = !!ol.querySelector(".turn-break") || (ol.querySelectorAll("li.msg:not(.is-host)").length >= 2);
    if (hasTurn && !ol.querySelector(".msg.is-thinking")) showRelance();
  }

  function hookFetch() {
    if (!window.fetch || window.fetch.__salonStage) return;
    var orig = window.fetch;
    function wrapped(url, opts) {
      var u = String(url || "");
      if (u.indexOf("/v1/demo/chat") === -1) return orig.apply(this, arguments);
      var who = "";
      try {
        var body = opts && opts.body ? JSON.parse(opts.body) : {};
        var sys = String(body.system || "");
        var m = sys.match(/Tu incarnes\s+([^.(]+)/i) || sys.match(/Tu es\s+([^.(]+)/i);
        if (m) who = m[1].trim();
      } catch (e) {}
      startThink(who);
      var p = orig.apply(this, arguments);
      return Promise.resolve(p).then(function (res) {
        markWrite();
        return res;
      }).finally(function () {
        setTimeout(stopThink, 80);
      });
    }
    wrapped.__salonStage = true;
    window.fetch = wrapped;
  }

  function watch() {
    var ol = msgsOl();
    if (!ol || ol.dataset.stageWatch) return;
    ol.dataset.stageWatch = "1";
    new MutationObserver(function (muts) {
      stageOn();
      dock();
      muts.forEach(function (m) {
        [].forEach.call(m.addedNodes, function (n) {
          if (n.nodeType !== 1) return;
          if (n.classList && n.classList.contains("turn-break")) setTimeout(maybeRelance, 200);
          if (/r[eé]fl[eé]chit/i.test(n.textContent || "")) startThink();
        });
      });
    }).observe(ol, { childList: true, subtree: true });
  }

  function hookOpen() {
    var form = document.getElementById("open-circle");
    if (form && !form.dataset.stage) {
      form.dataset.stage = "1";
      form.addEventListener("submit", function () {
        setTimeout(function () { stageOn(); dock(); hideRelance(); }, 30);
      });
    }
  }

  function ready(fn) {
    if (document.body) { fn(); return; }
    setTimeout(function () { ready(fn); }, 40);
  }

  ready(function () {
    css();
    hookFetch();
    hookOpen();
    window.addEventListener("resize", function () { dock(); });
    window.addEventListener("salon:table", function () { setTimeout(activate, 30); });
    if (document.body.classList.contains("salon-table")) setTimeout(activate, 30);
    var origDock = window.SalonConflict && window.SalonConflict.paint;
    if (origDock) {
      window.SalonConflict.paint = function () {
        origDock();
        dock();
        if (window.SalonGraph && window.SalonGraph.paint) window.SalonGraph.paint();
      };
    }
  });
})();
