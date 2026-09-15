/* Salon — n’afficher que les cercles pourvus de contenu + mode d’emploi. */
(function () {
  var STYLE = [
    ".peau-steps{margin:1.6rem 0 0;padding:1.15rem 0 .2rem;border-top:1px solid color-mix(in oklch,var(--ink) 16%,transparent);max-width:58rem}",
    ".peau-steps>.kicker{margin:0 0 .35rem}",
    ".peau-steps h2{margin:0 0 .45rem;font-size:clamp(1.55rem,3vw,2.05rem);line-height:1.15;max-width:22ch}",
    ".peau-steps>.lead{margin:0 0 1rem;max-width:46ch}",
    ".peau-plates{list-style:none;margin:0;padding:0;display:grid;gap:.75rem}",
    "@media (min-width:860px){.peau-plates{grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}}",
    ".peau-plates li{padding:1rem 1rem 1.05rem;border:1px solid color-mix(in oklch,var(--ink) 16%,transparent);background:color-mix(in oklch,var(--paper) 88%,var(--accent));min-width:0}",
    ".peau-plates .n{display:block;font-family:Georgia,'Iowan Old Style',serif;font-size:.72rem;letter-spacing:.22em;color:var(--accent);margin-bottom:.45rem}",
    ".peau-plates h3{margin:0 0 .4rem;font-size:1.28rem;font-weight:550}",
    ".peau-plates p{margin:0;color:var(--ink-2);font-size:.95rem;line-height:1.45}",
    ".peau-plates em{display:block;margin-top:.7rem;font-style:italic;color:var(--accent);font-size:.88rem}"
  ].join("");

  var COPY = {
    fr: {
      kicker: "Mode d’emploi du salon",
      title: "Ils prennent la peau de leurs ouvrages.",
      lead: "Trois gestes, un seul objet : faire parler les livres à table, et penser avec eux — non à leur place.",
      steps: [
        { n: "I", title: "Convier", body: "Vous dressez la table. Un nom, une question, deux voix au moins. L’auteur n’entre pas comme une opinion : il porte cinq œuvres.", goal: "Objectif — constituer un cercle." },
        { n: "II", title: "Adresser", body: "Vous parlez dans le fil. @voltaire l’appelle. La mention n’est pas un étiquetage : c’est une révérence qui désigne le convive.", goal: "Objectif — poser une question à un ouvrage vivant." },
        { n: "III", title: "Écouter", body: "Ils prennent la peau de leurs livres. L’un répond, l’autre objecte. « Laisser le salon parler » : la parole tourne sans vous.", goal: "Objectif — les entendre se répondre, puis retenir la séance." }
      ]
    },
    en: {
      kicker: "How the salon works",
      title: "They put on the skin of their works.",
      lead: "Three gestures, one aim: let the books speak at table, and think with them — not in their place.",
      steps: [
        { n: "I", title: "Invite", body: "You set the table. A name, a question, two voices at least. An author does not enter as an opinion: they carry five works.", goal: "Aim — constitute a circle." },
        { n: "II", title: "Address", body: "You speak in the thread. @voltaire calls him. The mention is not a tag: it is a courtesy that names the guest.", goal: "Aim — put a question to a living work." },
        { n: "III", title: "Listen", body: "They put on the skin of their books. One answers, another objects. \u201cLet the salon speak\u201d: the floor turns without you.", goal: "Aim — hear them answer one another, then keep the sitting." }
      ]
    }
  };

  function locale() {
    try {
      if (localStorage.getItem("salon-locale") === "en") return "en";
    } catch (e) {}
    return document.documentElement.lang === "en" ? "en" : "fr";
  }

  function htmlFor(lang) {
    var c = COPY[lang] || COPY.fr;
    var steps = c.steps.map(function (s) {
      return "<li><span class=\"n\">" + s.n + "</span><h3>" + s.title + "</h3><p>" + s.body + "</p><em>" + s.goal + "</em></li>";
    }).join("");
    return [
      '<section class="peau-steps" aria-labelledby="peau-titre">',
      '  <p class="kicker">' + c.kicker + "</p>",
      '  <h2 id="peau-titre">' + c.title + "</h2>",
      '  <p class="lead">' + c.lead + "</p>",
      '  <ol class="peau-plates">' + steps + "</ol>",
      "</section>"
    ].join("");
  }

  function prune() {
    document.querySelectorAll('.channels a[data-circle="academie"], .channels a[data-circle="pouvoir"]').forEach(function (a) {
      var li = a.closest("li");
      if (li) li.remove();
    });
  }

  function paint() {
    var existing = document.querySelector(".peau-steps");
    var wrap = document.createElement("div");
    wrap.innerHTML = htmlFor(locale());
    var node = wrap.firstElementChild;
    if (existing) {
      existing.replaceWith(node);
      return;
    }
    var hero = document.querySelector("#cercle > section") || document.querySelector(".salon-hero") || document.querySelector("#cercle section");
    var open = document.querySelector(".salon-create") || document.getElementById("ouvrir");
    if (!hero) return;
    if (open && open.parentNode === hero.parentNode) {
      hero.parentNode.insertBefore(node, open);
    } else {
      hero.insertAdjacentElement("afterend", node);
    }
  }

  function style() {
    if (document.getElementById("peau-nav-css")) return;
    var el = document.createElement("style");
    el.id = "peau-nav-css";
    el.textContent = STYLE;
    document.head.appendChild(el);
  }

  function bindLang() {
    if (window.__peauLangBound) return;
    window.__peauLangBound = true;
    document.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest(".salon-lang button, [data-lang], button[lang]") : null;
      if (!btn) return;
      setTimeout(paint, 30);
    });
  }

  function run() {
    style();
    prune();
    paint();
    bindLang();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
  setTimeout(run, 60);
  setTimeout(run, 400);
})();
