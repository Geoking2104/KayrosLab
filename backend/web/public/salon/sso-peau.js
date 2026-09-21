/* Lien vers /salon/entrer/ — si pas de fauteuil. */
(function () {
  function add() {
    if (document.getElementById("salon-creer")) return;
    var stage = document.getElementById("first-factor-stage") || document.querySelector(".MuiContainer-root");
    if (!stage) return;
    var p = document.createElement("p");
    p.id = "salon-creer";
    p.innerHTML = '<a href="https://www.kayroslab.com/salon/entrer/">Pas de compte ? Demander une entrée au Salon</a>';
    stage.appendChild(p);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add);
  else add();
  setTimeout(add, 200);
  setTimeout(add, 800);
  try {
    new MutationObserver(add).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})();
