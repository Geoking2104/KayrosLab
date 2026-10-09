// Documentation de l'API publique v1 (sans authentification) :
//   GET /v1/public/openapi.json  spécification OpenAPI 3.1 (docs/openapi/kayroslab-public-v1.json)
//   GET /docs                    page de référence lisible (Scalar) + démarrage rapide
//
// La spécification est versionnée dans le dépôt ; `servers` est réécrit avec
// KAYROS_PUBLIC_API_URL pour qu'un environnement de recette se documente lui-même.
import { readFile } from 'node:fs/promises';

export const OPENAPI_SPEC_URL = new URL('../../../docs/openapi/kayroslab-public-v1.json', import.meta.url);
// Version épinglée : une mise à jour du CDN ne doit pas changer la page sans revue.
export const SCALAR_SCRIPT = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.73.1';

export async function loadOpenApiSpec({ baseUrl = '' } = {}) {
  const spec = JSON.parse(await readFile(OPENAPI_SPEC_URL, 'utf8'));
  const url = String(baseUrl || '').replace(/\/+$/, '');
  if (url) spec.servers = [{ url, description: 'Cette instance' }];
  return spec;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function docsHtml({ baseUrl = 'https://api.kayroslab.com', guideUrl = 'https://github.com/Geoking2104/KayrosLab/blob/main/integrations/n8n/README.md' } = {}) {
  const api = escapeHtml(String(baseUrl).replace(/\/+$/, ''));
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>KayrosLab — API publique v1</title>
<meta name="description" content="Lancer une mission de collectif d'agents depuis Salesforce, n8n ou Zapier et recevoir un verdict signé.">
<style>
  body { margin: 0; font: 15px/1.55 system-ui, -apple-system, Segoe UI, sans-serif; color: #111; background: #fff; }
  .quickstart { max-width: 960px; margin: 0 auto; padding: 28px 24px 8px; }
  .quickstart h1 { font-size: 26px; margin: 0 0 6px; }
  .quickstart p { margin: 6px 0; }
  .quickstart ol { padding-left: 20px; }
  pre { background: #0f172a; color: #e2e8f0; padding: 12px 14px; border-radius: 8px; overflow-x: auto; font-size: 13px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .links a { margin-right: 16px; }
  #reference { border-top: 1px solid #e5e7eb; margin-top: 18px; }
</style>
</head>
<body>
<section class="quickstart">
  <h1>KayrosLab — API publique v1</h1>
  <p>Déclenchez une mission de collectif d'agents depuis votre CRM et récupérez le verdict (GO, CONDITIONAL_GO, NO_GO), les risques, les conditions et le lien vers le dossier.</p>
  <p class="links"><a href="${escapeHtml(guideUrl)}">PoC Salesforce en 15 minutes (n8n)</a><a href="/v1/public/openapi.json">Spécification OpenAPI 3.1</a></p>
  <ol>
    <li>Console → <strong>Intégrations</strong> → créez une clé d'API (affichée une seule fois).</li>
    <li>Testez-la : <code>GET /v1/public/me</code>, puis choisissez un collectif avec <code>GET /v1/public/collectives</code>.</li>
    <li>Lancez une mission ; profil <code>demo</code> pour une réponse simulée en moins de 5 s, <code>fast</code> (défaut) pour un verdict réel en 1 à 2 min.</li>
  </ol>
<pre><code>curl -s ${api}/v1/public/missions \\
  -H "Authorization: Bearer $KAYROS_API_KEY" \\
  -H "Idempotency-Key: sf-0065g00000XyZab-Proposal" \\
  -H "Content-Type: application/json" \\
  -d '{"collective_id":"room_…","question":"Faut-il signer ACME à -15 % ?","profile":"demo",
       "external_ref":"salesforce:Opportunity:0065g00000XyZab"}'

curl -s ${api}/v1/public/missions/msn_… -H "Authorization: Bearer $KAYROS_API_KEY"</code></pre>
  <p>Webhooks : en-tête <code>X-Kayros-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code> avec <code>v1 = HMAC-SHA256(secret, t + "." + corps brut)</code>. Rejetez au-delà de 5 minutes d'écart et dédupliquez sur <code>event_id</code>.</p>
  <noscript><p>La référence interactive nécessite JavaScript : consultez directement <a href="/v1/public/openapi.json">la spécification</a>.</p></noscript>
</section>
<div id="reference"></div>
<script src="${SCALAR_SCRIPT}"></script>
<script>
  if (window.Scalar && Scalar.createApiReference) {
    // Pas d'assistant IA ni d'outils développeur Scalar (services tiers) sur la doc publique.
    Scalar.createApiReference('#reference', { url: '/v1/public/openapi.json', defaultOpenAllTags: true, showDeveloperTools: 'never', agent: { disabled: true } });
  }
</script>
</body>
</html>`;
}

export default async function publicDocsRoutes(app) {
  const ctx = () => app.kayrosContext || {};
  let cached = null;
  app.get('/v1/public/openapi.json', async (req, reply) => {
    cached ||= await loadOpenApiSpec({ baseUrl: ctx().publicApiUrl });
    return reply.header('cache-control', 'public, max-age=300').header('access-control-allow-origin', '*').send(cached);
  });
  app.get('/docs', async (req, reply) => reply
    .header('cache-control', 'public, max-age=300')
    .type('text/html; charset=utf-8')
    .send(docsHtml({ baseUrl: ctx().publicApiUrl || 'https://api.kayroslab.com' })));
}
