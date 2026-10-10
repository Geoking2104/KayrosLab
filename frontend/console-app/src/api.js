const TOKEN_KEY = 'kayros…oken';
const API_BASE = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

export function getToken() { return sessionStorage.getItem(TOKEN_KEY) || ''; }
export function setToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

async function request(path, options = {}) {
  const token = getToken();
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      // Pas de content-type sans corps : Fastify refuse un DELETE JSON vide.
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Requête refusée (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

// La console est un harness d'agents : elle parle de collectifs, de sessions et
// de missions. Aucune surface d'application tierce n'est exposée ici.
export const api = {
  register: (name, email, password) => request('/v1/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
  login: (email, password) => request('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  ssoConfig: () => request('/v1/auth/sso'),
  ssoStart: (body) => request('/v1/auth/sso/start', { method: 'POST', body: JSON.stringify(body) }),
  ssoCallback: (body) => request('/v1/auth/sso/callback', { method: 'POST', body: JSON.stringify(body) }),
  forgotPassword: (email) => request('/v1/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token, password) => request('/v1/auth/password/reset', { method: 'POST', body: JSON.stringify({ token, password }) }),
  overview: () => request('/v1/console/overview'),
  agents: () => request('/v1/console/agents'),
  createAgent: (agent) => request('/v1/console/agents', { method: 'POST', body: JSON.stringify(agent) }),
  updateAgent: (agentId, patch) => request(`/v1/console/agents/${encodeURIComponent(agentId)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  importCrystal: (agentId, input) => request(`/v1/console/agents/${encodeURIComponent(agentId)}/crystal`, { method: 'POST', body: JSON.stringify(input) }),
  importPersonality: (agentId, input) => request(`/v1/console/agents/${encodeURIComponent(agentId)}/personality`, { method: 'POST', body: JSON.stringify(input) }),
  setHumanProfile: (agentId, profile) => request(`/v1/console/agents/${encodeURIComponent(agentId)}/human-profile`, { method: 'PUT', body: JSON.stringify(profile) }),
  // Aperçu d'un profil réel (Crystal Knows API / export JSON / type DISC) avant ajout à un comité.
  previewPersonality: (input) => request('/v1/console/personality/preview', { method: 'POST', body: JSON.stringify(input) }),
  createImpersonator: (input) => request('/v1/console/impersonators', { method: 'POST', body: JSON.stringify(input) }),
  createImpersonatorTeam: (input) => request('/v1/console/impersonator-teams', { method: 'POST', body: JSON.stringify(input) }),
  connectConnector: (platform) => request(`/v1/console/connectors/${encodeURIComponent(platform)}/connect`, { method: 'POST', body: '{}' }),
  connectors: () => request('/v1/console/connectors'),
  configureConnector: (platform, input) => request(`/v1/console/connectors/${encodeURIComponent(platform)}`, { method: 'PUT', body: JSON.stringify(input) }),
  setConnectorEnabled: (platform, enabled) => request(`/v1/console/connectors/${encodeURIComponent(platform)}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  testConnector: (platform) => request(`/v1/console/connectors/${encodeURIComponent(platform)}/test`, { method: 'POST', body: '{}' }),
  sessions: () => request('/v1/console/sessions'),
  session: (sessionId) => request(`/v1/console/sessions/${encodeURIComponent(sessionId)}`),
  createSession: (session) => request('/v1/console/sessions', { method: 'POST', body: JSON.stringify(session) }),
  promoteSessionAgent: (sessionId, agentId, body = {}) => request(`/v1/console/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(agentId)}/promote`, { method: 'POST', body: JSON.stringify(body) }),
  updateSessionCollective: (sessionId, body) => request(`/v1/console/sessions/${encodeURIComponent(sessionId)}/collective`, { method: 'PATCH', body: JSON.stringify(body) }),
  // `profile` : demo (réponses préenregistrées), fast (défaut, 1–2 min) ou deep (~12 min).
  runMission: (sessionId, question, context, profile) => request(`/v1/console/sessions/${encodeURIComponent(sessionId)}/run`, {
    method: 'POST', body: JSON.stringify({ question, ...(context ? { context } : {}), ...(profile ? { profile } : {}) }),
  }),
  activity: (sessionId = '') => request(`/v1/console/activity${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''}`),
  thread: (threadId) => request(`/v1/console/threads/${encodeURIComponent(threadId)}`),
  replyThread: (threadId, text) => request(`/v1/console/threads/${encodeURIComponent(threadId)}/messages`, { method: 'POST', body: JSON.stringify({ text }) }),
  // Intégrations (n8n, Zapier, Salesforce) : clés d'API par tenant et webhooks signés.
  integrations: () => request('/v1/console/integrations'),
  createApiKey: (input) => request('/v1/console/integrations/keys', { method: 'POST', body: JSON.stringify(input) }),
  revokeApiKey: (keyId) => request(`/v1/console/integrations/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' }),
  updateWebhook: (input) => request('/v1/console/integrations/webhook', { method: 'PUT', body: JSON.stringify(input) }),
  revealWebhookSecret: () => request('/v1/console/integrations/webhook/secret', { method: 'POST', body: '{}' }),
  testWebhook: (url) => request('/v1/console/integrations/webhook/test', { method: 'POST', body: JSON.stringify(url ? { url } : {}) }),
  webhookDeliveries: () => request('/v1/console/integrations/deliveries'),
  arbitrateThread: (threadId, decision) => request(`/v1/console/threads/${encodeURIComponent(threadId)}/arbitrate`, { method: 'POST', body: JSON.stringify(decision) }),
};
