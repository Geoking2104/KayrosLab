/**
 * Événements GA4 via dataLayer (GTM-TXNT5J6M).
 * Pas d’e-mail, pas de nom — seulement le type d’acte.
 */
window.dataLayer = window.dataLayer || [];
window.kayrosTrack = function kayrosTrack(name, params) {
  if (!name) return;
  const row = { event: String(name) };
  if (params && typeof params === 'object') {
    Object.keys(params).forEach((key) => {
      const value = params[key];
      if (value != null && value !== '') row[key] = value;
    });
  }
  window.dataLayer.push(row);
};

document.addEventListener('click', (event) => {
  const link = event.target.closest && event.target.closest('a[href]');
  if (!link) return;
  const href = link.getAttribute('href') || '';
  if (href.indexOf('kayroslab-complete-with-ai-agents') !== -1) {
    window.kayrosTrack('demo_start', { method: 'cta' });
  }
}, true);
