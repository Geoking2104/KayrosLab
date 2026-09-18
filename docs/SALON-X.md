# Salon × Flux X

Décision validée le 18 septembre 2026 :

- Compte X **de l’hôte** (pas un @SalonKayros collectif).
- **SSO Salon obligatoire** avant d’ouvrir le pupitre (`sso.ts`).
- Liaison X (OAuth 2.0 PKCE) ensuite ; jetons scellés côté `api.kayroslab.com`.

## P0

URL / collage → thèse → 1–4 auteurs → confirmation + infirmation → Court / Long → Copier / Intent X.

Depuis une séance : lien **Flux X** → `/salon/flux/{circleId}` (ex. `/salon/flux/lumieres`).

L’écriture API relit le post source et refuse hors `@mention` du handle lié.

## Backend livré

Bearer Salon sur tous les endpoints. Fichiers : `backend/fastify/lib/salon-x.mjs`, `backend/fastify/routes/salon-x.mjs`.

| Méthode | Chemin | Rôle |
|---|---|---|
| POST | `/v1/salon/x/oauth/start` | `{ redirectUri, scopes }` → `{ url }` |
| POST | `/v1/salon/x/oauth/callback` | `{ code, state }` → `{ binding }` public |
| GET | `/v1/salon/x/binding` | état sans jetons |
| PATCH | `/v1/salon/x/binding` | `{ engagement }` |
| DELETE | `/v1/salon/x/binding` | révoque |
| POST | `/v1/salon/x/tweets` | mention + 45 s + idempotence → `{ id }` |
| DELETE | `/v1/salon/x/tweets/:id` | 24 h, tweets Salon seulement |

Redirect accepté : `https://<hôte>/salon/flux/callback`.

## Env

- `X_CLIENT_ID` (requis pour lier)
- `X_CLIENT_SECRET` (si app confidentielle)
- `X_TOKEN_SECRET` ou `KAYROS_AUTH_SECRET` (sceau AES-256-GCM)
- `X_OAUTH_REDIRECT` (optionnel)
- `KAYROS_SALON_X_DIR` (fichiers `*.x.json` mode 0600)
