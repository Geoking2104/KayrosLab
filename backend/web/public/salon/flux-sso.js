/* Gazette — « Lier X » ouvre le SSO X (OAuth 2.0 PKCE), pour lier le compte et
 * intégrer son contenu. Repli : entrée Salon (SSO) si l'hôte n'est pas connecté.
 * Les erreurs restent hors du bandeau. */
(function () {
  var API = "https://api.kayroslab.com";
  var TOKEN_KEY = "kayros-salon-token";
  var SSO_KEY = "kayros-salon-sso-x";
  var X_REDIRECT = location.origin + "/salon/flux/callback/";
  var X_SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"];
  var LINK_LABEL = "Lier X";

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function note(msg) {
    var el = document.getElementById("fx-x-note");
    if (!el) {
      el = document.createElement("p");
      el.id = "fx-x-note";
      el.style.cssText = "font-style:italic;color:#5a4e40;margin:.4rem 0 0;text-transform:none;letter-spacing:0;font-size:.88rem";
      var acc = document.querySelector("header.mast .account");
      if (acc && acc.parentNode) acc.parentNode.appendChild(el);
      else document.body.appendChild(el);
    }
    el.textContent = msg || "";
    el.hidden = !msg;
  }
  function setLabel(link, text) {
    if (link) link.textContent = text || LINK_LABEL;
  }
  function b64url(buf) {
    var bin = "", bytes = new Uint8Array(buf);
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function randomUrlToken(n) {
    var bytes = new Uint8Array(n);
    crypto.getRandomValues(bytes);
    return b64url(bytes);
  }
  async function pkceChallenge(verifier) {
    var hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return b64url(hash);
  }

  /* ---- Entrée Salon (SSO PKCE) : nécessaire avant de lier X ---- */
  async function startSalonSso() {
    var verifier = randomUrlToken(48);
    var state = randomUrlToken(16);
    var nonce = randomUrlToken(16);
    var challenge = await pkceChallenge(verifier);
    var redirectUri = location.origin + "/salon/flux/";
    try {
      sessionStorage.setItem(SSO_KEY, JSON.stringify({ verifier: verifier, state: state, nonce: nonce, redirectUri: redirectUri, nextX: true }));
    } catch (e) {}
    var res = await fetch(API + "/v1/auth/sso/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirectUri: redirectUri, state: state, challenge: challenge, nonce: nonce })
    });
    var j = await res.json().catch(function () { return {}; });
    if (!res.ok || !j.url) throw new Error(j.error || "sso");
    location.assign(j.url);
  }
  async function finishSalonSso() {
    if (!/\/salon\/flux\/?$/.test(location.pathname.replace(/index\.html$/, ""))) return false;
    var q = new URLSearchParams(location.search);
    var stored = null;
    try { stored = sessionStorage.getItem(SSO_KEY); } catch (e) {}
    if (!q.get("code") || !q.get("state") || !stored) return false;
    var payload;
    try { payload = JSON.parse(stored); } catch (e) { return false; }
    if (payload.state !== q.get("state")) return false;
    try { sessionStorage.removeItem(SSO_KEY); } catch (e) {}
    history.replaceState({}, "", location.pathname);
    var res = await fetch(API + "/v1/auth/sso/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: q.get("code"), codeVerifier: payload.verifier, redirectUri: payload.redirectUri, nonce: payload.nonce })
    });
    var j = await res.json().catch(function () { return {}; });
    if (!res.ok || !j.token) throw new Error(j.error || "SSO incomplet");
    try { localStorage.setItem(TOKEN_KEY, j.token); } catch (e) {}
    return { nextX: !!payload.nextX };
  }

  /* ---- Liaison X : ouvre l'écran de consentement X (OAuth 2.0) ---- */
  function headers() {
    var h = { Accept: "application/json", "Content-Type": "application/json" };
    if (token()) h.Authorization = "Bearer " + token();
    return h;
  }
  function startX(link) {
    setLabel(link, "Vers X…");
    note("");
    fetch(API + "/v1/salon/x/oauth/start", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ redirectUri: X_REDIRECT, scopes: X_SCOPES })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .then(function (pack) {
        if (pack.j && pack.j.url) { location.href = pack.j.url; return; }
        setLabel(link, LINK_LABEL);
        if (!token()) { note("Entrez par les Cercles pour lier votre compte X."); return; }
        if (pack.status === 503 || (pack.j && pack.j.error && /X_CLIENT_ID/.test(pack.j.error))) {
          note("X n’est pas encore configuré sur l’API.");
          return;
        }
        note("La liaison X n’a pas abouti. Réessayez.");
      })
      .catch(function () {
        setLabel(link, LINK_LABEL);
        note("L’API X est injoignable.");
      });
  }
  function linkX(ev) {
    if (ev) ev.preventDefault();
    var link = document.getElementById("fx-open-x");
    note("");
    if (!token()) {
      startSalonSso().catch(function () {
        note("L’entrée SSO ne répond pas. Ouvrez les Cercles pour entrer, puis revenez.");
      });
      return;
    }
    startX(link);
  }

  function boot() {
    var enter = document.getElementById("salon-auth");
    if (enter) enter.remove();
    document.querySelectorAll("[data-fx-bind]").forEach(function (b) { b.remove(); });
    var link = document.getElementById("fx-open-x");
    if (link && !link.getAttribute("data-hook")) {
      link.setAttribute("data-hook", "1");
      link.addEventListener("click", linkX);
      setLabel(link, LINK_LABEL);
    }
  }
  function resume() {
    finishSalonSso()
      .then(function (done) {
        boot();
        if (done && done.nextX && token()) {
          var link = document.getElementById("fx-open-x");
          if (link) startX(link);
        }
      })
      .catch(function () { boot(); });
  }

  if (!/\/salon\/flux\/?$/.test(location.pathname.replace(/index\.html$/, ""))) return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", resume);
  else resume();
  setTimeout(boot, 80);
  setTimeout(boot, 400);
})();
