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

  var HTML = [
    '<section class="peau-steps" aria-labelledby="peau-titre">',
    '  <p class="kicker">Mode d’emploi du salon</p>',
    '  <h2 id="peau-titre">Ils prennent la peau de leurs ouvrages.</h2>',
    '  <p class="lead">Trois gestes, un seul objet : faire parler les livres à table, et penser avec eux — non à leur place.</p>',
    '  <ol class="peau-plates">',
    '    <li><span class="n">I</span><h3>Convier</h3><p>Vous dressez la table. Un nom, une question, deux voix au moins. L’auteur n’entre pas comme une opinion : il porte cinq œuvres.</p><em>Objectif — constituer un cercle.</em></li>',
    '    <li><span class="n">II</span><h3>Adresser</h3><p>Vous parlez dans le fil. @voltaire l’appelle. La mention n’est pas un étiquetage : c’est une révérence qui désigne le convive.</p><em>Objectif — poser une question à un ouvrage vivant.</em></li>',
    '    <li><span class="n">III</span><h3>Écouter</h3><p>Ils prennent la peau de leurs livres. L’un répond, l’autre objecte. « Laisser le salon parler » : la parole tourne sans vous.</p><em>Objectif — les entendre se répondre, puis retenir la séance.</em></li>',
    '  </ol>',
    '</section>'
  ].join("");

  function prune() {
    document.querySelectorAll('.channels a[data-circle="academie"], .channels a[data-circle="pouvoir"]').forEach(function (a) {
      var li = a.closest("li");
      if (li) li.remove();
    });
  }

  function inject() {
    if (document.getElementById("peau-titre")) return;
    var hero = document.querySelector("#cercle > section") || document.querySelector(".salon-hero") || document.querySelector("#cercle section");
    var open = document.querySelector(".salon-create") || document.getElementById("ouvrir");
    if (!hero) return;
    var wrap = document.createElement("div");
    wrap.innerHTML = HTML;
    var node = wrap.firstElementChild;
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

  function run() {
    style();
    prune();
    inject();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
  setTimeout(run, 60);
  setTimeout(run, 400);
})();
