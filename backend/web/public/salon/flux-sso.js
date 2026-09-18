/* Gazette — Entrer / Lier X. Les erreurs restent hors du bandeau. */
(function () {
  var API = "https://api.kayroslab.com";
  var TOKEN_KEY = "kayros-salon-token";
  var SSO_KEY = "kayros-salon-sso";
  var X_REDIRECT = location.origin + "/salon/flux/callback/";

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }
  function note(msg) {
    var el = document.getElementById("gz-sso-note");
    if (!el) {
      el = document.createElement("p");
      el.id = "gz-sso-note";
      el.style.cssText = "font-style:italic;color:#5a4e40;margin:.4rem 0 0;text-transform:none;letter-spacing:0;font-size:.88rem";
      var acc = document.querySelector("header.mast .account");
      if (acc && acc.parentNode) acc.parentNode.appendChild(el);
    }
    el.textContent = msg || "";
    el.hidden = !msg;
  }
  function label(btn, text) {
    if (btn) btn.textContent = text;
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
  async function startSalonSso(nextX) {
    var verifier = randomUrlToken(48);
    var state = randomUrlToken(16);
    var nonce = randomUrlToken(16);
    var challenge = await pkceChallenge(verifier);
    var redirectUri = location.origin + "/salon/flux/";
    sessionStorage.setItem(SSO_KEY, JSON.stringify({ verifier: verifier, state: state, nonce: nonce, redirectUri: redirectUri, nextX: !!nextX }));
    var res = await fetch(API + "/v1/auth/sso/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirectUri: redirectUri, state: state, challenge: challenge, nonce: nonce })
    });
    var j = await res.json().catch(function () { return {}; });
    if (!res.ok || !j.url) {
      var err = new Error(j.error || "sso");
      err.status = res.status;
      throw err;
    }
    location.assign(j.url);
  }
  async function finishSalonSso() {
    if (!/\/salon\/flux\/?$/.test(location.pathname.replace(/index\.html$/, ""))) return false;
    var q = new URLSearchParams(location.search);
    var stored = sessionStorage.getItem(SSO_KEY);
    if (!q.get("code") || !q.get("state") || !stored) return false;
    var payload;
    try { payload = JSON.parse(stored); } catch (e) { return false; }
    if (payload.state !== q.get("state")) return false;
    sessionStorage.removeItem(SSO_KEY);
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
  function headers() {
    var h = { Accept: "application/json", "Content-Type": "application/json" };
    if (token()) h.Authorization = "Bearer " + token();
    return h;
  }
  function startX(btn) {
    label(btn, "Vers X");
    fetch(API + "/v1/salon/x/oauth/start", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ redirectUri: X_REDIRECT, scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"] })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (pack) {
        if (pack.j && pack.j.url) { location.href = pack.j.url; return; }
        label(btn, "Lier X");
        note(pack.j && pack.j.error === "X_CLIENT_ID manquant"
          ? "X n’est pas encore configuré sur l’API."
          : "La liaison X n’a pas abouti.");
      })
      .catch(function () {
        label(btn, "Lier X");
        note("L’API X est injoignable.");
      });
  }
  function onSsoFail(btn, fallback) {
    label(btn, fallback);
    note("L’entrée SSO ne répond pas. Ouvrez Cercles pour entrer, puis revenez.");
  }
  function hookBind() {
    var b = document.querySelector("[data-fx-bind]");
    if (!b || b.getAttribute("data-sso-hook")) return;
    var n = b.cloneNode(true);
    n.setAttribute("data-sso-hook", "1");
    label(n, token() && n.getAttribute("data-bound") ? n.textContent : "Lier X");
    b.parentNode.replaceChild(n, b);
    n.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      note("");
      if (!token()) {
        label(n, "Entrée");
        startSalonSso(true).catch(function () { onSsoFail(n, "Lier X"); });
        return;
      }
      if (n.getAttribute("data-bound")) return;
      startX(n);
    });
  }
  function hookEnter() {
    var btn = document.getElementById("salon-auth");
    if (!btn || btn.getAttribute("data-sso")) return;
    btn.setAttribute("data-sso", "1");
    label(btn, token() ? "Sortir" : "Entrer");
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      note("");
      if (token()) {
        try { localStorage.removeItem(TOKEN_KEY); } catch (err) {}
        location.reload();
        return;
      }
      label(btn, "Entrée");
      startSalonSso(false).catch(function () { onSsoFail(btn, "Entrer"); });
    });
  }
  function boot() {
    finishSalonSso().then(function (done) {
      hookEnter();
      hookBind();
      setTimeout(hookBind, 120);
      setTimeout(hookBind, 500);
      if (done && done.nextX && token()) startX(document.querySelector("[data-fx-bind]"));
    }).catch(function () {
      hookEnter();
      hookBind();
    });
  }
  if (!/\/salon\/flux\/?$/.test(location.pathname.replace(/index\.html$/, ""))) return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
