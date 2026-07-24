# KayrosLab — Public Demo Proxy (Mistral)

This Cloudflare Worker is the **only** place that holds the Mistral API key.
Visitors of `kayroslab-complete-with-ai-agents.html` never see the key.

## Why a proxy?

A static page (GitHub Pages) cannot hide secrets. Any key in the browser JS is recoverable in DevTools. The Worker runs on Cloudflare’s edge, injects `MISTRAL_API_KEY` from a secret, and returns only the model text.

## Deploy (5 minutes)

### 1. Install Wrangler (once)

```bash
npm i -g wrangler
wrangler login
```

### 2. Create & deploy the Worker

From the repo root:

```bash
# Create a minimal wrangler.toml if you don't have one
cat > wrangler.toml << 'EOF'
name = "kayros-demo-proxy"
main = "workers/mistral-demo-proxy.js"
compatibility_date = "2024-11-01"
EOF

wrangler deploy
```

Note the URL printed, e.g. `https://kayros-demo-proxy.<account>.workers.dev`.

### 3. Set the secret (never commit the key)

```bash
wrangler secret put MISTRAL_API_KEY
# paste your key from https://console.mistral.ai when prompted
```

**Important:** the key that was shared in chat should be **rotated** on the Mistral console first.

### 4. (Optional) Custom domain

In Cloudflare Dashboard → Workers → kayros-demo-proxy → Triggers → Custom Domain:
`api.kayroslab.com` or path `www.kayroslab.com/api/demo/chat`.

### 5. Point the HTML demo to the Worker

In `kayroslab-complete-with-ai-agents.html`, set:

```js
const PROXY_URL = 'https://kayros-demo-proxy.<account>.workers.dev';
```

(or your custom domain).

## Limits (reduced public mode)

| Limit | Value |
|-------|-------|
| Requests / IP / hour | 20 |
| max_tokens | 900 |
| Model | `mistral-small-latest` |
| Allowed origins | kayroslab.com + localhost |

Adjust constants at the top of `mistral-demo-proxy.js` and redeploy.

## Request / response

```http
POST / HTTP/1.1
Content-Type: application/json

{ "system": "...", "user": "..." }
```

```json
{ "content": "...", "model": "mistral-small-latest", "usage": { ... } }
```
