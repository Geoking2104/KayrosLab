# Salon × Flux X

Décision validée le 18 septembre 2026 :

- Compte X **de l’hôte** (pas un @SalonKayros collectif).
- **SSO Salon obligatoire** avant d’ouvrir le pupitre (`sso.ts`).
- Liaison X (OAuth 2.0 PKCE) ensuite ; jetons côté `api.kayroslab.com`, jamais dans le bundle Pages.

## P0

URL / collage → thèse → 1–4 auteurs → confirmation + infirmation → Court / Long → Copier / Intent X.

L’écriture API est refusée hors convocation (`@mention` du handle lié).

## Backend attendu

Bearer Salon sur tous les endpoints.

- `POST /v1/salon/x/oauth/start` `{ redirectUri, scopes }` → `{ url }`
- `POST /v1/salon/x/oauth/callback` `{ code, state }` → `{ binding }`
- `GET|PATCH|DELETE /v1/salon/x/binding`
- `POST /v1/salon/x/tweets` `{ text, in_reply_to_tweet_id, made_with_ai }` → `{ id }`

Redirect : `https://www.kayroslab.com/salon/flux/callback`.
