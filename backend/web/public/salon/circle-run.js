/* Salon — dynamique des conflits: tension, paires, beats. */
(function () {
  var running = false;
  var seated = ["voltaire", "rousseau", "montaigne", "kant"];
  var lastPlan = null;
  var dynamics = { tension: 12, beats: [], pairs: [] };
  var DEMO = "https://api.kayroslab.com/v1/demo/chat";
  var ROLE_ORDER = [
    { role: "lecteur", act: "lit", brief: "Tu ouvres. Tu poses la lecture." },
    { role: "objecteur", act: "objecte", brief: "Tu objectes a la lecture, sans la reprendre." },
    { role: "defenseur", act: "defend", brief: "Tu defendes ou precises contre l'objection." },
    { role: "secretaire", act: "minute", brief: "Tu clos par une minute. Pas de nouveau debat." }
  ];
  function boot() {
    if (typeof authors === "undefined" || !document.getElementById("open-circle")) { setTimeout(boot, 40); return; }
    injectUi(); hookMentions(); hookOpen(); hookCompose(); hookTalk();
  }
  function injectUi() {
    if (document.getElementById("circle-progress")) return;
    var style = document.createElement("style");
    style.textContent = "#circle-progress{margin:0 0 1rem;padding:.85rem 1rem;border:1px solid color-mix(in oklch,var(--ink) 14%,transparent)}#circle-progress[hidden],#circle-roles[hidden],#circle-dyn[hidden]{display:none!important}#circle-progress h2,#circle-roles h2,#circle-dyn h2{margin:0 0 .35rem;font-size:1.05rem}#circle-progress .cp-now,#circle-dyn .dy-read{margin:0 0 .5rem;color:var(--muted);font-size:.9rem}#circle-progress ol,#circle-dyn ol{list-style:none;margin:0;padding:0}#circle-progress li,#circle-dyn li{font-size:.9rem;padding:.22rem 0;border-top:1px solid color-mix(in oklch,var(--ink) 8%,transparent)}#circle-progress li:first-child,#circle-dyn li:first-child{border-top:0}#circle-progress .t{color:var(--muted);margin-right:.4rem}#circle-progress .is-live{color:var(--accent)}.msg.is-wait p{font-style:italic;color:var(--muted)}.msg p.proof{font-style:italic;color:var(--muted);margin:.55rem 0 0}#circle-roles,#circle-dyn{margin:0 0 1rem;padding:.75rem 1rem;border:1px solid color-mix(in oklch,var(--ink) 14%,transparent)}#circle-roles .cr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.4rem}#circle-roles button{font:inherit;text-align:left;padding:.45rem .55rem;border:1px solid color-mix(in oklch,var(--ink) 16%,transparent);background:transparent;cursor:pointer}#circle-roles button strong{display:block;font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}#circle-roles .cr-conflict{margin:.55rem 0 0;color:var(--accent)}#circle-dyn .dy-bar{height:.35rem;background:color-mix(in oklch,var(--ink) 10%,transparent);margin:0 0 .65rem}#circle-dyn .dy-bar>i{display:block;height:100%;width:12%;background:var(--accent)}#circle-dyn .dy-pair{color:var(--muted)}";
    document.head.appendChild(style);
    var box = document.createElement("div");
    box.id = "circle-progress"; box.hidden = true; box.setAttribute("aria-live", "polite");
    box.innerHTML = "<h2>Seance en cours</h2><p class=\"cp-now\" id=\"cp-now\">En attente d'une question.</p><ol id=\"cp-log\"></ol>";
    var roles = document.createElement("div");
    roles.id = "circle-roles"; roles.hidden = true;
    roles.innerHTML = "<h2>Roles a table</h2><p class=\"cr-note\">Un role, une voix. Cliquez pour echanger.</p><div class=\"cr-grid\" id=\"cr-grid\"></div><p class=\"cr-conflict\" id=\"cr-conflict\" hidden></p>";
    var dyn = document.createElement("div");
    dyn.id = "circle-dyn"; dyn.hidden = true;
    dyn.innerHTML = "<h2>Dynamique des conflits</h2><p class=\"dy-read\" id=\"dy-read\">La table n a pas encore d opposants.</p><div class=\"dy-bar\"><i id=\"dy-fill\"></i></div><ol id=\"dy-beats\"></ol>";
    var stream = document.querySelector(".stream");
    var header = stream && stream.querySelector(".protocol");
    if (header) { header.insertAdjacentElement("afterend", box); box.insertAdjacentElement("afterend", roles); }
    else if (stream) stream.insertBefore(box, stream.querySelector(".msgs"));
    roles.insertAdjacentElement("afterend", dyn);
    roles.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-role]");
      if (!btn || running) return;
      cycleRole(btn.getAttribute("data-role"));
    });
  }
  function clock() { var d = new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0"); }
  function showProgress() { var box = document.getElementById("circle-progress"); if (box) box.hidden = false; }
  function logStep(text, live) {
    showProgress();
    var ol = document.getElementById("cp-log"); if (!ol) return;
    ol.querySelectorAll(".is-live").forEach(function (n) { n.classList.remove("is-live"); });
    var li = document.createElement("li"); if (live) li.className = "is-live";
    li.innerHTML = "<span class=\"t\">" + clock() + "</span>";
    li.appendChild(document.createTextNode(text));
    ol.appendChild(li);
    while (ol.children.length > 12) ol.removeChild(ol.firstChild);
    var now = document.getElementById("cp-now"); if (now) now.textContent = text;
  }
  function findAuthor(id) { return authors.find(function (a) { return a.id === id; }) || null; }
  function guestIds() { return (seated && seated.length) ? seated.slice() : ["voltaire", "rousseau", "montaigne", "kant"]; }
  function mentionedSeated(text) {
    var ids = guestIds(); var found = [];
    String(text || "").toLowerCase().replace(/@([a-z0-9_]+)/g, function (_, id) {
      if (ids.indexOf(id) >= 0 && found.indexOf(id) < 0) found.push(id); return _;
    });
    return found;
  }
  function speakersFor(text) { var m = mentionedSeated(text); return m.length ? m : guestIds(); }
  function assignRoles(question, ids) {
    var allowed = guestIds(); var mentioned = mentionedSeated(question); var order = [];
    mentioned.forEach(function (id) { if (allowed.indexOf(id) >= 0 && order.indexOf(id) < 0) order.push(id); });
    (ids || allowed).forEach(function (id) { if (allowed.indexOf(id) >= 0 && order.indexOf(id) < 0) order.push(id); });
    var taken = {}; var seats = []; var conflicts = [];
    order.forEach(function (id, i) {
      if (i >= ROLE_ORDER.length) { seats.push({ id: id, role: "invite", act: "ecoute", brief: "Une phrase." }); return; }
      var slot = ROLE_ORDER[i];
      if (taken[slot.role]) { conflicts.push("@" + id + " visait aussi " + slot.role); seats.push({ id: id, role: "invite", act: "ecoute", brief: "Role pris." }); return; }
      if (mentioned.length >= 2 && i === 0) conflicts.push("@" + mentioned[0] + " lit, @" + mentioned[1] + " objecte");
      taken[slot.role] = id;
      seats.push({ id: id, role: slot.role, act: slot.act, brief: slot.brief });
    });
    return { seats: seats, conflicts: conflicts };
  }
  function paintRoles(plan) {
    lastPlan = plan;
    var bar = document.getElementById("circle-roles"); var grid = document.getElementById("cr-grid"); var note = document.getElementById("cr-conflict");
    if (!bar || !grid) return;
    bar.hidden = false;
    var byRole = {};
    (plan.seats || []).forEach(function (seat) { byRole[seat.role] = seat; });
    grid.innerHTML = ROLE_ORDER.map(function (slot) {
      var seat = byRole[slot.role]; var a = seat ? findAuthor(seat.id) : null;
      return "<button type=\"button\" data-role=\"" + slot.role + "\"><strong>" + slot.role + "</strong><span>@" + (seat ? seat.id : "vide") + " \u00b7 " + (a ? authorNameSafe(a) : "—") + "</span></button>";
    }).join("");
    if (note) { var txt = (plan.conflicts || []).join(" "); note.hidden = !txt; note.textContent = txt ? ("Conflit : " + txt) : ""; }
  }
  function resetDynamics() { dynamics = { tension: 12, beats: [], pairs: [] }; paintDynamics(); }
  function paintDynamics() {
    var box = document.getElementById("circle-dyn"); var read = document.getElementById("dy-read"); var fill = document.getElementById("dy-fill"); var ol = document.getElementById("dy-beats");
    if (!box) return;
    box.hidden = false;
    var t = Math.max(0, Math.min(100, dynamics.tension));
    if (fill) fill.style.width = t + "%";
    var last = dynamics.pairs[dynamics.pairs.length - 1];
    var phase = t >= 70 ? "vive opposition" : t >= 40 ? "tension ouverte" : t >= 20 ? "discussion" : "apaisement";
    if (read) read.textContent = last ? ("@" + last.from + " s oppose a @" + last.to + " — " + phase + " (" + t + ").") : ("Pas encore d opposition. Tension " + t + " — " + phase + ".");
    if (ol) ol.innerHTML = dynamics.beats.slice(-8).map(function (b) {
      return "<li>" + b.clock + " \u00b7 <strong>@" + b.id + "</strong> " + b.act + (b.to ? " <span class=\"dy-pair\">\u2192 @" + b.to + "</span>" : "") + (b.note ? " — " + b.note : "") + "</li>";
    }).join("");
  }
  function recordBeat(author, seat, guests) {
    var role = (seat && seat.role) || "invite";
    var act = (seat && seat.act) || "parle";
    var to = ""; var note = "";
    var lecteur = guests.find(function (g) { return g._seat && g._seat.role === "lecteur"; });
    var objecteur = guests.find(function (g) { return g._seat && g._seat.role === "objecteur"; });
    if (role === "lecteur") { dynamics.tension = Math.min(40, dynamics.tension + 8); note = "pose la these"; }
    else if (role === "objecteur") { to = lecteur ? lecteur.id : "lecteur"; dynamics.tension = Math.min(100, dynamics.tension + 28); dynamics.pairs.push({ from: author.id, to: to }); note = "ouvre le conflit"; }
    else if (role === "defenseur") { to = objecteur ? objecteur.id : "objecteur"; dynamics.tension = Math.max(18, dynamics.tension - 16); note = "tient la these"; }
    else if (role === "secretaire") { dynamics.tension = Math.max(8, Math.round(dynamics.tension * 0.45)); note = dynamics.tension < 25 ? "minute : conflit compose" : "minute : conflit encore vif"; }
    else { dynamics.tension = Math.max(10, dynamics.tension - 4); note = "observe"; }
    dynamics.beats.push({ clock: clock().slice(0, 5), id: author.id, act: act, to: to, note: note });
    paintDynamics();
  }
  function cycleRole(role) {
    var ids = guestIds();
    if (!ids.length || !lastPlan) return;
    var seats = lastPlan.seats.slice();
    var idx = seats.findIndex(function (s) { return s.role === role; });
    if (idx < 0) return;
    var current = seats[idx].id;
    var next = ids[(Math.max(0, ids.indexOf(current)) + 1) % ids.length];
    var other = seats.findIndex(function (s) { return s.id === next; });
    seats[idx].id = next; if (other >= 0) seats[other].id = current;
    lastPlan = { seats: seats, conflicts: ["Echange : " + role + " @" + next] };
    paintRoles(lastPlan);
    logStep("Role " + role + " : @" + current + " <-> @" + next);
  }
  function hookMentions() {
    var draft = document.getElementById("draft"); var suggest = document.getElementById("suggest");
    if (!draft || !suggest || draft.dataset.seatedHook) return;
    draft.dataset.seatedHook = "1";
    draft.addEventListener("input", function () {
      var at = draft.value.lastIndexOf("@");
      var tail = at >= 0 ? draft.value.slice(at + 1) : "";
      if (at < 0 || /\s/.test(tail)) { suggest.hidden = true; suggest.innerHTML = ""; return; }
      var needle = tail.toLowerCase();
      var hits = guestIds().map(function (id) { var a = findAuthor(id); return { id: id, name: a ? authorNameSafe(a) : id }; }).filter(function (h) { return h.id.indexOf(needle) === 0 || h.name.toLowerCase().indexOf(needle) >= 0; });
      suggest.innerHTML = hits.map(function (h) { return "<li><button type=\"button\" data-id=\"" + h.id + "\">@" + h.id + "<span>" + h.name + "</span></button></li>"; }).join("");
      suggest.hidden = hits.length === 0;
    });
  }
  function msgsOl() { return document.querySelector(".stream ol.msgs") || document.querySelector("ol.msgs"); }
  function fillProof(li, proof) {
    if (!li) return; var el = li.querySelector("p.proof"); if (!el) return;
    var t = String(proof || "").trim(); el.hidden = !t; el.textContent = t;
  }
  function userLang() {
    if (typeof locale !== "undefined" && locale === "en") return "en";
    try { if (localStorage.getItem("salon-locale") === "en") return "en"; } catch (e) {}
    return "fr";
  }
  function localizedBlurb(author) {
    if (!author) return "";
    return userLang() === "en" ? (author.blurbEn || author.blurb || "") : (author.blurb || author.blurbEn || "");
  }
  function proofFromAuthor(author) {
    var titles = ((author && author.works) || []).slice(0, 2).join(", ");
    var blurb = localizedBlurb(author).replace(/\s+/g, " ").trim().slice(0, 220);
    if (blurb) return "\u00ab " + blurb + " \u00bb" + (titles ? " \u2014 " + titles : "");
    return titles;
  }
  function appendBubble(opts) {
    var ol = msgsOl(); if (!ol) return null;
    var li = document.createElement("li");
    li.className = "msg" + (opts.host ? " is-host" : "") + (opts.wait ? " is-wait" : "");
    if (opts.host) li.dataset.userTurn = "1";
    if (opts.authorId) li.dataset.author = opts.authorId;
    var who = opts.name || "Vous"; var act = opts.act || "adresse"; var at = new Date().toISOString();
    var av = opts.host ? "<span class=\"avatar host\">H</span>" : (typeof avatarHtml === "function" && findAuthor(opts.authorId) ? avatarHtml(findAuthor(opts.authorId)) : "<span class=\"avatar\">" + who.slice(0, 1).toUpperCase() + "</span>");
    li.innerHTML = av + "<div><header><strong></strong><span></span><time datetime=\"" + at + "\"></time></header><p></p><p class=\"proof\" hidden></p></div>";
    li.querySelector("strong").textContent = who;
    li.querySelector("header span").textContent = act;
    li.querySelector("time").textContent = clock().slice(0, 5);
    li.querySelector("p").textContent = opts.text || "";
    fillProof(li, opts.proof);
    ol.appendChild(li);
    li.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return li;
  }
  function setProtocol(name, question) {
    var h = document.querySelector(".protocol h1"); var p = document.querySelector(".protocol p");
    if (h && name) h.textContent = name; if (p && question) p.textContent = question;
  }
  function lastQuestion() {
    var host = document.querySelectorAll(".msgs .is-host p");
    if (host.length) return host[host.length - 1].textContent || "";
    var draft = document.getElementById("draft"); return draft ? draft.value.trim() : "";
  }
  function authorNameSafe(a) {
    if (!a) return "Un convive";
    if (typeof authorName === "function") return authorName(a);
    return a.name || a.nameEn || a.id;
  }
  function localVoice(author, question) {
    var name = authorNameSafe(author);
    var work = (author.works || [])[0] || "mes livres";
    var blurb = localizedBlurb(author).replace(/\s+/g, " ").trim();
    var q = String(question || "").replace(/\s+/g, " ").trim().slice(0, 140);
    return { text: (name + " / " + work + " \u2014 " + q + " \u2014 " + (blurb || "La table n avance que si l on relit.")).slice(0, 520), proof: proofFromAuthor(author) };
  }
  function askVoice(author, question, seat) {
    var lang = userLang();
    var system = "Tu es " + authorNameSafe(author) + ". Role: " + ((seat && seat.role) || "invite") + ". " + ((seat && seat.brief) || "") + (lang === "en" ? " Answer in English." : " Reponds en francais.");
    logStep("Recherche de la voix de " + authorNameSafe(author) + "...", true);
    return fetch(DEMO, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ system: system, user: question }) })
      .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, j: j }; }); })
      .then(function (r) {
        var text = (r.j && (r.j.text || r.j.content)) || "";
        if (!r.ok || !text || /^\[mock\]/i.test(text)) return localVoice(author, question);
        return { text: text.replace(/\s+/g, " ").trim(), proof: proofFromAuthor(author) };
      }).catch(function () { return localVoice(author, question); });
  }
  function runTable(question, ids) {
    if (running) return Promise.resolve();
    question = String(question || "").trim();
    if (question.length < 2) { logStep("Rien a poser a la table."); return Promise.resolve(); }
    var plan = lastPlan && !mentionedSeated(question).length ? lastPlan : assignRoles(question, ids);
    var guests = plan.seats.map(function (seat) {
      var a = findAuthor(seat.id); if (!a) return null;
      a = Object.assign({}, a); a._seat = seat; return a;
    }).filter(Boolean);
    if (!guests.length) { logStep("Aucun convive a table."); return Promise.resolve(); }
    running = true; showProgress();
    logStep("Question recue : " + question.slice(0, 90));
    paintRoles(plan); paintDynamics();
    plan.conflicts.forEach(function (c) { logStep("Conflit de roles : " + c); });
    var chain = Promise.resolve();
    guests.forEach(function (author) {
      chain = chain.then(function () {
        var seat = author._seat || { role: "invite", act: "prend la parole" };
        var wait = appendBubble({ authorId: author.id, name: authorNameSafe(author), act: seat.role + " — cherche", wait: true, text: "Recherche en cours..." });
        return askVoice(author, question, seat).then(function (out) {
          var text = typeof out === "string" ? out : (out && out.text) || "";
          if (wait) {
            wait.classList.remove("is-wait");
            var actEl = wait.querySelector("header span"); if (actEl) actEl.textContent = seat.act;
            wait.querySelector("p").textContent = text;
            fillProof(wait, (out && out.proof) || proofFromAuthor(author));
          }
          recordBeat(author, seat, guests);
          return new Promise(function (ok) { setTimeout(ok, 220); });
        });
      });
    });
    return chain.then(function () { running = false; logStep("La table s est tue."); }).catch(function () { running = false; });
  }
  function hookOpen() {
    var form = document.getElementById("open-circle"); if (!form || form.dataset.circleHook) return;
    form.dataset.circleHook = "1";
    form.addEventListener("submit", function () {
      setTimeout(function () {
        var data = new FormData(form);
        var name = String(data.get("name") || "Cercle").trim();
        var question = String(data.get("question") || "").trim();
        var picked = typeof selectedIds === "function" ? selectedIds() : guestIds();
        if (picked.length < 2) return;
        seated = picked.slice(); lastPlan = null; resetDynamics();
        setProtocol(name, question);
        if (typeof show === "function") show("cercle");
        appendBubble({ host: true, name: "Vous", act: "ouvre la table", text: question });
        var stream = document.querySelector(".stream"); if (stream) stream.scrollIntoView({ behavior: "smooth", block: "start" });
        runTable(question, seated);
      }, 0);
    });
  }
  function hookCompose() {
    var form = document.getElementById("compose"); if (!form || form.dataset.circleHook) return;
    form.dataset.circleHook = "1";
    form.addEventListener("submit", function () {
      setTimeout(function () { var q = lastQuestion(); if (q.length >= 2) runTable(q, speakersFor(q)); }, 0);
    });
  }
  function hookTalk() {
    var btn = document.querySelector('[data-i18n="talk"]');
    if (!btn || btn.dataset.circleHook) return;
    btn.dataset.circleHook = "1";
    btn.addEventListener("click", function () {
      var draft = document.getElementById("draft");
      var typed = draft && draft.value.trim();
      var q = typed || lastQuestion();
      if (typed && typed.length >= 2) { appendBubble({ host: true, name: "Vous", act: "laisse la table parler", text: typed }); draft.value = ""; }
      if (q.length < 2) { showProgress(); logStep("Ecrivez d abord une question."); return; }
      runTable(q, speakersFor(q));
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
