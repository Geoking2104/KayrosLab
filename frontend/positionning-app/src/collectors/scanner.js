const API_BASE = getApiBase();
const BACKEND_SEARCH = `${API_BASE}/v1/positionning/search`;
const BACKEND_GITHUB = `${API_BASE}/v1/positionning/github`;
const BACKEND_ARXIV = `${API_BASE}/v1/positionning/arxiv`;
const BACKEND_ANALYZE = `${API_BASE}/v1/demo/positionning/analyze`;

export function getApiBase() {
  const configured = import.meta.env?.VITE_KAYROS_API_BASE?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (typeof window !== 'undefined' && /(^|\.)kayroslab\.com$/i.test(window.location.hostname)) {
    return 'https://api.kayroslab.com';
  }
  return '';
}

export async function searchCompetitors(idea) {
  try {
    const res = await fetch(BACKEND_SEARCH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: idea, limit: 5 }),
    });
    if (!res.ok) throw new Error(`Search backend returned ${res.status}`);
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

export async function searchGitHub(idea, { limit = 5, token } = {}) {
  try {
    const res = await fetch(BACKEND_GITHUB, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: idea, limit }),
    });
    if (!res.ok) throw new Error(`GitHub backend returned ${res.status}`);
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

export async function searchArXiv(idea, { limit = 5 } = {}) {
  try {
    const res = await fetch(BACKEND_ARXIV, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: idea, limit }),
    });
    if (!res.ok) throw new Error(`ArXiv backend returned ${res.status}`);
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

export async function analyzeIdea(idea, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const res = await fetch(BACKEND_ANALYZE, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idea,
      limit: opts.limit || 3,
      gapThreshold: opts.gapThreshold,
    }),
  });
  if (!res.ok) {
    let message = `Analyze backend returned ${res.status}`;
    try {
      const data = await res.json();
      message = data.message || data.error || message;
    } catch {
      // Keep the HTTP status message.
    }
    throw new Error(message);
  }
  return res.json();
}
