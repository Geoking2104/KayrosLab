# Salon × X — Usage of X data and API

Reference document describing every use of X data and the X API in KayrosLab,
written for the X developer app review. Scope: the **Salon × X “Gazette”**
integration only.

Server: `backend/fastify/lib/salon-x.mjs`, `backend/fastify/routes/salon-x.mjs`.
Clients: `salon/src/lib/salon/x/*`, `backend/web/public/salon/flux*.js`.

## 1. Purpose

The Salon is a literary / philosophical discussion app. In **Gazette**, a host:

1. links **their own** X account (OAuth 2.0);
2. pastes the URL of an X post they want the table to interrogate;
3. if the post mentions them, publishes the Salon’s reply as a public X reply
   from their own account.

X is used as (a) the identity of the host and (b) the source and return channel
for a single, human-initiated discussion. Nothing is automated at scale.

## 2. Authorization (OAuth 2.0 + PKCE)

- Every host authorizes **their own** account. No app-owned/shared account; no
  action on other users’ accounts.
- Authorize: `https://twitter.com/i/oauth2/authorize` with
  `response_type=code`, `client_id`, `redirect_uri`, `scope`, `state`,
  `code_challenge`, `code_challenge_method=S256`.
- Redirect URI: `https://www.kayroslab.com/salon/flux/callback` (exact, no
  trailing slash).
- Token endpoint: `POST https://api.x.com/2/oauth2/token`
  (`authorization_code` + `code_verifier`; `refresh_token`; HTTP Basic client
  auth for a confidential app).
- **Scopes requested:** `tweet.read`, `users.read`, `tweet.write`,
  `offline.access`.

## 3. Data read from X

| Data | Endpoint | Use case |
|---|---|---|
| The host’s own identity (`id`, `name`, `username`) | `GET /2/users/me?user.fields=name,username` | Confirm the linked account; display “X lié @handle”; enforce the mention rule |
| The `text` / `author_id` / `conversation_id` of one post the host pastes | `GET /2/tweets/{id}?tweet.fields=text,author_id,conversation_id` | (a) Ground the Salon discussion in that post; (b) verify the host is @mentioned before allowing a reply |

No timelines, followers, search, streaming or bulk reads. No other users’ data.

## 4. Data written to X

| Action | Endpoint | Conditions |
|---|---|---|
| Publish a **reply** to the source post | `POST /2/tweets` (`{ text, reply.in_reply_to_tweet_id }`) | Only from the host’s own account; **only if the host’s handle is @mentioned in the source post**; **≥ 45 s** between posts; idempotent (duplicate content hashes suppressed) |
| Retract our own reply | `DELETE /2/tweets/{id}` | Only tweets this app created for this host, within **24 h** |

## 5. Token lifecycle

- Access/refresh tokens are **sealed with AES-256-GCM** (`X_TOKEN_SECRET`) into a
  per-host file, mode `0600`. They are **never returned in any HTTP response**
  (`publicBinding` exposes only `handle` / `engagement`).
- `offline.access` is used solely to refresh the host’s own token.
- On unlink: `POST https://api.x.com/2/oauth2/revoke` (best-effort) and the
  stored file is deleted.

## 6. Not done through the X API

- Parsing of `x.com` / `twitter.com/.../status/…` URLs happens locally in the
  browser to extract a status ID — no API call.
- “Carry to X” opens the **`x.com/intent/tweet`** composer prefilled (a web
  intent, not the API) so the user posts manually.

## 7. What we do NOT do

- No scraping, crawling, or bulk/aggregated collection.
- No DMs, private data, or other accounts; no posting on behalf of anyone but
  the authorizing host.
- No selling, reselling or redistribution of X data; no model training; no
  surveillance or monitoring.
- No automated or bulk publishing — every reply is human-initiated and
  mention-gated.
- Content read is transient (used for the session) and not republished beyond
  the referenced post.

## 8. Compliance summary

- Single-purpose app; each host links their own account; revocable at any time.
- Data minimization (only the `text`/identity fields actually needed), explicit
  purpose, and a delete path for every write.
- Endpoints used: `/2/oauth2/token`, `/2/oauth2/revoke`, `/2/users/me`,
  `/2/tweets` (GET by id, POST, DELETE by id).
