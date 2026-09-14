/* Salon think + waves + richer voice */
(function () {
  var running = false, pending = null, lastPlan = null;
  var seated = ["voltaire", "rousseau", "montaigne", "kant"];
  var dynamics = { tension: 12, beats: [], pairs: [] };
  var DEMO = "https://api.kayroslab.com/v1/demo/chat";
  var ROLE_ORDER = [
    { role: "lecteur", act: "lit", brief: "Tu construis une lecture, pas une citation." },
    { role: "objecteur", act: "objecte", brief: "Tu objectes. Argumente. Ne recopie pas un livre." },
    { role: "defenseur", act: "defend", brief: "Tu precises contre l'objection." },
    { role: "secretaire", act: "minute", brief: "Tu resumes le conflit et ce qui reste ouvert." }
  ];
  function boot() {
    if (typeof authors === "undefined" || !document.getElementById("open-circle")) { setTimeout(boot, 40); return; }
    injectUi(); hookMentions(); hookOpen(); hookCompose(); hookTalk();
  }
  function injectUi() {
    if (document.getElementById("circle-think")) return;
    var style = document.createElement("style");
    style.textContent = "#circle-think,#circle-progress,#circle-roles,#circle-dyn{margin:0 0 1rem;padding:.85rem 1rem;border:1px solid color-mix(in oklch,var(--ink) 14%,transparent)}#circle-think[hidden],#circle-progress[hidden],#circle-roles[hidden],#circle-dyn[hidden]{display:none!important}#circle-think h2,#circle-progress h2,#circle-roles h2,#circle-dyn h2{margin:0 0 .35rem;font-size:1.05rem}#circle-think{background:color-mix(in oklch,var(--paper) 82%,var(--accent))}#circle-think.is-on h2{color:var(--accent)}#circle-think p,.cp-now,.dy-read{margin:0 0 .5rem;color:var(--muted);font-size:.92rem}#circle-think .dots{display:inline-block;width:1.6em}#circle-think .dots::after{content:'';animation:sd 1.1s steps(4,end) infinite}@keyframes sd{0%{content:''}25%{content:'.'}50%{content:'..'}75%{content:'...'}}#cp-log,#dy-beats{list-style:none;margin:0;padding:0}#cp-log li,#dy-beats li{font-size:.9rem;padding:.22rem 0;border-top:1px solid color-mix(in oklch,var(--ink) 8%,transparent)}.msg.is-wait p{font-style:italic;color:var(--muted)}.msg p.proof{font-style:italic;color:var(--muted);margin:.7rem 0 0}#circle-roles .cr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.4rem}#circle-roles button{font:inherit;text-align:left;padding:.45rem .55rem;border:1px solid color-mix(in oklch,var(--ink) 16%,transparent);background:transparent;cursor:pointer}#circle-roles button strong{display:block;font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}#circle-roles .cr-conflict{margin:.55rem 0 0;color:var(--accent)}#circle-dyn .dy-bar{height:.35rem;background:color-mix(in oklch,var(--ink) 10%,transparent);margin:0 0 .65rem}#circle-dyn .dy-bar>i{display:block;height:100%;width:12%;background:var(--accent)}li.turn-break{list-style:none;margin:1.15rem 0 .85rem;padding:.65rem 0 0;border-top:2px solid var(--accent);text-align:center}li.turn-break span{display:inline-block;padding:0 .55rem;font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);background:var(--paper);transform:translateY(-.85rem)}.msg.is-wave{background:color-mix(in oklch,var(--paper) 88%,var(--accent))}.btn.is-busy{opacity:.65}";
    document.head.appendChild(style);
    var think = document.createElement("div");
    think.id = "circle-think"; think.hidden = true; think.setAttribute("aria-live", "assertive");
    think.innerHTML = "<h2>Le salon reflechit <span class=\"dots\"></span></h2><p id=\"think-now\">La table cherche, puis construit une reponse.</p>";
    var box = document.createElement("div");
    box.id = "circle-progress"; box.hidden = true;
    box.innerHTML = "<h2>Seance en cours</h2><p class=\"cp-now\" id=\"cp-now\">En attente.</p><ol id=\"cp-log\"></ol>";
    var roles = document.createElement("div");
    roles.id = "circle-roles"; roles.hidden = true;
    roles.innerHTML = "<h2>Roles a table</h2><div class=\"cr-grid\" id=\"cr-grid\"></div><p class=\"cr-conflict\" id=\"cr-conflict\" hidden></p>";
    var dyn = document.createElement("div");
    dyn.id = "circle-dyn"; dyn.hidden = true;
    dyn.innerHTML = "<h2>Dynamique des conflits</h2><p class=\"dy-read\" id=\"dy-read\"></p><div class=\"dy-bar\"><i id=\"dy-fill\"></i></div><ol id=\"dy-beats\"></ol>";
    var stream = document.querySelector(".stream");
    var header = stream && stream.querySelector(".protocol");
    var anchor = header || (stream && stream.querySelector(".msgs"));
    if (header) header.insertAdjacentElement("afterend", think);
    else if (anchor) stream.insertBefore(think, anchor);
    think.insertAdjacentElement("afterend", box);
    box.insertAdjacentElement("afterend", roles);
    roles.insertAdjacentElement("afterend", dyn);
    roles.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-role]"); if (!b || running) return; cycleRole(b.getAttribute("data-role"));
    });
  }
  function clock() { var d = new Date(); return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")+":"+String(d.getSeconds()).padStart(2,"0"); }
  function setBusy(on) { document.querySelectorAll('[data-i18n="talk"],[data-i18n="send"]').forEach(function (b) { b.classList.toggle("is-busy", !!on); b.disabled = !!on; }); }
  function showThink(t) { var el = document.getElementById("circle-think"); var p = document.getElementById("think-now"); if (el) { el.hidden = false; el.classList.add("is-on"); } if (p && t) p.textContent = t; var box = document.getElementById("circle-progress"); if (box) box.hidden = false; try { el && el.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) {} }
  function logStep(text, live) {
    var ol = document.getElementById("cp-log"); if (!ol) return;
    ol.querySelectorAll(".is-live").forEach(function (n) { n.classList.remove("is-live"); });
    var li = document.createElement("li"); if (live) li.className = "is-live";
    li.textContent = clock() + "  " + text; ol.appendChild(li);
    while (ol.children.length > 14) ol.removeChild(ol.firstChild);
    var now = document.getElementById("cp-now"); if (now) now.textContent = text;
    var tn = document.getElementById("think-now"); if (tn && live) tn.textContent = text;
  }
  function findAuthor(id) { return authors.find(function (a) { return a.id === id; }) || null; }
  function guestIds() { return seated.slice(); }
  function mentionedSeated(text) {
    var ids = guestIds(), found = [];
    String(text || "").toLowerCase().replace(/@([a-z0-9_]+)/g, function (_, id) { if (ids.indexOf(id) >= 0 && found.indexOf(id) < 0) found.push(id); return _; });
    return found;
  }
  function speakersFor(text) { var m = mentionedSeated(text); return m.length ? m : guestIds(); }
  function lastQuestion() {
    var host = document.querySelectorAll(".msgs .is-host p");
    if (host.length) return host[host.length - 1].textContent || "";
    var draft = document.getElementById("draft"); if (draft && draft.value.trim()) return draft.value.trim();
    var p = document.querySelector(".protocol p"); return p ? String(p.textContent || "").trim() : "";
  }
  function assignRoles(question, ids) {
    var allowed = guestIds(), mentioned = mentionedSeated(question), order = [];
    mentioned.forEach(function (id) { if (allowed.indexOf(id) >= 0 && order.indexOf(id) < 0) order.push(id); });
    (ids || allowed).forEach(function (id) { if (allowed.indexOf(id) >= 0 && order.indexOf(id) < 0) order.push(id); });
    var taken = {}, seats = [], conflicts = [];
    order.forEach(function (id, i) {
      if (i >= ROLE_ORDER.length) { seats.push({ id: id, role: "invite", act: "ecoute", brief: "Observe puis cede." }); return; }
      var slot = ROLE_ORDER[i];
      if (taken[slot.role]) { conflicts.push("@" + id + " visait aussi " + slot.role); seats.push({ id: id, role: "invite", act: "ecoute", brief: "Role pris." }); return; }
      if (mentioned.length >= 2 && i === 0) conflicts.push("@" + mentioned[0] + " lit, @" + mentioned[1] + " objecte");
      taken[slot.role] = id; seats.push({ id: id, role: slot.role, act: slot.act, brief: slot.brief });
    });
    return { seats: seats, conflicts: conflicts };
  }
  function authorNameSafe(a) { if (!a) return "Un convive"; if (typeof authorName === "function") return authorName(a); return a.name || a.nameEn || a.id; }
  function userLang() { if (typeof locale !== "undefined" && locale === "en") return "en"; try { if (localStorage.getItem("salon-locale") === "en") return "en"; } catch (e) {} return "fr"; }
  function localizedBlurb(a) { if (!a) return ""; return userLang() === "en" ? (a.blurbEn || a.blurb || "") : (a.blurb || a.blurbEn || ""); }
  function paintRoles(plan) {
    lastPlan = plan; var bar = document.getElementById("circle-roles"); var grid = document.getElementById("cr-grid"); var note = document.getElementById("cr-conflict");
    if (!bar || !grid) return; bar.hidden = false; var by = {};
    (plan.seats || []).forEach(function (s) { by[s.role] = s; });
    grid.innerHTML = ROLE_ORDER.map(function (slot) {
      var seat = by[slot.role], a = seat ? findAuthor(seat.id) : null;
      return "<button type=\"button\" data-role=\"" + slot.role + "\"><strong>" + slot.role + "</strong><span>@" + (seat ? seat.id : "vide") + " \u00b7 " + (a ? authorNameSafe(a) : "—") + "</span></button>";
    }).join("");
    if (note) { var t = (plan.conflicts || []).join(" "); note.hidden = !t; note.textContent = t ? ("Conflit : " + t) : ""; }
  }
  function paintDynamics() {
    var box = document.getElementById("circle-dyn"); if (!box) return; box.hidden = false;
    var t = Math.max(0, Math.min(100, dynamics.tension)); var fill = document.getElementById("dy-fill"); if (fill) fill.style.width = t + "%";
    var last = dynamics.pairs[dynamics.pairs.length - 1];
    var phase = t >= 70 ? "vive opposition" : t >= 40 ? "tension ouverte" : t >= 20 ? "discussion" : "apaisement";
    var read = document.getElementById("dy-read");
    if (read) read.textContent = last ? ("@" + last.from + " s oppose a @" + last.to + " — " + phase + " (" + t + ").") : ("Pas encore d opposition. Tension " + t + ".");
    var ol = document.getElementById("dy-beats");
    if (ol) ol.innerHTML = dynamics.beats.slice(-8).map(function (b) { return "<li>" + b.clock + " \u00b7 @" + b.id + " " + b.act + (b.to ? " → @" + b.to : "") + (b.note ? " — " + b.note : "") + "</li>"; }).join("");
  }
  function recordBeat(author, seat, guests) {
    var role = (seat && seat.role) || "invite", act = (seat && seat.act) || "parle", to = "", note = "";
    var lecteur = guests.find(function (g) { return g._seat && g._seat.role === "lecteur"; });
    var objecteur = guests.find(function (g) { return g._seat && g._seat.role === "objecteur"; });
    if (role === "lecteur") { dynamics.tension = Math.min(40, dynamics.tension + 8); note = "pose la these"; }
    else if (role === "objecteur") { to = lecteur ? lecteur.id : "lecteur"; dynamics.tension = Math.min(100, dynamics.tension + 28); dynamics.pairs.push({ from: author.id, to: to }); note = "ouvre le conflit"; }
    else if (role === "defenseur") { to = objecteur ? objecteur.id : "objecteur"; dynamics.tension = Math.max(18, dynamics.tension - 16); note = "tient la these"; }
    else if (role === "secretaire") { dynamics.tension = Math.max(8, Math.round(dynamics.tension * 0.45)); note = dynamics.tension < 25 ? "conflit compose" : "conflit encore vif"; }
    else { dynamics.tension = Math.max(10, dynamics.tension - 4); note = "observe"; }
    dynamics.beats.push({ clock: clock().slice(0,5), id: author.id, act: act, to: to, note: note }); paintDynamics();
  }
  function cycleRole(role) {
    if (!lastPlan) return; var ids = guestIds(), seats = lastPlan.seats.slice();
    var idx = seats.findIndex(function (s) { return s.role === role; }); if (idx < 0) return;
    var current = seats[idx].id, next = ids[(Math.max(0, ids.indexOf(current)) + 1) % ids.length];
    var other = seats.findIndex(function (s) { return s.id === next; });
    seats[idx].id = next; if (other >= 0) seats[other].id = current;
    lastPlan = { seats: seats, conflicts: ["Echange " + role + " @" + next] }; paintRoles(lastPlan);
  }
  function hookMentions() {
    var draft = document.getElementById("draft"), suggest = document.getElementById("suggest");
    if (!draft || !suggest || draft.dataset.seatedHook) return; draft.dataset.seatedHook = "1";
    draft.addEventListener("input", function () {
      var at = draft.value.lastIndexOf("@"), tail = at >= 0 ? draft.value.slice(at + 1) : "";
      if (at < 0 || /\s/.test(tail)) { suggest.hidden = true; suggest.innerHTML = ""; return; }
      var needle = tail.toLowerCase();
      var hits = guestIds().map(function (id) { var a = findAuthor(id); return { id: id, name: a ? authorNameSafe(a) : id }; }).filter(function (h) { return h.id.indexOf(needle) === 0 || h.name.toLowerCase().indexOf(needle) >= 0; });
      suggest.innerHTML = hits.map(function (h) { return "<li><button type=\"button\" data-id=\"" + h.id + "\">@" + h.id + "<span>" + h.name + "</span></button></li>"; }).join("");
      suggest.hidden = !hits.length;
    });
  }
  function msgsOl() { return document.querySelector(".stream ol.msgs") || document.querySelector("ol.msgs"); }
  function markWave(label) {
    var ol = msgsOl(); if (!ol) return;
    var li = document.createElement("li"); li.className = "turn-break"; li.innerHTML = "<span></span>"; li.querySelector("span").textContent = label || "Nouveau tour"; ol.appendChild(li);
  }
  function fillProof(li, proof) { if (!li) return; var el = li.querySelector("p.proof"); if (!el) return; var t = String(proof || "").trim(); el.hidden = !t; el.textContent = t; }
  function proofFromAuthor(author) {
    var titles = ((author && author.works) || []).slice(0, 2).join(", ");
    var mem = (author && author.memory) || [];
    var quote = mem[0] ? String(mem[0].sample || mem[0].text || "").replace(/\s+/g, " ").trim().slice(0, 220) : "";
    if (quote) return "\u00ab " + quote + " \u00bb" + (mem[0].title ? " \u2014 " + mem[0].title : titles ? " \u2014 " + titles : "");
    var blurb = localizedBlurb(author).replace(/\s+/g, " ").trim().slice(0, 220);
    return blurb ? ("\u00ab " + blurb + " \u00bb" + (titles ? " \u2014 " + titles : "")) : titles;
  }
  function appendBubble(opts) {
    var ol = msgsOl(); if (!ol) return null;
    var li = document.createElement("li");
    li.className = "msg" + (opts.host ? " is-host" : "") + (opts.wait ? " is-wait" : "") + (opts.wave ? " is-wave" : "");
    if (opts.host) li.dataset.userTurn = "1"; if (opts.authorId) li.dataset.author = opts.authorId;
    var who = opts.name || "Vous", act = opts.act || "adresse";
    var av = opts.host ? "<span class=\"avatar host\">H</span>" : (typeof avatarHtml === "function" && findAuthor(opts.authorId) ? avatarHtml(findAuthor(opts.authorId)) : "<span class=\"avatar\">" + who.slice(0,1).toUpperCase() + "</span>");
    li.innerHTML = av + "<div><header><strong></strong><span></span><time></time></header><p></p><p class=\"proof\" hidden></p></div>";
    li.querySelector("strong").textContent = who; li.querySelector("header span").textContent = act; li.querySelector("time").textContent = clock().slice(0,5);
    li.querySelector("p").textContent = opts.text || ""; fillProof(li, opts.proof); ol.appendChild(li);
    li.scrollIntoView({ block: "nearest", behavior: "smooth" }); return li;
  }
  function frameQuestions(q, role) {
    var t = String(q || "").toLowerCase();
    var aboutIa = /\bia\b|intelligence artificielle|machine|algorithme|automate/.test(t);
    var aboutLibre = /libre|liberte|autonomie|volont/.test(t);
    if (aboutIa && aboutLibre) {
      if (role === "objecteur") return "De qui parle-t-on quand on dit l'IA : un modele, un usage, un maitre ? La liberte dont on parle est-elle celle de choisir une fin, ou seulement celle d'enchainer des moyens ?";
      if (role === "defenseur") return "Faut-il appeler liberte l'absence de contrainte, ou la capacite de se donner une loi ? L'outil peut-il etre le sujet de cette phrase ?";
      if (role === "secretaire") return "Qu'est-ce qui, dans la question, reste indecis : le sujet IA, le predicat libre, ou le lien entre les deux ?";
      return "L'IA est-elle un agent, un instrument, ou un theatre d'actions humaines ? Et libre veut-il dire sans maitre, ou capable de se prescrire une fin ?";
    }
    if (role === "objecteur") return "Que tient-on pour evident dans cette phrase, et que n'a-t-on pas nomme ? De quel sujet s'agit-il vraiment ?";
    if (role === "defenseur") return "Sous quel critere repondrait-on sans trahir la question ? Qu'est-ce qui, une fois precise, changerait la reponse ?";
    if (role === "secretaire") return "Quelles distinctions la table doit-elle poser pour que la question cesse d'etre un mot d'ordre ?";
    return "Que designe le sujet de la phrase, et que demande le predicat une fois separe du slogan ?";
  }
  function stripPreamble(text) {
    var t = String(text || "").replace(/\s+/g, " ").trim();
    t = t.replace(/^Je prends la question[^.]*\.\s*/i, "");
    t = t.replace(/^On me connait ainsi\s*:[^.]*\.\s*/i, "");
    t = t.replace(/^Ce n'est pas un extrait qui parle a votre place[^.]*\.\s*/i, "");
    t = t.replace(/^Je refuse d'y repondre par une maxime[^.]*\.\s*/i, "");
    return t.trim();
  }
  function localVoice(author, question, seat) {
    var works = author.works || [], work = works[0] || "mes livres", work2 = works[1] || work;
    var role = (seat && seat.role) || "invite";
    var frame = frameQuestions(question, role);
    var mid = role === "objecteur"
      ? ("La lecture trop nette confond l'outil et l'agent. " + work + " separe ce qui agit et ce qui est agi. Une machine qui combine n'institue pas une volonte ; elle execute une chaine dont le bout reste humain, ou impersonnel, ce qui n'est pas la meme chose que libre.")
      : role === "defenseur"
      ? ("Precisons plutot que nier. " + work2 + " distingue la contrainte exterieure et la loi qu'on se donne. Si libre veut dire sans maitre apparent, beaucoup de mecanismes le sont. S'il veut dire capable de se determiner selon une fin prescrite, le mot ne s'applique pas a l'instrument, seulement a qui s'en sert ou s'y soumet.")
      : role === "secretaire"
      ? "Deux lectures se croisent : l'une refuse le mot liberte a ce qui n'a pas de fin propre ; l'autre l'emploie pour une independance technique. La minute n'arbitre pas. Elle note ce qu'il faut trancher pour ne pas repondre a deux questions sous une seule."
      : ("La phrase colle deux termes qui ne sont pas du meme ordre. " + work + " defait d'abord le sujet. Un automate peut etre independant d'un operateur immediat sans cesser d'etre un moyen. La liberte suppose une fin et le pouvoir de s'y tenir quand l'utilite pousse ailleurs.");
    var close = /libre|ia|intelligence/i.test(String(question||""))
      ? "Selon le sens choisi pour libre et le sujet assigne a l'IA, la reponse bascule. Tant que ces deux questions restent ouvertes, affirmer ou nier n'est qu'un effet de langue."
      : "Une fois ces questions posees, on peut repondre. Pas avant : autrement on tranche un mot, pas un probleme.";
    return { text: (frame + " " + mid + " " + close).replace(/\s+/g, " ").trim(), proof: proofFromAuthor(author) };
  }
  function askVoice(author, question, seat) {
    var role = (seat && seat.role) || "invite";
    var system = "Tu es " + authorNameSafe(author) + ". Role: " + role + ". Commence par deux questions courtes qui decomposent la demande (sujet, predicat, critere), puis raisonne. 160-240 mots, francais, premiere personne. Interdits: Je prends la question ; je refuse d'y repondre par une maxime ; On me connait ainsi ; te presenter ; reciter un extrait comme seule reponse.";
    showThink("Cadrage, puis reponse — " + authorNameSafe(author));
    logStep("Le salon reflechit avec " + authorNameSafe(author), true);
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { try { ctrl && ctrl.abort(); } catch (e) {} }, 7000);
    return fetch(DEMO, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ system: system, user: "Question de l'hote: " + question }), signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) { return res.json().then(function (j) { return { ok: res.ok, j: j }; }); })
      .then(function (r) {
        var text = stripPreamble((r.j && (r.j.text || r.j.content)) || "");
        if (!r.ok || !text || /^\[mock\]/i.test(text) || text.length < 90) return localVoice(author, question, seat);
        return { text: text, proof: proofFromAuthor(author) };
      })
      .catch(function () { return localVoice(author, question, seat); })
      .finally(function () { clearTimeout(timer); });
  }
  function runTable(question, ids, opts) {
    opts = opts || {}; question = String(question || "").trim();
    if (question.length < 2) { showThink("Rien a poser — ecrivez ou ouvrez un cercle."); return Promise.resolve(); }
    if (running) { pending = { question: question, ids: ids, opts: opts }; showThink("Un tour est deja en cours. Le suivant est note."); return Promise.resolve(); }
    var plan = lastPlan && !mentionedSeated(question).length ? lastPlan : assignRoles(question, ids);
    var guests = plan.seats.map(function (seat) { var a = findAuthor(seat.id); if (!a) return null; a = Object.assign({}, a); a._seat = seat; return a; }).filter(Boolean);
    if (!guests.length) { showThink("Aucun convive a table."); return Promise.resolve(); }
    running = true; setBusy(true); showThink("Le salon prend la question et attribue les roles.");
    if (opts.wave !== false) markWave(opts.label || "Nouveau tour");
    logStep("Question : " + question.slice(0, 110)); paintRoles(plan); paintDynamics();
    var chain = Promise.resolve();
    guests.forEach(function (author, i) {
      chain = chain.then(function () {
        var seat = author._seat || { role: "invite", act: "prend la parole" };
        showThink((i + 1) + "/" + guests.length + " — " + seat.role + " \u00b7 " + authorNameSafe(author));
        var wait = appendBubble({ authorId: author.id, name: authorNameSafe(author), act: seat.role + " — reflechit", wait: true, wave: true, text: "Le salon reflechit\u2026" });
        return askVoice(author, question, seat).then(function (out) {
          var text = (out && out.text) || "";
          if (wait) { wait.classList.remove("is-wait"); var actEl = wait.querySelector("header span"); if (actEl) actEl.textContent = seat.act; wait.querySelector("p").textContent = text; fillProof(wait, (out && out.proof) || proofFromAuthor(author)); }
          recordBeat(author, seat, guests);
          return new Promise(function (ok) { setTimeout(ok, 260); });
        });
      });
    });
    return chain.then(function () {
      running = false; setBusy(false); showThink("La table s'est tue. Vous pouvez relancer.");
      if (pending) { var n = pending; pending = null; return runTable(n.question, n.ids, n.opts); }
    }).catch(function () { running = false; setBusy(false); showThink("La seance s'est interrompue."); });
  }
  function hookOpen() {
    var form = document.getElementById("open-circle"); if (!form || form.dataset.circleHook) return; form.dataset.circleHook = "1";
    form.addEventListener("submit", function () {
      setTimeout(function () {
        var data = new FormData(form), name = String(data.get("name") || "Cercle").trim(), question = String(data.get("question") || "").trim();
        var picked = typeof selectedIds === "function" ? selectedIds() : guestIds();
        if (picked.length < 2) { showThink("Cochez au moins deux convives."); return; }
        seated = picked.slice(); lastPlan = null; dynamics = { tension: 12, beats: [], pairs: [] };
        var h = document.querySelector(".protocol h1"); var p = document.querySelector(".protocol p"); if (h) h.textContent = name; if (p) p.textContent = question;
        if (typeof show === "function") show("cercle");
        showThink("Le cercle s'ouvre."); markWave("Ouverture — " + name);
        appendBubble({ host: true, name: "Vous", act: "ouvre la table", text: question, wave: true });
        var stream = document.querySelector(".stream"); if (stream) stream.scrollIntoView({ behavior: "smooth", block: "start" });
        runTable(question, seated, { wave: false });
      }, 0);
    });
  }
  function hookCompose() {
    var form = document.getElementById("compose"); if (!form || form.dataset.circleHook) return; form.dataset.circleHook = "1";
    form.addEventListener("submit", function () {
      setTimeout(function () { var q = lastQuestion(); if (q.length < 2) { showThink("Ecrivez d'abord."); return; } showThink("Votre message est a table."); runTable(q, speakersFor(q), { label: "Votre intervention" }); }, 0);
    });
  }
  function hookTalk() {
    var btn = document.querySelector('[data-i18n="talk"]');
    if (!btn) btn = Array.prototype.find.call(document.querySelectorAll(".compose button[type=button]"), function (b) { return /parler|speak/i.test(b.textContent || ""); });
    if (!btn || btn.dataset.circleHook) return; btn.dataset.circleHook = "1";
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      var draft = document.getElementById("draft"), typed = draft && draft.value.trim(), q = typed || lastQuestion();
      showThink("Le salon prend la parole. Cadrage, puis raisonnement.");
      if (typeof show === "function") try { show("cercle"); } catch (err) {}
      if (q.length < 2) return;
      markWave(typed ? "Vous laissez la table parler" : "La table reprend");
      appendBubble({ host: true, name: "Vous", act: "laisse la table parler", text: q, wave: true });
      if (draft && typed) draft.value = "";
      runTable(q, speakersFor(q), { wave: false, label: "La table parle" });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
