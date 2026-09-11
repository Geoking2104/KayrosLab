import { z } from 'zod';

// Formulaire public : lettre, signalement (pièces jointes) ou prise de contact commerciale.
// L'adresse de destination reste côté serveur.
const DEFAULT_TO = 'contact@kayroslab.com';
const CONTACT_MAX_PER_HOUR = 5;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 3;
const contactRate = new Map();

const ALLOWED_FILE = /^(application\/pdf|application\/json|image\/(png|jpeg|gif|webp)|text\/(plain|markdown|csv|log))$/i;
const ALLOWED_EXT = /\.(pdf|png|jpe?g|gif|webp|txt|md|csv|log|json)$/i;

const leadSchema = z.object({
  lastName: z.string().trim().min(1).max(120),
  firstName: z.string().trim().min(1).max(120),
  company: z.string().trim().min(1).max(180),
  position: z.string().trim().min(1).max(180),
  email: z.string().trim().email().max(254),
  language: z.enum(['fr', 'en']).optional().default('fr'),
  website: z.string().max(200).optional().default(''),
});

const noteSchema = z.object({
  kind: z.enum(['message', 'bug']),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  subject: z.string().trim().max(180).optional().default(''),
  message: z.string().trim().min(8).max(8000),
  language: z.enum(['fr', 'en']).optional().default('fr'),
  website: z.string().max(200).optional().default(''),
  files: z.array(z.object({
    name: z.string().trim().min(1).max(180),
    type: z.string().trim().max(80).optional().default('application/octet-stream'),
    data: z.string().min(1).max(2_800_000),
  })).max(MAX_FILES).optional().default([]),
});

function splitEmails(value = '') {
  return String(value).split(',').map((email) => email.trim()).filter(Boolean);
}

function checkContactRate(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  let entry = contactRate.get(ip);
  if (!entry || now - entry.start > windowMs) {
    entry = { start: now, count: 0 };
    contactRate.set(ip, entry);
  }
  entry.count += 1;
  return entry.count <= CONTACT_MAX_PER_HOUR;
}

import { smtpFromEnv, createSmtpTransport } from '../lib/smtp.mjs';

let transportPromise = null;
async function smtpTransport() {
  if (transportPromise) return transportPromise;
  const smtp = smtpFromEnv();
  if (!smtp.enabled) return null;
  transportPromise = createSmtpTransport(smtp);
  return transportPromise;
}

function decodeAttachment(file) {
  const name = String(file.name || 'piece').replace(/[^\w.\- ()àâäéèêëïîôùûüç]+/gi, '_').slice(0, 180);
  const type = String(file.type || 'application/octet-stream');
  if (!ALLOWED_FILE.test(type) && !ALLOWED_EXT.test(name)) {
    const e = new Error(`pièce refusée : ${name}`);
    e.code = 'CONTACT_FILE';
    throw e;
  }
  const raw = String(file.data || '').replace(/^data:[^;]+;base64,/, '');
  let buf;
  try { buf = Buffer.from(raw, 'base64'); }
  catch {
    const e = new Error('pièce illisible');
    e.code = 'CONTACT_FILE';
    throw e;
  }
  if (!buf.length || buf.length > MAX_FILE_BYTES) {
    const e = new Error('pièce trop volumineuse (2 Mo par fichier)');
    e.code = 'CONTACT_FILE';
    throw e;
  }
  return { filename: name, content: buf, contentType: ALLOWED_FILE.test(type) ? type : 'application/octet-stream' };
}

export default async function contactRoute(app) {
  app.post('/v1/contact', { bodyLimit: 5 * 1024 * 1024 }, async (req, reply) => {
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
      || req.ip
      || 'unknown';
    if (!checkContactRate(ip)) {
      return reply.code(429).send({ error: `Quota d'envoi dépassé (${CONTACT_MAX_PER_HOUR}/h). Réessayez plus tard.` });
    }

    const isNote = req.body && (req.body.kind === 'message' || req.body.kind === 'bug');
    const parsed = isNote ? noteSchema.safeParse(req.body) : leadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'formulaire invalide', issues: parsed.error.issues });
    }

    const data = parsed.data;
    if (data.website) {
      return { ok: true };
    }

    let attachments = [];
    if (isNote && data.files?.length) {
      try { attachments = data.files.map(decodeAttachment); }
      catch (error) {
        if (error.code === 'CONTACT_FILE') return reply.code(400).send({ error: error.message });
        throw error;
      }
    }

    const transport = app.kayrosContext.contactMailer || await smtpTransport();
    if (!transport) {
      return reply.code(503).send({ error: 'SMTP non configuré : renseigner KAYROS_SMTP_PASS (mot de passe d’application Gmail).' });
    }

    const to = splitEmails(process.env.KAYROS_CONTACT_TO || DEFAULT_TO);
    const from = process.env.KAYROS_MAIL_FROM
      || app.kayrosContext.smtp?.from
      || 'KayrosLab <geoffroydelatournelle@gmail.com>';
    let subject;
    let text;
    if (isNote) {
      const kindLabel = data.kind === 'bug' ? 'Signalement' : 'Lettre';
      subject = `[KayrosLab] ${kindLabel} — ${data.name}${data.subject ? ` — ${data.subject}` : ''}`;
      text = [
        data.kind === 'bug' ? 'Signalement / remarque depuis le Salon.' : 'Lettre depuis le Salon.',
        '',
        `Nom : ${data.name}`,
        `E-mail : ${data.email}`,
        data.subject ? `Objet : ${data.subject}` : '',
        `Langue : ${data.language}`,
        attachments.length ? `Pièces : ${attachments.map((a) => a.filename).join(', ')}` : '',
        '',
        data.message,
      ].filter(Boolean).join('\n');
    } else {
      subject = `[KayrosLab] Demande de contact — ${data.firstName} ${data.lastName} (${data.company})`;
      text = [
        'Nouvelle demande de contact envoyée depuis kayroslab.com.',
        '',
        `Prénom : ${data.firstName}`,
        `Nom : ${data.lastName}`,
        `Société : ${data.company}`,
        `Fonction : ${data.position}`,
        `E-mail : ${data.email}`,
        `Langue du formulaire : ${data.language}`,
        '',
        'Répondre directement à cet e-mail atteint l\'expéditeur (reply-to).',
      ].join('\n');
    }

    try {
      await transport.sendMail({
        from,
        to,
        replyTo: data.email,
        subject,
        text,
        attachments: attachments.length ? attachments : undefined,
      });
      app.log.info({ kind: isNote ? data.kind : 'lead', language: data.language }, 'contact request delivered');
      return { ok: true, delivered: true };
    } catch (error) {
      app.log.error(error);
      return reply.code(502).send({ error: `Erreur SMTP : ${error.message || error}` });
    }
  });
}
