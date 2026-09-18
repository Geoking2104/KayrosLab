/* Gazette — Entrer / Lier X fonctionnent hors index Salon. */
(function () {
  var API = "https://api.kayroslab.com";
  var TOKEN_KEY = "kayros-salon-token";
  var SSO_KEY = "kayros-salon-sso";
  var X_REDIRECT = location.origin + "/salon/flux/callback/";

  function token() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
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
    if (!res.ok || !j.url) throw new Error(j.error || "SSO refusé");
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
    if (btn) btn.textContent = "Vers X…";
    fetch(API + "/v1/salon/x/oauth/start", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ redirectUri: X_REDIRECT, scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"] })
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (pack) {
        if (pack.j && pack.j.url) { location.href = pack.j.url; return; }
        if (btn) btn.textContent = pack.j && pack.j.error ? pack.j.error : "Lier X";
      })
      .catch(function () { if (btn) btn.textContent = "Lier X"; });
  }
  function hookBind() {
    var b = document.querySelector("[data-fx-bind]");
    if (!b || b.getAttribute("data-sso-hook")) return;
    var n = b.cloneNode(true);
    n.setAttribute("data-sso-hook", "1");
    b.parentNode.replaceChild(n, b);
    n.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!token()) {
        n.textContent = "Entrée…";
        startSalonSso(true).catch(function (err) { n.textContent = err.message || "Lier X"; });
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
    if (token()) btn.textContent = "Sortir";
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      if (token()) {
        try { localStorage.removeItem(TOKEN_KEY); } catch (err) {}
        location.reload();
        return;
      }
      btn.textContent = "Entrée…";
      startSalonSso(false).catch(function (err) { btn.textContent = err.message || "Entrer"; });
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
