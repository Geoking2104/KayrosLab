/* Salon × X — native, invisible. Une missive dans le fil, pas un outil. */
(function () {
  var API = "https://api.kayroslab.com";
  var TOKEN_KEY = "kayros-salon-token";
  var REDIRECT = (/(^|\.)kayroslab\.com$/i.test(location.hostname) ? "https://www.kayroslab.com" : location.origin) + "/salon/flux/callback";

  var COPY = {
    fr: {
      gazette: "Gazette",
      missive: "Une missive arrive à table.",
      confirm: "Confirmer",
      object: "Objecter",
      carry: "Porter sur X",
      copied: "Prêt — le brouillon X s’ouvre.",
      bind: "Lier X",
      bound: "X lié",
      unbind: "Délier",
      enterFirst: "Entrez d’abord — puis un geste lie X.",
      binding: "Vers X…",
      gazetteLead: "Ce qui arrive du dehors s’assoit ici comme une question.",
      drop: "Une URL x.com devient une question à la table."
    },
    en: {
      gazette: "Gazette",
      missive: "A letter reaches the table.",
      confirm: "Confirm",
      object: "Object",
      carry: "Carry to X",
      copied: "Ready — the X draft opens.",
      bind: "Bind X",
      bound: "X bound",
      unbind: "Unbind",
      enterFirst: "Sign in first — then one gesture binds X.",
      binding: "To X…",
      gazetteLead: "What arrives from outside sits here as a question.",
      drop: "An x.com URL becomes a question at the table."
    }
  };

  function locale() {
    try { if (localStorage.getItem("salon-locale") === "en") return "en"; } catch (e) {}
    return document.documentElement.lang === "en" ? "en" : "fr";
  }
  function t(k) { return (COPY[locale()] || COPY.fr)[k] || k; }
  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function parseStatus(raw) {
    raw = String(raw || "").trim();
    if (/^\d{5,19}$/.test(raw)) return { id: raw, url: "https://x.com/i/web/status/" + raw };
    var m = raw.match(/(?:x\.com|twitter\.com)\/(?:i\/web\/status|[^/\s]+\/status)\/(\d{5,19})/i);
    if (m) return { id: m[1], url: raw.split(/\s/)[0] };
    return null;
  }
  function extractUrl(text) {
    var m = String(text || "").match(/https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^\s]+/i);
    return m ? m[0] : "";
  }

  function style() {
    if (document.getElementById("flux-x-css")) return;
    var el = document.createElement("style");
    el.id = "flux-x-css";
    el.textContent = [
      ".fx-missive{margin:0 0 1rem;padding:0 0 .85rem;border-bottom:1px solid color-mix(in oklch,var(--ink,#1a1412) 14%,transparent)}",
      ".fx-missive .kicker{margin:0 0 .2rem;font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;color:var(--accent,#6b2a2a)}",
      ".fx-missive blockquote{margin:.35rem 0 .6rem;padding:0;border:0;font-style:italic;color:var(--ink-2,#4a4038)}",
      ".fx-missive .gestes,.fx-letter .gestes{display:flex;gap:.9rem;flex-wrap:wrap}",
      ".fx-missive button,.fx-whisper,.fx-bind,.fx-letter button{background:none;border:0;padding:0;font:inherit;color:var(--accent,#6b2a2a);cursor:pointer;text-decoration:underline;text-underline-offset:3px}",
      ".fx-whisper{font-size:.82rem;margin-top:.35rem;display:inline-block}",
      ".fx-note{font-size:.88rem;color:var(--ink-2,#4a4038);margin:.4rem 0 0}",
      ".fx-gazette{max-width:38rem;padding:1.4rem 1.1rem 4rem}",
      ".fx-gazette h1{font-size:clamp(1.8rem,4vw,2.5rem);line-height:1.12;font-weight:550;margin:.2rem 0 .5rem}",
      ".fx-drop{margin:1.2rem 0;padding:1.1rem;border:1px dashed color-mix(in oklch,var(--ink,#1a1412) 22%,transparent)}",
      ".fx-drop.is-on{border-color:var(--accent,#6b2a2a)}",
      ".fx-letter{margin:1rem 0;padding:1rem 0;border-top:1px solid color-mix(in oklch,var(--ink,#1a1412) 14%,transparent)}",
      "header.mast nav a[data-flux-x]{font-style:italic}"
    ].join("");
    document.head.appendChild(el);
  }

  function navQuiet() {
    var nav = document.querySelector("header.mast nav");
    if (!nav) return;
    var old = nav.querySelector("[data-flux-x]");
    if (old) { old.textContent = t("gazette"); old.href = "/salon/flux/"; return; }
    var a = document.createElement("a");
    a.href = "/salon/flux/";
    a.setAttribute("data-flux-x", "1");
    a.textContent = t("gazette");
    var contact = nav.querySelector('[data-pane="contact"]');
    if (contact) nav.insertBefore(a, contact);
    else nav.appendChild(a);
  }

  function propose(text, stance) {
    var body = String(text || "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
    if (!body) body = locale() === "en" ? "the claim as stated" : "la thèse telle qu’énoncée";
    if (stance === "infirmation") {
      return locale() === "en" ? "The claim does not hold. " + body.slice(0, 200) : "La thèse ne tient pas. " + body.slice(0, 200);
    }
    return locale() === "en" ? "This can stand. " + body.slice(0, 200) : "Cela peut se soutenir. " + body.slice(0, 200);
  }
  function intentUrl(text, statusId) {
    var u = "https://x.com/intent/tweet?text=" + encodeURIComponent(text);
    if (statusId) u += "&in_reply_to=" + encodeURIComponent(statusId);
    return u;
  }
  function carry(text, statusId) {
    if (navigator.clipboard && text) navigator.clipboard.writeText(text).catch(function () {});
    window.open(intentUrl(text, statusId), "_blank", "noopener,noreferrer");
  }

  function attachWhispers() {
    document.querySelectorAll(".stream li.msg:not(.is-host):not([data-fx])").forEach(function (li) {
      li.setAttribute("data-fx", "1");
      var box = li.querySelector("div");
      if (!box || box.querySelector(".fx-whisper")) return;
      var p = box.querySelector("p");
      var a = document.createElement("button");
      a.type = "button";
      a.className = "fx-whisper";
      a.textContent = t("carry");
      a.addEventListener("click", function () {
        var last = document.querySelector(".fx-missive");
        var id = last && last.getAttribute("data-status");
        carry((p && p.textContent) || "", id || "");
      });
      box.appendChild(a);
    });
  }

  function renderMissive(form, parsed, leftover) {
    var prev = form.parentNode.querySelector(":scope > .fx-missive");
    if (prev) prev.remove();
    var card = document.createElement("aside");
    card.className = "fx-missive";
    card.setAttribute("data-status", parsed.id);
    var safe = parsed.url.replace(/"/g, "");
    card.innerHTML = '<p class="kicker">' + t("missive") + "</p><blockquote><a href=\"" + safe + '" target="_blank" rel="noopener">' + safe.replace(/^https?:\/\//, "") + "</a></blockquote><div class=\"gestes\">" +
      '<button type="button" data-st="confirmation">' + t("confirm") + "</button>" +
      '<button type="button" data-st="infirmation">' + t("object") + "</button></div><p class=\"fx-note\" hidden></p>";
    form.parentNode.insertBefore(card, form);
    var note = card.querySelector(".fx-note");
    card.querySelectorAll("button[data-st]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var spoken = propose(leftover || "", btn.getAttribute("data-st"));
        var ta = form.querySelector("#draft");
        if (ta) ta.value = spoken;
        note.hidden = false;
        note.textContent = t("copied");
        carry(spoken, parsed.id);
      });
    });
  }

  function watchCompose() {
    var ta = document.getElementById("draft");
    var form = document.getElementById("compose") || (ta && ta.closest("form"));
    if (!ta || !form || ta.getAttribute("data-fx-watch")) return;
    ta.setAttribute("data-fx-watch", "1");
    function scan() {
      var url = extractUrl(ta.value);
      var parsed = url ? parseStatus(url) : null;
      if (!parsed) {
        var prev = form.parentNode.querySelector(":scope > .fx-missive");
        if (prev) prev.remove();
        return;
      }
      renderMissive(form, parsed, ta.value.replace(url, "").trim());
    }
    ta.addEventListener("input", scan);
    ta.addEventListener("paste", function () { setTimeout(scan, 0); });
    scan();
  }

  function headers() {
    var h = { Accept: "application/json", "Content-Type": "application/json" };
    var tok = token();
    if (tok) h.Authorization = "Bearer " + tok;
    return h;
  }

  function bindAccount() {
    var acc = document.querySelector("header.mast .account");
    if (!acc || acc.querySelector("[data-fx-bind]")) return;
    var b = document.createElement("button");
    b.type = "button";
    b.className = "fx-bind";
    b.setAttribute("data-fx-bind", "1");
    b.style.marginLeft = ".7rem";
    b.textContent = t("bind");
    acc.appendChild(b);
    function paint(binding) {
      if (binding && binding.handle) {
        b.textContent = t("bound") + " @" + binding.handle;
        b.setAttribute("data-bound", "1");
      } else {
        b.textContent = t("bind");
        b.removeAttribute("data-bound");
      }
    }
    if (token()) {
      fetch(API + "/v1/salon/x/binding", { headers: headers() })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { paint(j && (j.binding || j)); })
        .catch(function () {});
    }
    b.addEventListener("click", function () {
      if (!token()) {
        var enter = document.getElementById("salon-auth");
        if (enter) enter.click();
        return;
      }
      if (b.getAttribute("data-bound")) {
        if (!confirm(t("unbind") + " ?")) return;
        fetch(API + "/v1/salon/x/binding", { method: "DELETE", headers: headers() }).then(function () { paint(null); });
        return;
      }
      b.textContent = t("binding");
      fetch(API + "/v1/salon/x/oauth/start", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ redirectUri: REDIRECT, scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"] })
      })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j && j.url) location.href = j.url; else b.textContent = t("bind"); })
        .catch(function () { b.textContent = t("bind"); });
    });
  }

  function handleCallback() {
    if (!/\/salon\/flux\/callback\/?/.test(location.pathname)) return false;
    var q = new URLSearchParams(location.search);
    var code = q.get("code");
    var state = q.get("state");
    var box = document.createElement("main");
    box.className = "fx-gazette";
    box.innerHTML = "<p class=\"kicker\">" + t("gazette") + "</p><h1>" + t("binding") + "</h1>";
    document.body.appendChild(box);
    if (!code) { box.innerHTML += "<p>" + t("enterFirst") + "</p>"; return true; }
    fetch(API + "/v1/salon/x/oauth/callback", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ code: code, state: state })
    })
      .then(function (r) { return r.json(); })
      .then(function () { location.replace("/salon/"); })
      .catch(function () { box.innerHTML += "<p>" + t("enterFirst") + "</p>"; });
    return true;
  }

  function gazette() {
    if (!/\/salon\/flux\/?$/.test(location.pathname.replace(/index\.html$/, ""))) return;
    if (document.getElementById("fx-gazette")) return;
    var main = document.createElement("main");
    main.id = "fx-gazette";
    main.className = "fx-gazette";
    main.innerHTML = '<p class="kicker">' + t("gazette") + "</p><h1>" + t("gazette") + "</h1><p>" + t("gazetteLead") +
      '</p><div class="fx-drop" id="fx-drop"><p>' + t("drop") +
      '</p><input id="fx-in" style="display:block;width:100%;margin-top:.6rem;border:0;background:transparent;font:inherit;color:inherit" placeholder="https://x.com/…/status/…"></div><div id="fx-letters"></div>';
    document.body.appendChild(main);
    var drop = main.querySelector("#fx-drop");
    var input = main.querySelector("#fx-in");
    var letters = main.querySelector("#fx-letters");
    function addLetter(parsed, extra) {
      var art = document.createElement("article");
      art.className = "fx-letter";
      var safe = parsed.url.replace(/"/g, "");
      art.innerHTML = "<blockquote><a href=\"" + safe + '" target="_blank" rel="noopener">' + safe.replace(/^https?:\/\//, "") +
        "</a></blockquote><div class=\"gestes\">" +
        '<button type="button" data-st="confirmation">' + t("confirm") + "</button>" +
        '<button type="button" data-st="infirmation">' + t("object") + "</button></div>";
      art.querySelectorAll("button[data-st]").forEach(function (btn) {
        btn.addEventListener("click", function () { carry(propose(extra || "", btn.getAttribute("data-st")), parsed.id); });
      });
      letters.prepend(art);
    }
    function ingest(text) {
      var parsed = parseStatus(text) || parseStatus(extractUrl(text));
      if (!parsed) return;
      addLetter(parsed, text);
      input.value = "";
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); ingest(input.value); }
    });
    drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("is-on"); });
    drop.addEventListener("dragleave", function () { drop.classList.remove("is-on"); });
    drop.addEventListener("drop", function (e) {
      e.preventDefault(); drop.classList.remove("is-on");
      ingest((e.dataTransfer && e.dataTransfer.getData("text")) || "");
    });
  }

  function run() {
    style();
    if (handleCallback()) return;
    navQuiet();
    bindAccount();
    watchCompose();
    attachWhispers();
    gazette();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
  setTimeout(run, 80);
  setTimeout(run, 400);
  new MutationObserver(function () { attachWhispers(); watchCompose(); }).observe(document.documentElement, { childList: true, subtree: true });
})();
