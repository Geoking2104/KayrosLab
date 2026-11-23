/* Accueil KayrosLab : onglets, frappe de la question, CTA collant mobile.
 * Respecte prefers-reduced-motion ; sans dépendance. */
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Onglets accessibles (flèches gauche/droite).
  document.querySelectorAll('[data-tabs]').forEach(function (root) {
    var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
    function select(i, focus) {
      tabs.forEach(function (t, j) {
        var on = i === j;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
      if (focus) tabs[i].focus();
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(i, false); });
      t.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') { e.preventDefault(); select((i + 1) % tabs.length, true); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); select((i - 1 + tabs.length) % tabs.length, true); }
      });
    });
  });

  // Question tapée lettre à lettre (texte complet affiché si mouvement réduit).
  var el = document.querySelector('[data-type]');
  if (el && !reduce) {
    var text = el.getAttribute('data-type'), n = 0;
    el.textContent = ''; el.classList.add('typing');
    (function tick() {
      el.textContent = text.slice(0, ++n);
      if (n < text.length) setTimeout(tick, 38); else el.classList.remove('typing');
    })();
  }

  // Apparition au défilement (pages secondaires sans le script inline).
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.reveal').forEach(function (x) { x.classList.add('in'); });
  }

  // CTA collant (mobile) : visible après le hero, masqué sur le CTA final.
  var sticky = document.getElementById('h-sticky'), hero = document.querySelector('.h-hero'), fin = document.getElementById('try');
  if (sticky && hero && 'IntersectionObserver' in window) {
    var heroOut = false, finIn = false;
    var sync = function () { sticky.classList.toggle('show', heroOut && !finIn); };
    new IntersectionObserver(function (es) { heroOut = !es[0].isIntersecting; sync(); }).observe(hero);
    if (fin) new IntersectionObserver(function (es) { finIn = es[0].isIntersecting; sync(); }).observe(fin);
  }
})();
