/* Salon — lancer un cercle, tours de table, journal de recherche. */
(function () {
  var running = false;
  var DEMO = "https://api.kayroslab.com/v1/demo/chat";
  function boot() {
    if (typeof authors === "undefined" || !document.getElementById("open-circle")) { setTimeout(boot, 40); return; }
    injectUi(); hookOpen(); hookCompose(); hookTalk();
  }
  function injectUi() {
    if (document.getElementById("circle-progress")) return;
    var style = document.createElement("style");
    style.textContent = "#circle-progress{margin:0 0 1rem;padding:0.85rem 1rem 1rem;border:1px solid color-mix(in oklch,var(--ink) 14%,transparent);background:color-mix(in oklch,var(--paper) 88%,var(--accent));}#circle-progress[hidden]{display:none!important}#circle-progress h2{margin:0 0 .35rem;font-size:1.05rem}#circle-progress .cp-now{margin:0 0 .55rem;color:var(--muted);font-size:.92rem}#circle-progress ol{list-style:none;margin:0;padding:0;display:grid;gap:.28rem}#circle-progress li{font-size:.9rem;padding:.2rem 0;border-top:1px solid color-mix(in oklch,var(--ink) 8%,transparent)}#circle-progress li:first-child{border-top:0}#circle-progress .t{color:var(--muted);font-variant-numeric:tabular-nums;margin-right:.45rem}#circle-progress .is-live{color:var(--accent)}.msg.is-wait header span{color:var(--muted)}.msg.is-wait p{font-style:italic;color:var(--muted)}.msg p.proof{font-style:italic;color:var(--muted);margin:.55rem 0 0;font-size:.95em}";
    document.head.appendChild(style);
    var box = document.createElement("div");
    box.id = "circle-progress"; box.hidden = true; box.setAttribute("aria-live", "polite");
    box.innerHTML = "<h2>Seance en cours</h2><p class=\"cp-now\" id=\"cp-now\">En attente d'une question.</p><ol id=\"cp-log\"></ol>";
    var stream = document.querySelector(".stream");
    var header = stream && stream.querySelector(".protocol");
    if (header) header.insertAdjacentElement("afterend", box);
    else if (stream) stream.insertBefore(box, stream.querySelector(".msgs"));
  }
  function clock() { var d = new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0"); }
  function showProgress() { var box = document.getElementById("circle-progress"); if (box) box.hidden = false; }
  function setNow(text) { var el = document.getElementById("cp-now"); if (el) el.textContent = text; }
  function logStep(text, live) {
    showProgress();
    var ol = document.getElementById("cp-log"); if (!ol) return;
    ol.querySelectorAll(".is-live").forEach(function (n) { n.classList.remove("is-live"); });
    var li = document.createElement("li"); if (live) li.className = "is-live";
    li.innerHTML = "<span class=\"t\">" + clock() + "</span>";
    li.appendChild(document.createTextNode(text));
    ol.appendChild(li);
    while (ol.children.length > 12) ol.removeChild(ol.firstChild);
    setNow(text);
    li.scrollIntoView({ block: "nearest" });
  }
  function findAuthor(id) { return authors.find(function (a) { return a.id === id; }) || null; }
  function guestIds() {
    if (typeof selectedIds === "function") { var ids = selectedIds(); if (ids && ids.length) return ids; }
    return ["voltaire", "rousseau", "montaigne"];
  }
  function msgsOl() { return document.querySelector(".stream ol.msgs") || document.querySelector("ol.msgs"); }
  function fillProof(li, proof) {
    if (!li) return;
    var el = li.querySelector("p.proof");
    if (!el) return;
    var t = String(proof || "").trim();
    el.hidden = !t;
    el.textContent = t;
  }
  function proofFromAuthor(author) {
    if (!author) return "";
    var mem = author.memory || [];
    var bits = [];
    if (mem.length) {
      mem.slice(0, 2).forEach(function (m) {
        var quote = String(m.sample || m.text || "").replace(/\s+/g, " ").trim().slice(0, 280);
        var title = m.title || "";
        if (quote) bits.push("\u00ab " + quote + (quote.length >= 280 ? "\u2026" : "") + " \u00bb" + (title ? " \u2014 " + title : ""));
      });
    }
    if (!bits.length) {
      var works = author.works || [];
      var titles = works.slice(0, 2).join(", ");
      var blurb = (author.blurb || "").replace(/\s+/g, " ").trim().slice(0, 220);
      if (blurb) bits.push("\u00ab " + blurb + " \u00bb" + (titles ? " \u2014 " + titles : ""));
      else if (titles) bits.push(titles);
    }
    return bits.join(" ");
  }
  function appendBubble(opts) {
    var ol = msgsOl(); if (!ol) return null;
    var li = document.createElement("li");
    li.className = "msg" + (opts.host ? " is-host" : "") + (opts.wait ? " is-wait" : "");
    if (opts.host) li.dataset.userTurn = "1";
    if (opts.authorId) li.dataset.author = opts.authorId;
    var who = opts.name || "Vous"; var act = opts.act || "adresse"; var at = new Date().toISOString();
    var av = opts.host ? "<span class=\"avatar host\">H</span>" : (typeof avatarHtml === "function" && findAuthor(opts.authorId) ? avatarHtml(findAuthor(opts.authorId)) : "<span class=\"avatar\">" + (who.slice(0, 1).toUpperCase()) + "</span>");
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
    var blurb = (author.blurb || author.blurbEn || "").replace(/\s+/g, " ").trim();
    var q = String(question || "").replace(/\s+/g, " ").trim().slice(0, 140);
    var core = blurb || "La table n avance que si l on relit, pas si l on resume.";
    return { text: (name + " ouvre " + work + ". A votre question \u2014 " + q + " \u2014 je reponds depuis la page. " + core).slice(0, 520), proof: proofFromAuthor(author) };
  }
  function askVoice(author, question) {
    var system = "Tu es " + authorNameSafe(author) + (author.era ? " (" + author.era + ")" : "") + ". " + (author.blurb || "") + " Livres: " + ((author.works || []).slice(0, 5).join(", ") || "domaine public") + ". Reponds en francais, 70 a 130 mots, a la premiere personne, comme a une table. Cite un titre si tu peux. Pas de markdown.";
    logStep("Recherche de la voix de " + authorNameSafe(author) + "...", true);
    return fetch(DEMO, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ system: system, user: question }) })
      .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, j: j }; }); })
      .then(function (r) {
        var text = (r.j && (r.j.text || r.j.content)) || "";
        if (!r.ok || !text || /^\[mock\]/i.test(text)) { logStep("Mode local pour " + authorNameSafe(author) + " (modele distant indisponible)."); return localVoice(author, question); }
        logStep("Reponse recue de " + authorNameSafe(author) + ".");
        return { text: text.replace(/\s+/g, " ").trim(), proof: proofFromAuthor(author) };
      })
      .catch(function () { logStep("Le modele n a pas repondu \u2014 parole locale de " + authorNameSafe(author) + "."); return localVoice(author, question); });
  }
  function runTable(question, ids) {
    if (running) return Promise.resolve();
    question = String(question || "").trim();
    if (question.length < 2) { logStep("Rien a poser a la table."); return Promise.resolve(); }
    var guests = (ids || guestIds()).map(findAuthor).filter(Boolean);
    if (guests.length < 1) { logStep("Aucun convive a table."); return Promise.resolve(); }
    running = true; showProgress();
    logStep("Question recue : " + question.slice(0, 90));
    logStep(guests.length + " convive(s) vont parler.");
    var chain = Promise.resolve();
    guests.forEach(function (author, i) {
      chain = chain.then(function () {
        logStep((i + 1) + "/" + guests.length + " \u2014 memoire de " + authorNameSafe(author), true);
        var wait = appendBubble({ authorId: author.id, name: authorNameSafe(author), act: "cherche dans ses livres", wait: true, text: "Recherche en cours..." });
        return askVoice(author, question).then(function (out) {
          var text = typeof out === "string" ? out : (out && out.text) || "";
          var proof = typeof out === "string" ? proofFromAuthor(author) : (out && out.proof) || proofFromAuthor(author);
          if (wait) {
            wait.classList.remove("is-wait");
            var actEl = wait.querySelector("header span"); if (actEl) actEl.textContent = "prend la parole";
            wait.querySelector("p").textContent = text;
            fillProof(wait, proof);
          } else {
            appendBubble({ authorId: author.id, name: authorNameSafe(author), act: "prend la parole", text: text, proof: proof });
          }
          logStep(authorNameSafe(author) + " a parle.");
          try { if (typeof persistSoon === "function") persistSoon(); } catch (e) {}
          return new Promise(function (ok) { setTimeout(ok, 280); });
        });
      });
    });
    return chain.then(function () { logStep("La table s est tue. Vous pouvez relancer."); running = false; })
      .catch(function () { logStep("La seance s est interrompue."); running = false; });
  }
  function hookOpen() {
    var form = document.getElementById("open-circle"); if (!form || form.dataset.circleHook) return;
    form.dataset.circleHook = "1";
    form.addEventListener("submit", function () {
      setTimeout(function () {
        var data = new FormData(form);
        var name = String(data.get("name") || "Cercle").trim();
        var question = String(data.get("question") || "").trim();
        var ids = guestIds();
        if (ids.length < 2) return;
        setProtocol(name, question);
        if (typeof show === "function") show("cercle");
        appendBubble({ host: true, name: "Vous", act: "ouvre la table", text: question });
        var stream = document.querySelector(".stream"); if (stream) stream.scrollIntoView({ behavior: "smooth", block: "start" });
        runTable(question, ids);
      }, 0);
    });
  }
  function hookCompose() {
    var form = document.getElementById("compose"); if (!form || form.dataset.circleHook) return;
    form.dataset.circleHook = "1";
    form.addEventListener("submit", function () {
      setTimeout(function () {
        var q = lastQuestion();
        if (q.length < 2) return;
        logStep("Votre message est a table.");
        runTable(q, guestIds());
      }, 0);
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
      if (typed && typed.length >= 2) {
        appendBubble({ host: true, name: "Vous", act: "laisse la table parler", text: typed });
        draft.value = "";
      }
      if (q.length < 2) { showProgress(); logStep("Ecrivez d abord une question, ou ouvrez un cercle."); return; }
      runTable(q, guestIds());
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
