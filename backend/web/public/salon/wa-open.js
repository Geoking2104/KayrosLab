/* Salon — ouvrir la table sur WhatsApp (P1, fil 1-à-1). */
(function () {
  var API = "https://api.kayroslab.com/v1/salon/whatsapp/open";
  if (document.getElementById("wa-open")) return;

  var html = [
    '<section class="peau-steps" id="wa-open" aria-labelledby="wa-open-titre">',
    '  <p class="kicker">Canal WhatsApp</p>',
    '  <h2 id="wa-open-titre">Ouvrir la table sur WhatsApp</h2>',
    '  <p class="lead">Un numéro, plusieurs voix. Lumières s’ouvre en conversation avec Le Salon. Opt-in requis. Aucun template sans votre accord.</p>',
    '  <form id="wa-open-form" class="import-box" style="margin-top:1rem">',
    '    <label>Numéro <input id="wa-phone" type="tel" required autocomplete="tel" placeholder="+33 6 …" /></label>',
    '    <label style="display:flex;gap:.55rem;align-items:flex-start;margin:.7rem 0">',
    '      <input id="wa-optin" type="checkbox" required />',
    '      <span>J’accepte de recevoir le lien d’invitation et les messages du Salon sur WhatsApp.</span>',
    '    </label>',
    '    <button class="btn" type="submit">Ouvrir Lumières</button>',
    '    <p class="hint" id="wa-open-status" hidden></p>',
    '  </form>',
    '</section>'
  ].join("");

  function mount() {
    if (document.getElementById("wa-open")) return;
    var hero = document.querySelector("#cercle > section") || document.querySelector(".salon-hero");
    var open = document.getElementById("ouvrir") || document.querySelector(".salon-create");
    if (!hero) return;
    var wrap = document.createElement("div");
    wrap.innerHTML = html;
    var node = wrap.firstElementChild;
    if (open && open.parentNode === hero.parentNode) hero.parentNode.insertBefore(node, open);
    else hero.insertAdjacentElement("afterend", node);
    bind();
  }

  function bind() {
    var form = document.getElementById("wa-open-form");
    if (!form || form.dataset.bound) return;
    form.dataset.bound = "1";
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var status = document.getElementById("wa-open-status");
      var phone = document.getElementById("wa-phone").value;
      var optIn = document.getElementById("wa-optin").checked;
      status.hidden = false;
      status.textContent = "Ouverture…";
      try {
        var res = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            optIn: optIn,
            e164: phone,
            circleId: "lumieres",
            question: "Que reste-t-il de la liberté une fois qu’on a tout expliqué ?",
            locale: document.documentElement.lang === "en" ? "en" : "fr"
          })
        });
        var json = await res.json();
        if (!res.ok) throw new Error(json.error || "refus");
        if (json.waMe) {
          status.textContent = json.sent
            ? "Invitation partie. Vous pouvez aussi ouvrir le fil."
            : "Compte WhatsApp encore à armer. Le fil s’ouvre ; les voix arriveront dès que le numéro professionnel sera relié.";
          window.open(json.waMe, "_blank", "noopener");
        } else {
          status.textContent = "Demande enregistrée (" + (json.last4 || "") + "). Le numéro professionnel n’est pas encore public.";
        }
      } catch (err) {
        status.textContent = err.message || "La table n’a pas pu s’ouvrir.";
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  setTimeout(mount, 400);
})();
