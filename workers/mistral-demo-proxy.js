/**
 * KayrosLab — Public Demo Proxy (Cloudflare Worker)
 * -------------------------------------------------
 * Keeps the Mistral API key server-side so visitors can test
 * the reduced agent cycle without ever seeing credentials.
 *
 * Deploy:
 *   1. npx wrangler deploy workers/mistral-demo-proxy.js
 *      (or paste into Cloudflare Dashboard → Workers)
 *   2. Set secret:  wrangler secret put MISTRAL_API_KEY
 *   3. Optional route: api.kayroslab.com/demo/chat  → this worker
 *   4. Point the HTML demo PROXY_URL to your worker URL
 *
 * Env secrets required:
 *   MISTRAL_API_KEY  – your Mistral console key (never commit it)
 */

const ALLOWED_ORIGINS = [
  'https://www.kayroslab.com',
  'https://kayroslab.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
];

// Reduced public demo limits
const MAX_REQUESTS_PER_HOUR = 20;   // per IP
const MAX_TOKENS = 900;
const MODEL = 'mistral-small-latest';

// Simple in-memory rate limit (resets on worker isolate recycle — good enough for demo)
const rateMap = new Map();

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  let entry = rateMap.get(ip);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { windowStart: now, count: 0 };
    rateMap.set(ip, entry);
  }
  entry.count += 1;
  return entry.count <= MAX_REQUESTS_PER_HOUR;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    // Rate limit
    const ip = clientIp(request);
    if (!checkRateLimit(ip)) {
      return new Response(JSON.stringify({
        error: 'Rate limit exceeded. Public demo is limited to ' + MAX_REQUESTS_PER_HOUR + ' requests per hour.',
      }), {
        status: 429,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    if (!env.MISTRAL_API_KEY) {
      return new Response(JSON.stringify({ error: 'Server misconfigured: MISTRAL_API_KEY missing' }), {
        status: 500,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    const system = typeof body.system === 'string' ? body.system.slice(0, 4000) : '';
    const user = typeof body.user === 'string' ? body.user.slice(0, 6000) : '';
    if (!user) {
      return new Response(JSON.stringify({ error: 'Missing user message' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: user });

    try {
      const mistralRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + env.MISTRAL_API_KEY,
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: 0.4,
          max_tokens: MAX_TOKENS,
        }),
      });

      const data = await mistralRes.json();

      if (!mistralRes.ok) {
        return new Response(JSON.stringify({
          error: 'Upstream error',
          detail: data?.message || data?.error || mistralRes.statusText,
        }), {
          status: mistralRes.status,
          headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      const content = data.choices?.[0]?.message?.content || '';
      return new Response(JSON.stringify({
        content,
        model: MODEL,
        usage: data.usage || null,
      }), {
        status: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Proxy failure', detail: String(err.message || err) }), {
        status: 502,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
  },
};
