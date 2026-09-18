/* Salon × Flux X — pupitre public (Pages). Copier / Intent. */
(function () {
  var COPY = {
    fr: {
      nav: "Flux X",
      title: "Répondre depuis un auteur",
      lead: "Collez un post X. Choisissez confirmation ou infirmation. Copiez, ou ouvrez X.",
      url: "URL ou identifiant",
      paste: "Texte du post",
      stanceC: "Confirmation",
      stanceI: "Infirmation",
      generate: "Proposer",
      copy: "Copier",
      intent: "Ouvrir X",
      need: "Entrez pour lier le compte X de l’hôte. Copier fonctionne déjà."
    },
    en: {
      nav: "X feed",
      title: "Reply in an author’s voice",
      lead: "Paste an X post. Choose confirmation or rebuttal. Copy, or open X.",
      url: "URL or id",
      paste: "Post text",
      stanceC: "Confirmation",
      stanceI: "Rebuttal",
      generate: "Propose",
      copy: "Copy",
      intent: "Open X",
      need: "Sign in to bind the host X account. Copy already works."
    }
  };

  function locale() {
    try { if (localStorage.getItem("salon-locale") === "en") return "en"; } catch (e) {}
    return document.documentElement.lang === "en" ? "en" : "fr";
  }
  function t(key) { return (COPY[locale()] || COPY.fr)[key] || key; }

  function parseId(raw) {
    raw = String(raw || "").trim();
    if (/^\d{5,19}$/.test(raw)) return raw;
    var m = raw.match(/status\/(\d{5,19})/i);
    return m ? m[1] : "";
  }

  function injectNav() {
    var nav = document.querySelector("header.mast nav, .salon-nav, header nav");
    if (!nav || nav.querySelector("[data-flux-x]")) return;
    var a = document.createElement("a");
    a.href = "/salon/flux/";
    a.setAttribute("data-flux-x", "1");
    a.textContent = t("nav");
    var agents = nav.querySelector('[data-pane="agents"], a[href*="agents"]');
    if (agents && agents.parentNode) nav.insertBefore(a, agents.nextSibling);
    else {
      var contact = nav.querySelector('[data-pane="contact"]');
      if (contact) nav.insertBefore(a, contact);
      else nav.appendChild(a);
    }
  }

  function injectSeanceLink() {
    var protocol = document.querySelector("#salon-center header, .salon-protocol, #lumieres");
    if (!protocol || document.querySelector("[data-flux-seance]")) return;
    var p = document.createElement("p");
    p.setAttribute("data-flux-seance", "1");
    p.style.margin = "0.4rem 0 0";
    p.innerHTML = '<a href="/salon/flux/?circle=lumieres">' + t("nav") + "</a>";
    protocol.appendChild(p);
  }

  function desk() {
    if (document.getElementById("flux-x-desk")) return document.getElementById("flux-x-desk");
    var wrap = document.createElement("main");
    wrap.id = "flux-x-desk";
    wrap.style.maxWidth = "40rem";
    wrap.style.padding = "1.2rem 1rem 3rem";
    wrap.innerHTML =
      '<p class="kicker">' + t("nav") + "</p>" +
      "<h1>" + t("title") + "</h1>" +
      "<p>" + t("lead") + "</p>" +
      "<p>" + t("need") + "</p>" +
      '<label style="display:block;margin:.8rem 0">' + t("url") +
      '<input id="fx-url" style="display:block;width:100%;margin-top:.3rem" placeholder="https://x.com/…/status/…"></label>' +
      '<label style="display:block;margin:.8rem 0">' + t("paste") +
      '<textarea id="fx-text" rows="5" style="display:block;width:100%;margin-top:.3rem"></textarea></label>' +
      "<p>" +
      '<label><input type="radio" name="fx-st" value="confirmation" checked> ' + t("stanceC") + "</label> " +
      '<label><input type="radio" name="fx-st" value="infirmation"> ' + t("stanceI") + "</label></p>" +
      '<p><button type="button" class="salon-btn" id="fx-go">' + t("generate") + "</button></p>" +
      '<textarea id="fx-out" rows="6" style="display:block;width:100%"></textarea>' +
      '<p style="display:flex;gap:.5rem;margin-top:.6rem">' +
      '<button type="button" class="salon-btn" id="fx-copy">' + t("copy") + "</button>" +
      '<button type="button" class="salon-btn" id="fx-intent">' + t("intent") + "</button></p>";
    return wrap;
  }

  function propose(text, stance) {
    var body = (text || "").trim().replace(/\s+/g, " ");
    if (!body) return "";
    if (stance === "infirmation") {
      return locale() === "en"
        ? "The claim does not hold. " + body.slice(0, 180)
        : "La thèse ne tient pas. " + body.slice(0, 180);
    }
    return locale() === "en"
      ? "This can stand. " + body.slice(0, 180)
      : "Cela peut se soutenir. " + body.slice(0, 180);
  }

  function bindDesk(root) {
    var go = root.querySelector("#fx-go");
    if (!go || go.getAttribute("data-bound")) return;
    go.setAttribute("data-bound", "1");
    go.addEventListener("click", function () {
      var st = (root.querySelector('input[name="fx-st"]:checked') || {}).value || "confirmation";
      root.querySelector("#fx-out").value = propose(root.querySelector("#fx-text").value, st);
    });
    root.querySelector("#fx-copy").addEventListener("click", function () {
      var v = root.querySelector("#fx-out").value;
      if (v && navigator.clipboard) navigator.clipboard.writeText(v);
    });
    root.querySelector("#fx-intent").addEventListener("click", function () {
      var v = root.querySelector("#fx-out").value;
      var id = parseId(root.querySelector("#fx-url").value);
      var u = "https://x.com/intent/tweet?text=" + encodeURIComponent(v);
      if (id) u += "&in_reply_to=" + id;
      window.open(u, "_blank", "noopener,noreferrer");
    });
  }

  function showDesk() {
    var onFlux = /\/salon\/flux\/?/.test(location.pathname) || location.hash === "#flux";
    if (!onFlux) return;
    if (document.getElementById("flux-x-desk")) return;
    var node = desk();
    var cercle = document.getElementById("cercle");
    if (cercle) cercle.hidden = true;
    document.body.appendChild(node);
    bindDesk(node);
  }

  function run() {
    injectNav();
    injectSeanceLink();
    showDesk();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
  setTimeout(run, 80);
  setTimeout(run, 500);
})();
