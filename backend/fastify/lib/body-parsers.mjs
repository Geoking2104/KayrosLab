// Analyseurs de corps conservant le corps brut (`req.rawBody`) : les
// signatures Slack (HMAC) et Discord (Ed25519) portent sur les octets reçus.
// Slack envoie ses interactions (`payload=`) et commandes slash en
// application/x-www-form-urlencoded.

export function registerBodyParsers(app) {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body;
    try { done(null, JSON.parse(body)); } catch (error) { done(error); }
  });
  if (app.hasContentTypeParser('application/x-www-form-urlencoded')) app.removeContentTypeParser('application/x-www-form-urlencoded');
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (req, body, done) => {
    req.rawBody = body;
    try { done(null, Object.fromEntries(new URLSearchParams(body))); } catch (error) { done(error); }
  });
}

/**
 * Webhooks de chat de l'application du serveur : authentifiés par la
 * signature de la plateforme (vérifiée dans routes/connectors.mjs), jamais
 * par le secret partagé KAYROS_SECRET qu'aucune plateforme ne peut envoyer.
 */
export function isSignedChatWebhook(path) {
  return /^\/v1\/connectors\/(slack|discord|teams)\/configured\/[0-9a-f-]+$/i.test(path)
    || /^\/v1\/connectors\/slack\/(events|interactive)$/.test(path)
    || /^\/v1\/connectors\/(discord|teams)\/interactive$/.test(path);
}
