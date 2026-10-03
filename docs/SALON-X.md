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

## Usage des donn�es et de l'API X

Description compl�te (questionnaire de revue de l'app X, en anglais) : [docs/SALON-X-API-USAGE.md](SALON-X-API-USAGE.md).

## Pupitre Gazette — le texte monte seul du lien, les auteurs répondent (2026-10-03)

- Le propos est relevé du lien **sans compte ni jeton** : `fxtwitter`, puis `vxtwitter`, puis l'oembed de X (8 s max par source) ; un propos collé sans lien est **importé aussitôt** dans « Texte porté à la table », et en cas d'échec un message invite à le coller.
- Les plumes sont classées par proximité avec le propos (moteur du Salon + `corpus.json`) ; les 4 plus pertinentes sont cochées d'office.
- **Les auteurs répondent** : chaque plume compose une réponse ancrée dans son texte le plus proche (aveu du manque si rien ne répond) ; gestes « Retenir » (copier) et « Porter sur X » (en réponse au post si l'URL est fournie).
