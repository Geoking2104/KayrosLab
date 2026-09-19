/* Place « À table » sous « Ouvrir un cercle » ; le fil récupère la colonne de droite. */
(function () {
  function css() {
    if (document.getElementById("salon-place-css")) return;
    var st = document.createElement("style");
    st.id = "salon-place-css";
    st.textContent = [
      ".channel{grid-template-columns:minmax(0,1fr)!important}",
      ".salon-create{display:flex;flex-direction:column;gap:1rem;max-width:36rem}",
      ".salon-create aside.people{width:100%;margin:0;position:static}",
      "body.salon-staged .channel{display:block}",
      "body.salon-staged #salon-stage{width:100%;max-width:1180px}",
      "body.salon-staged #salon-center{max-width:none}",
      "@media(min-width:861px){body.salon-staged .salon-stage{grid-template-columns:minmax(200px,240px) minmax(0,1fr)}}",
    ].join("");
    document.head.appendChild(st);
  }
  function place() {
    css();
    var people = document.querySelector("aside.people");
    var form = document.getElementById("open-circle");
    var box = document.querySelector(".salon-create") || (form && form.parentElement);
    if (!people || !box) return;
    if (people.parentElement === box && people.previousElementSibling === form) return;
    if (form && form.parentElement === box) box.insertBefore(people, form.nextSibling);
    else box.appendChild(people);
  }
  function ready(fn) {
    if (document.querySelector("aside.people") && document.getElementById("open-circle")) { fn(); return; }
    setTimeout(function () { ready(fn); }, 50);
  }
  ready(function () {
    place();
    var form = document.getElementById("open-circle");
    if (form) form.addEventListener("submit", function () { setTimeout(place, 40); });
    window.addEventListener("resize", place);
  });
})();
