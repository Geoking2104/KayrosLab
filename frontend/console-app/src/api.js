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
  overview: () => request('/v1/console/overview'),
  createRoom: (room) => request('/v1/console/rooms', { method: 'POST', body: JSON.stringify(room) }),
  sendMessage: (roomId, text) => request(`/v1/console/rooms/${encodeURIComponent(roomId)}/messages`, {
    method: 'POST', body: JSON.stringify({ text }),
  }),
};
