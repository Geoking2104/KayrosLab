/* Shared contact modal: any [data-contact-open] element or a #contact hash opens it. */
(function () {
  var T = {
    fr: { t: 'Parlons de votre prochaine décision.', i: 'Laissez vos coordonnées : nous revenons vers vous rapidement pour cadrer votre besoin.',
      f: [['lastName', 'Nom', 'family-name'], ['firstName', 'Prénom', 'given-name'], ['company', 'Société', 'organization'], ['position', 'Fonction', 'organization-title'], ['email', 'E-mail professionnel', 'email']],
      send: 'Envoyer', ci: 'Demande d\u2019accès à la console', cit: 'Demandez votre accès à la console : nous ouvrons les accès manuellement, au cas par cas.', close: 'Fermer', wait: 'Envoi en cours…', ok: 'Merci ! Votre demande est envoyée — nous revenons vers vous rapidement.',
      ko: 'L\u2019envoi a échoué. Réessayez ou écrivez à contact@kayroslab.com.', p: 'Vos informations sont utilisées uniquement pour répondre à votre demande. Responsable de traitement : SASU KayrosLab.' },
    en: { t: 'Let\u2019s talk about your next decision.', i: 'Leave your details and we will get back to you quickly to frame your need.',
      f: [['lastName', 'Last name', 'family-name'], ['firstName', 'First name', 'given-name'], ['company', 'Company', 'organization'], ['position', 'Position', 'organization-title'], ['email', 'Work e-mail', 'email']],
      send: 'Send', ci: 'Console access request', cit: 'Request your console access: we grant access manually, case by case.', close: 'Close', wait: 'Sending…', ok: 'Thank you! Your request was sent — we will get back to you quickly.',
      ko: 'Sending failed. Try again or write to contact@kayroslab.com.', p: 'Your details are used solely to answer your request. Data controller: SASU KayrosLab.' }
  };
  var dialogs = {};
  function css() {
    if (document.getElementById('kl-contact-css')) return;
    var s = document.createElement('style'); s.id = 'kl-contact-css';
    s.textContent = '.kl-contact{width:min(92vw,34rem);border:1px solid #c9ced6;border-radius:12px;padding:1.5rem;background:#fff;color:#111;font:inherit}' +
      '.kl-contact::backdrop{background:rgba(16,36,66,.55)}.kl-contact h2{margin:0 0 .4rem;font-size:1.5rem}.kl-contact p{margin:.3rem 0;font-size:.9rem;color:#444}' +
      '.kl-contact .kl-grid{display:grid;gap:.8rem;margin:1rem 0}.kl-contact label{display:grid;gap:.25rem;font-size:.85rem;color:#555}' +
      '.kl-contact input{min-height:2.6rem;border:1px solid #c9ced6;border-radius:6px;padding:0 .6rem;font:inherit}' +
      '.kl-contact .kl-ci{display:flex;gap:.5rem;align-items:center;margin:0 0 .8rem;color:#111;font-size:.9rem}.kl-contact .kl-ci input{min-height:0;width:1.1rem;height:1.1rem}.kl-contact .kl-hp{position:absolute;left:-9999px;width:0;height:0;opacity:0}.kl-contact .kl-x{position:absolute;top:.5rem;right:.5rem;width:2.2rem;height:2.2rem;border:0;background:none;font-size:1.4rem;cursor:pointer}' +
      '.kl-contact .kl-send{min-height:2.75rem;padding:0 1.4rem;border:0;border-radius:999px;background:#111;color:#fff;font:inherit;cursor:pointer}' +
      '@media(min-width:640px){.kl-contact .kl-grid{grid-template-columns:1fr 1fr}.kl-contact .kl-grid label:nth-child(5){grid-column:1/-1}}';
    document.head.appendChild(s);
  }
  function build(lang) {
    if (dialogs[lang]) return dialogs[lang];
    css();
    var L = T[lang], d = document.createElement('dialog');
    d.className = 'kl-contact'; d.id = 'contact-dialog-' + lang; d.lang = lang; d.setAttribute('aria-labelledby', d.id + '-t');
    d.innerHTML = '<form novalidate><button type="button" class="kl-x" aria-label="' + L.close + '">×</button>' +
      '<h2 id="' + d.id + '-t">' + L.t + '</h2><p>' + L.i + '</p><div class="kl-grid">' +
      L.f.map(function (x) { return '<label>' + x[1] + '<input name="' + x[0] + '" required maxlength="' + (x[0] === 'email' ? 254 : 180) + '" autocomplete="' + x[2] + '"' + (x[0] === 'email' ? ' type="email"' : '') + '></label>'; }).join('') +
      '</div><label class="kl-ci"><input type="checkbox" name="consoleAccess"> ' + L.ci + '</label><input name="website" class="kl-hp" tabindex="-1" autocomplete="off" aria-hidden="true"><p class="kl-status" role="status" aria-live="polite"></p>' +
      '<button type="submit" class="kl-send">' + L.send + '</button><p>' + L.p + '</p></form>';
    document.body.appendChild(d);
    var form = d.querySelector('form'), status = d.querySelector('.kl-status'), submit = d.querySelector('.kl-send');
    d.querySelector('.kl-x').addEventListener('click', function () { d.close(); });
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    d.addEventListener('close', function () { if (location.hash === '#contact') history.replaceState(null, '', location.pathname + location.search); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      var p = { language: lang, website: form.website.value, intent: form.consoleAccess.checked ? 'console' : 'contact' };
      L.f.forEach(function (x) { p[x[0]] = form[x[0]].value.trim(); });
      status.textContent = L.wait; submit.disabled = true;
      fetch('https://api.kayroslab.com/v1/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); status.textContent = L.ok; form.reset(); })
        .catch(function () { status.textContent = L.ko; })
        .then(function () { submit.disabled = false; });
    });
    return (dialogs[lang] = d);
  }
  function langOf(el) {
    var n = el && el.closest ? el.closest('[lang]') : null;
    var l = ((n && n.lang) || document.documentElement.lang || 'en').slice(0, 2).toLowerCase();
    return T[l] ? l : 'en';
  }
  function open(lang, intent) {
    var d = build(lang), L = T[lang], console_ = intent === 'console';
    d.querySelector('[name=consoleAccess]').checked = console_;
    d.querySelector('h2').textContent = console_ ? L.ci : L.t;
    d.querySelector('h2 + p').textContent = console_ ? L.cit : L.i;
    d.setAttribute('data-intent', console_ ? 'console' : 'contact');
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
    var f = d.querySelector('input'); if (f) f.focus();
  }
  window.KayrosContact = { open: open };
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-contact-open]');
    if (!a) return;
    e.preventDefault(); open(langOf(a), a.getAttribute('data-contact-intent'));
  });
  function fromHash() {
    if (location.hash !== '#contact') return;
    var v = document.querySelector('.lang-view:not([hidden])');
    open(langOf(v || document.documentElement));
  }
  window.addEventListener('hashchange', fromHash);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fromHash); else fromHash();
})();
