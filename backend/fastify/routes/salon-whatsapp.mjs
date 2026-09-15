import {
  hashE164, last4, normalizeE164, openingProtocol, parseInbound, rememberWamid, waMeLink,
} from '../lib/salon-whatsapp.mjs';

const DEFAULT_SEATS = ['voltaire', 'rousseau', 'montaigne', 'kant'];
function configured() {
  return Boolean(process.env.WA_TOKEN && process.env.WA_PHONE_NUMBER_ID);
}

export default async function salonWhatsappRoutes(app) {
  app.get('/v1/salon/whatsapp/webhook', async (req, reply) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const expected = process.env.WA_VERIFY_TOKEN || '';
    if (mode === 'subscribe' && expected && token === expected) {
      return reply.code(200).type('text/plain').send(String(challenge || ''));
    }
    return reply.code(403).send({ error: 'verify refused' });
  });

  app.post('/v1/salon/whatsapp/webhook', {
    config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
  }, async (req) => {
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        for (const status of value.statuses || []) {
          await rememberWamid(status.id, { kind: 'status', status: status.status });
        }
        for (const msg of value.messages || []) {
          const rec = await rememberWamid(msg.id, { kind: 'inbound', from: 'redacted' });
          if (!rec.fresh) continue;
          const parsed = parseInbound(msg.text?.body || '');
          app.log.info({ parsed: parsed.kind, wamid: msg.id }, 'salon-wa inbound');
          if (parsed.kind === 'chat' || parsed.kind === 'empty' || !configured()) continue;
        }
      }
    }
    return { ok: true };
  });

  app.post('/v1/salon/whatsapp/open', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const payload = req.body || {};
    if (payload.optIn !== true) return reply.code(400).send({ error: 'opt-in requis' });
    const e164 = normalizeE164(payload.e164 || payload.phone);
    if (!e164) return reply.code(400).send({ error: 'numéro invalide' });
    const circleId = String(payload.circleId || 'lumieres').slice(0, 80);
    const locale = payload.locale === 'en' ? 'en' : 'fr';
    const display = process.env.WA_DISPLAY_NUMBER || '';
    const link = waMeLink(display, locale === 'en' ? 'The table is set.' : 'La table est dressée.');
    app.log.info({ circleId, last4: last4(e164), hash: hashE164(e164).slice(0, 8) }, 'salon-wa opt-in');
    return {
      ok: true,
      configured: configured(),
      sent: false,
      circleId,
      last4: last4(e164),
      waMe: link || null,
    };
  });
}
