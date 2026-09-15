import { createHash } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const seen = new Set();

export function normalizeE164(raw) {
  let digits = String(raw || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (/^0[1-9]\d{8}$/.test(digits.replace(/\+/g, ''))) {
    digits = `+33${digits.replace(/\+/g, '').slice(1)}`;
  }
  const withPlus = digits.startsWith('+') ? digits : `+${digits}`;
  if (!/^\+[1-9]\d{7,14}$/.test(withPlus)) return '';
  return withPlus;
}

export function hashE164(e164, salt = process.env.WA_HASH_SALT || 'salon-wa') {
  return createHash('sha256').update(`${salt}:${e164}`).digest('hex');
}

export function last4(e164) {
  return String(e164 || '').replace(/\D/g, '').slice(-4);
}

export function resolveHandle(token, known = []) {
  const key = String(token || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!key) return { kind: 'unknown' };
  const aliases = { voltair: 'voltaire', jjrousseau: 'rousseau', jeanjacquesrousseau: 'rousseau' };
  const id = aliases[key] || key;
  const hits = known.length ? known.filter((k) => k === id || k.startsWith(id) || id.startsWith(k)) : [id];
  const exact = hits.filter((k) => k === id);
  if (exact.length === 1) return { kind: 'ok', id: exact[0] };
  if (hits.length > 1) return { kind: 'ambiguous', ids: hits.slice(0, 3) };
  if (known.length && !known.includes(id)) return { kind: 'unknown', suggestions: known.slice(0, 3) };
  return { kind: 'ok', id };
}

export function parseInbound(text) {
  const raw = String(text || '').trim();
  const lower = raw.toLowerCase();
  if (!raw) return { kind: 'empty' };
  if (/^\/clore\b/.test(lower) || lower === 'clore') return { kind: 'command', name: 'clore' };
  if (/^\/pause\b/.test(lower)) return { kind: 'command', name: 'pause' };
  if (/^\/qui\b/.test(lower)) return { kind: 'command', name: 'qui' };
  if (/^\/tour\b/.test(lower) || /laissez parler|laisser le salon parler|let the salon speak/.test(lower)) {
    return { kind: 'command', name: 'tour' };
  }
  const fiche = raw.match(/^\/fiche\s+@?([A-Za-z0-9_\-]+)/i);
  if (fiche) return { kind: 'command', name: 'fiche', handle: fiche[1] };
  const mention = raw.match(/@([A-Za-z0-9_\-]+)/);
  if (mention) {
    const handle = mention[1];
    const body = raw.replace(mention[0], '').trim();
    return { kind: 'address', handle, body };
  }
  return { kind: 'chat', body: raw };
}

export function projectTurn(identity, { act, other, body, cite, work } = {}) {
  const lines = [`${identity.name}  ·  @${identity.handle}`];
  if (act && other) lines.push(`${act} à ${other}`);
  if (body) lines.push('', body);
  if (cite && work) lines.push('', `« ${cite} » — ${work}`);
  return lines.join('\n');
}

export function openingProtocol({ circleName, question, seats, locale = 'fr' }) {
  const list = (seats || []).map((id) => `@${id}`).join(' · ');
  if (locale === 'en') {
    return [
      `The table is set. Circle ${circleName}.`,
      `Question: ${question}`,
      `Seated: ${list}`,
      'Address a guest (@voltaire …). Say “let the salon speak” to hear them answer one another.',
      'Voices generated from public-domain works. This number is The Salon, not the author.',
    ].join('\n');
  }
  return [
    `La table est dressée. Cercle ${circleName}.`,
    `Question : ${question}`,
    `À table : ${list}`,
    'Adressez un convive (@voltaire …). Dites « laissez parler » pour les entendre se répondre.',
    'Voix générées à partir d’œuvres du domaine public. Ce numéro est Le Salon, pas l’auteur.',
  ].join('\n');
}

export async function rememberWamid(wamid, meta = {}) {
  if (!wamid) return { fresh: false };
  if (seen.has(wamid)) return { fresh: false };
  seen.add(wamid);
  const file = process.env.KAYROS_WA_EVENTS_FILE;
  if (file) {
    try {
      await mkdir(dirname(file), { recursive: true });
      await appendFile(file, `${JSON.stringify({ wamid, at: new Date().toISOString(), ...meta })}\n`);
    } catch {
      /* journal best-effort */
    }
  }
  return { fresh: true };
}

export function waMeLink(e164Display, text) {
  const num = String(e164Display || '').replace(/\D/g, '');
  if (!num) return '';
  const q = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${num}${q}`;
}
