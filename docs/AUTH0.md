# Auth0 SSO — KayrosLab

Tenant : `dev-1mveynszu4lngakl` (US) → `https://dev-1mveynszu4lngakl.us.auth0.com/`

## Application

Dans [Applications](https://manage.auth0.com/dashboard/us/dev-1mveynszu4lngakl/applications) :

1. **Create Application** → *Single Page Application* → nom `KayrosLab console`.
2. Onglet *Settings* :

| Champ | Valeur |
|---|---|
| Allowed Callback URLs | `https://www.kayroslab.com/console/, http://localhost:4174/console/` |
| Allowed Logout URLs | `https://www.kayroslab.com/console/, https://www.kayroslab.com/` |
| Allowed Web Origins | `https://www.kayroslab.com, http://localhost:4174` |
| Token Endpoint Authentication Method | None |

3. Copier le **Client ID** dans le secret GitHub `AUTH0_CLIENT_ID` (et optionnellement `AUTH0_DOMAIN` s’il n’est pas le défaut).

Les connexions (Google, Microsoft, base Auth0) se cochent dans *Connections*. Universal Login les propose alors au bouton **Continuer avec SSO**.

## Flux

La console (PKCE) redirige vers Auth0. Au retour, `POST /v1/auth/sso/auth0` vérifie l’`id_token` (JWKS) et émet le jeton KayrosLab. Un compte `contributeur` est créé à la première visite ; un compte existant est relié par e-mail.
