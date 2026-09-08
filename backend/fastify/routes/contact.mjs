import { z } from 'zod';

// Formulaire de contact public du site kayroslab.com.
// L'adresse de destination reste strictement côté serveur : elle n'apparaît
// nulle part dans la page, la requête ou les réponses envoyées au visiteur.
const DEFAULT_TO = 'geoffroydelatournelle@gmail.com';
const CONTACT_MAX_PER_HOUR = 5;
const contactRate = new Map();

const contactSchema = z.object({
  lastName: z.string().trim().min(1).max(120),
  firstName: z.string().trim().min(1).max(120),
  company: z.string().trim().min(1).max(180),
  position: z.string().trim().min(1).max(180),
  email: z.string().trim().email().max(254),
  language: z.enum(['fr', 'en']).optional().default('fr'),
  // Honeypot anti-spam : champ invisible côté page, doit rester vide.
  website: z.string().max(200).optional().default(''),
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

let transportPromise = null;
async function smtpTransport() {
  const smtpUrl = process.env.KAYROS_SMTP_URL || '';
  if (!smtpUrl) return null;
  if (!transportPromise) {
    transportPromise = import('nodemailer').then(({ createTransport }) => createTransport(smtpUrl));
  }
  return transportPromise;
}

export default async function contactRoute(app) {
  app.post('/v1/contact', async (req, reply) => {
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
      || req.ip
      || 'unknown';
    if (!checkContactRate(ip)) {
      return reply.code(429).send({ error: `Quota d'envoi dépassé (${CONTACT_MAX_PER_HOUR}/h). Réessayez plus tard.` });
    }

    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'formulaire invalide', issues: parsed.error.issues });
    }

    const data = parsed.data;
    if (data.website) {
      // Honeypot rempli : probablement un robot. On répond OK sans rien envoyer.
      return { ok: true };
    }

    const transport = await smtpTransport();
    if (!transport) {
      return reply.code(503).send({ error: 'SMTP non configuré : renseigner KAYROS_SMTP_URL pour envoyer les demandes de contact.' });
    }

    const to = splitEmails(process.env.KAYROS_CONTACT_TO || DEFAULT_TO);
    const from = process.env.KAYROS_MAIL_FROM || 'kayroslab@localhost';
    const subject = `[KayrosLab] Demande de contact — ${data.firstName} ${data.lastName} (${data.company})`;
    const text = [
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

    try {
      await transport.sendMail({
        from,
        to,
        replyTo: data.email,
        subject,
        text,
      });
      app.log.info({ company: data.company, language: data.language }, 'contact request delivered');
      return { ok: true, delivered: true };
    } catch (error) {
      app.log.error(error);
      return reply.code(502).send({ error: `Erreur SMTP : ${error.message || error}` });
    }
  });
}
