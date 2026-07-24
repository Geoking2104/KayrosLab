# KayrosLab — Rust Mistral Proxy (Cloudflare Worker)

Server-side bridge between the public HTML demo and Mistral.
**The API key never reaches the browser.**

## Why not embed the key in HTML / WASM?

Any key in client-side JS **or** WebAssembly is recoverable (Network tab shows `Authorization`, WASM can be reverse-engineered). The only safe place is a server (this Worker).

## Deploy

```bash
cd workers/rust-mistral-proxy

# needs: rustup target add wasm32-unknown-unknown
npx wrangler deploy

# paste a FRESH key from https://console.mistral.ai (rotate any key shared in chat)
npx wrangler secret put MISTRAL_API_KEY
```

Copy the Worker URL printed by wrangler, e.g.
`https://kayros-mistral-proxy.<account>.workers.dev`

## Wire the HTML

In `kayroslab-complete-with-ai-agents.html`:

```js
const PROXY_URL = 'https://kayros-mistral-proxy.<account>.workers.dev';
```

## API

```http
POST /
Content-Type: application/json

{ "system": "...", "user": "..." }
```

```json
{ "content": "...", "model": "mistral-small-latest" }
```

## Security checklist

- [ ] Key only via `wrangler secret put` — never in git
- [ ] Rotate keys that appeared in chat/logs
- [ ] CORS limited to kayroslab.com (+ localhost for dev)
