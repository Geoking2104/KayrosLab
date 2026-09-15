import {
  hashE164,
  last4,
  normalizeE164,
  openingProtocol,
  parseInbound,
  rememberWamid,
  waMeLink,
} from '../lib/salon-whatsapp.mjs';

const DEFAULT_SEATS = ['voltaire', 'rousseau', 'montaigne', 'kant'];

function configured() {
  return Boolean(process.env.WA_TOKEN && process.env.WA_PHONE_NUMBER_ID);
}

async function sendText(to, body) {
  if (!configured()) return { skipped: true };
  const url = `https://graph.facebook.com/v21.0/${process.env.WA_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || 'wa_send_failed');
    err.code = json?.error?.code;
    throw err;
  }
  return json;
}

async function sendTemplate(to, name, lang, components) {
  if (!configured()) return { skipped: true };
  const url = `https://graph.facebook.com/v21.0/${process.env.WA_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name, language: { code: lang }, components },
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || 'wa_template_failed');
    err.code = json?.error?.code;
    throw err;
  }
  return json;
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
  }, async (req, reply) => {
    const body = req.body || {};
    const entries = body.entry || [];
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
          if (parsed.kind === 'chat' || parsed.kind === 'empty') continue;
          if (!configured()) continue;
          try {
            if (parsed.kind === 'command' && parsed.name === 'qui') {
              await sendText(msg.from, openingProtocol({
                circleName: 'Lumières',
                question: 'Que reste-t-il de la liberté une fois qu’on a tout expliqué ?',
                seats: DEFAULT_SEATS,
              }));
            }
          } catch (error) {
            app.log.warn({ err: error }, 'salon-wa reply failed');
          }
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
    const record = {
      circleId,
      channel: 'wa_dm',
      hash: hashE164(e164),
      last4: last4(e164),
      locale,
      optInAt: new Date().toISOString(),
    };
    app.log.info({ circleId, last4: record.last4 }, 'salon-wa opt-in');

    let sent = false;
    if (configured() && process.env.WA_TEMPLATE_INVITE) {
      try {
        await sendTemplate(e164.replace(/^\+/, ''), process.env.WA_TEMPLATE_INVITE, locale, [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: locale === 'en' ? 'Host' : 'Hôte' },
              { type: 'text', text: circleId === 'lumieres' ? 'Lumières' : circleId },
              { type: 'text', text: String(payload.question || '—').slice(0, 140) },
              { type: 'text', text: link || 'https://www.kayroslab.com/salon/' },
            ],
          },
        ]);
        sent = true;
      } catch (error) {
        app.log.warn({ err: error }, 'salon-wa invite template failed');
      }
    }

    return {
      ok: true,
      configured: configured(),
      sent,
      circleId,
      last4: record.last4,
      waMe: link || null,
    };
  });
}
