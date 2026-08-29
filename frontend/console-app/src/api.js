const TOKEN_KEY = 'kayros_console_token';
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
      'content-type': 'application/json',
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

export const api = {
  register: (name, email, password) => request('/v1/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
  login: (email, password) => request('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  forgotPassword: (email) => request('/v1/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token, password) => request('/v1/auth/password/reset', { method: 'POST', body: JSON.stringify({ token, password }) }),
  overview: () => request('/v1/console/overview'),
  agents: () => request('/v1/console/agents'),
  createAgent: (agent) => request('/v1/console/agents', { method: 'POST', body: JSON.stringify(agent) }),
  updateAgent: (agentId, patch) => request(`/v1/console/agents/${encodeURIComponent(agentId)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  importCrystal: (agentId, input) => request(`/v1/console/agents/${encodeURIComponent(agentId)}/crystal`, { method: 'POST', body: JSON.stringify(input) }),
  connectors: () => request('/v1/console/connectors'),
  configureConnector: (platform, input) => request(`/v1/console/connectors/${encodeURIComponent(platform)}`, { method: 'PUT', body: JSON.stringify(input) }),
  setConnectorEnabled: (platform, enabled) => request(`/v1/console/connectors/${encodeURIComponent(platform)}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  testConnector: (platform) => request(`/v1/console/connectors/${encodeURIComponent(platform)}/test`, { method: 'POST', body: '{}' }),
  createRoom: (room) => request('/v1/console/rooms', { method: 'POST', body: JSON.stringify(room) }),
  sendMessage: (roomId, text) => request(`/v1/console/rooms/${encodeURIComponent(roomId)}/messages`, {
    method: 'POST', body: JSON.stringify({ text }),
  }),
  thread: (threadId) => request(`/v1/console/threads/${encodeURIComponent(threadId)}`),
  replyThread: (threadId, text) => request(`/v1/console/threads/${encodeURIComponent(threadId)}/messages`, { method: 'POST', body: JSON.stringify({ text }) }),
  arbitrateThread: (threadId, decision) => request(`/v1/console/threads/${encodeURIComponent(threadId)}/arbitrate`, { method: 'POST', body: JSON.stringify(decision) }),
};
