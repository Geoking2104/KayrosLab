import { z } from 'zod';

const DEFAULT_BCC = 'geoffroydelatournelle@gmail.com';
const REPORT_MAX_PER_HOUR = 12;
const MAX_DOCUMENT_CHARS = 10_000_000;
const reportRate = new Map();

const leadSchema = z.object({
  lead: z.object({
    lastName: z.string().trim().min(1).max(120),
    firstName: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(6).max(40),
    professionalEmail: z.string().trim().email().max(254),
    company: z.string().trim().min(1).max(180),
    position: z.string().trim().min(1).max(180),
  }),
  requestedFormat: z.enum(['pdf', 'md']),
  consent: z.object({
    accepted: z.literal(true),
    acceptedAt: z.string().datetime().optional(),
    legalEntity: z.literal('SASU KayrosLab'),
    text: z.string().trim().min(20).max(1200),
  }),
  document: z.object({
    filename: z.string().trim().min(1).max(220),
    mimeType: z.string().trim().min(1).max(140),
    encoding: z.enum(['base64', 'utf8']),
    content: z.string().min(1).max(MAX_DOCUMENT_CHARS),
  }),
  report: z.object({
    title: z.string().max(220).optional(),
    language: z.enum(['fr', 'en']).optional(),
    generatedAt: z.string().nullable().optional(),
    startedAt: z.string().nullable().optional(),
    completedAt: z.string().nullable().optional(),
    idea: z.string().max(5000).optional(),
    finalKi: z.number().optional(),
    actions: z.number().int().nonnegative().optional(),
    steps: z.number().int().nonnegative().optional(),
  }).passthrough().optional().default({}),
});

function splitEmails(value = '') {
  return String(value).split(',').map((email) => email.trim()).filter(Boolean);
}

function cleanFilename(value, fallback) {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function checkReportRate(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  let entry = reportRate.get(ip);
  if (!entry || now - entry.start > windowMs) {
    entry = { start: now, count: 0 };
    reportRate.set(ip, entry);
  }
  entry.count += 1;
  return entry.count <= REPORT_MAX_PER_HOUR;
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

function formatRequested(format, lang = 'fr') {
  if (format === 'pdf') return 'PDF';
  return lang === 'en' ? 'Markdown' : 'Markdown';
}

function userEmailText({ lead, consent, requestedFormat, report }) {
  const lang = report.language === 'en' ? 'en' : 'fr';
  if (lang === 'en') {
    return [
      `Hello ${lead.firstName},`,
      '',
      `You will find attached the ${formatRequested(requestedFormat, lang)} report generated with the KayrosLab demo.`,
      '',
      `Company: ${lead.company}`,
      `Position: ${lead.position}`,
      report.idea ? `Idea: ${report.idea}` : null,
      typeof report.finalKi === 'number' ? `Final KI: ${report.finalKi}` : null,
      '',
      'Legal notice and GDPR:',
      `${consent.legalEntity} is the data controller. Your data is used to send the requested document and for KayrosLab internal commercial activity. It is not resold to third parties.`,
      '',
      'KayrosLab',
    ].filter(Boolean).join('\n');
  }
  return [
    `Bonjour ${lead.firstName},`,
    '',
    `Vous trouverez en pièce jointe le rapport ${formatRequested(requestedFormat, lang)} généré avec la démo KayrosLab.`,
    '',
    `Société : ${lead.company}`,
    `Position : ${lead.position}`,
    report.idea ? `Idée : ${report.idea}` : null,
    typeof report.finalKi === 'number' ? `KI final : ${report.finalKi}` : null,
    '',
    'Mentions légales et RGPD :',
    `${consent.legalEntity} est responsable de traitement. Vos données sont utilisées pour envoyer le document demandé et pour l'activité commerciale interne de KayrosLab. Elles ne sont pas revendues à des tiers.`,
    '',
    'KayrosLab',
  ].filter(Boolean).join('\n');
}

function attachmentFromDocument(document, requestedFormat) {
  const fallback = requestedFormat === 'pdf' ? 'kayroslab-report.pdf' : 'kayroslab-report.md';
  const attachment = {
    filename: cleanFilename(document.filename, fallback),
    content: document.content,
    contentType: document.mimeType,
  };
  if (document.encoding === 'base64') attachment.encoding = 'base64';
  return attachment;
}

export default async function demoReportLeadsRoute(app) {
  app.post('/v1/demo/report-leads', { bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
      || req.ip
      || 'unknown';
    if (!checkReportRate(ip)) {
      return reply.code(429).send({ error: `Quota d'envoi dépassé (${REPORT_MAX_PER_HOUR}/h). Réessayez plus tard.` });
    }

    const parsed = leadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'formulaire ou document invalide', issues: parsed.error.issues });
    }

    const transport = await smtpTransport();
    if (!transport) {
      return reply.code(503).send({ error: 'SMTP non configuré : renseigner KAYROS_SMTP_URL pour envoyer les rapports.' });
    }

    const data = parsed.data;
    const bcc = splitEmails(process.env.KAYROS_REPORT_LEAD_BCC || DEFAULT_BCC);
    const from = process.env.KAYROS_MAIL_FROM || 'kayroslab@localhost';
    const format = formatRequested(data.requestedFormat, data.report.language);
    const subject = data.report.language === 'en'
      ? `[KayrosLab] Your ${format} report`
      : `[KayrosLab] Votre rapport ${format}`;

    try {
      await transport.sendMail({
        from,
        to: data.lead.professionalEmail,
        bcc,
        replyTo: data.lead.professionalEmail,
        subject,
        text: userEmailText(data),
        attachments: [attachmentFromDocument(data.document, data.requestedFormat)],
      });
      app.log.info({ company: data.lead.company, requestedFormat: data.requestedFormat }, 'demo report lead delivered');
      return { ok: true, delivered: true, bcc: bcc.length > 0 };
    } catch (error) {
      app.log.error(error);
      return reply.code(502).send({ error: `Erreur SMTP : ${error.message || error}` });
    }
  });
}
