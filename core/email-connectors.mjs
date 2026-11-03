// KayrosLab — import d'e-mails sans copier-coller, par les API officielles.
// Gmail API (users.messages) et Microsoft Graph (me/messages), avec un jeton OAuth
// fourni pour UNE requête par la personne (portée lecture seule). Le jeton n'est
// jamais stocké ni journalisé ; seuls les corps des messages envoyés par l'auteur
// alimentent l'analyse de style.

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const OUTLOOK_SCOPE = 'Mail.Read';
const MAX = 50;

function b64url(s = '') {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
function stripHtml(html = '') {
  return String(html).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}
function gmailBody(payload = {}) {
  const parts = [payload, ...(payload.parts || []).flatMap((p) => [p, ...(p.parts || [])])];
  const plain = parts.find((p) => p.mimeType === 'text/plain' && p.body?.data);
  if (plain) return b64url(plain.body.data);
  const html = parts.find((p) => p.mimeType === 'text/html' && p.body?.data);
  return html ? stripHtml(b64url(html.body.data)) : '';
}
async function getJson(fetchImpl, url, token, label) {
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (res.status === 401 || res.status === 403) throw new Error(`${label}: jeton OAuth refusé ou expiré (HTTP ${res.status})`);
  if (res.status === 429) throw new Error(`${label}: quota atteint (HTTP 429)`);
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  return res.json();
}

/** Messages envoyés par la personne (dossier « Envoyés ») via Gmail API. */
export async function fetchGmailMessages({ accessToken, query = 'in:sent', max = 20, fetchImpl = globalThis.fetch } = {}) {
  if (!accessToken) throw new Error('gmail: jeton OAuth requis (portée gmail.readonly)');
  const n = Math.min(MAX, Math.max(1, Number(max) || 20));
  const base = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const list = await getJson(fetchImpl, `${base}/messages?maxResults=${n}&q=${encodeURIComponent(query)}`, accessToken, 'gmail');
  const out = [];
  for (const { id } of (list.messages || []).slice(0, n)) {
    const msg = await getJson(fetchImpl, `${base}/messages/${encodeURIComponent(id)}?format=full`, accessToken, 'gmail');
    const headers = Object.fromEntries((msg.payload?.headers || []).map((h) => [String(h.name).toLowerCase(), h.value]));
    const body = gmailBody(msg.payload);
    if (body.trim()) out.push({ from: headers.from || '', subject: headers.subject || '', body });
  }
  return out;
}

/** Messages envoyés via Microsoft Graph (Outlook / Microsoft 365). */
export async function fetchOutlookMessages({ accessToken, max = 20, fetchImpl = globalThis.fetch } = {}) {
  if (!accessToken) throw new Error('outlook: jeton OAuth requis (portée Mail.Read)');
  const n = Math.min(MAX, Math.max(1, Number(max) || 20));
  const url = `https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$top=${n}&$select=from,subject,body`;
  const data = await getJson(fetchImpl, url, accessToken, 'outlook');
  return (data.value || []).map((m) => ({
    from: m.from?.emailAddress?.address || '',
    subject: m.subject || '',
    body: m.body?.contentType === 'html' ? stripHtml(m.body.content) : String(m.body?.content || ''),
  })).filter((m) => m.body.trim());
}
