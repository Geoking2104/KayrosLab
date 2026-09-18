/* Gazette — plus d’Entrer. Lier X ouvre x.com (intent si missive). */
(function () {
  function statusId() {
    var raw = "";
    var url = document.getElementById("gz-url");
    if (url) raw = url.value;
    var m = String(raw || "").match(/(?:x\.com|twitter\.com)\/(?:i\/web\/status|[^/\s]+\/status)\/(\d{5,19})/i);
    return m ? m[1] : "";
  }
  function openX(ev) {
    if (ev) ev.preventDefault();
    var id = statusId();
    var href = id
      ? "https://x.com/intent/tweet?in_reply_to=" + encodeURIComponent(id)
      : "https://x.com/";
    window.open(href, "_blank", "noopener,noreferrer");
  }
  function boot() {
    var enter = document.getElementById("salon-auth");
    if (enter) enter.remove();
    document.querySelectorAll("[data-fx-bind]").forEach(function (b) { b.remove(); });
    var link = document.getElementById("fx-open-x");
    if (link && !link.getAttribute("data-hook")) {
      link.setAttribute("data-hook", "1");
      link.addEventListener("click", openX);
    }
  }
  if (!/\/salon\/flux\/?$/.test(location.pathname.replace(/index\.html$/, ""))) return;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  setTimeout(boot, 80);
  setTimeout(boot, 400);
})();
