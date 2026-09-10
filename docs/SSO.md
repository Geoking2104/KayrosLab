# SSO OpenID Connect — KayrosLab

Pas d’Auth0. Le protocole est **OpenID Connect** (standard ouvert). L’identité est hébergée ici : **Authelia** (Apache-2.0).

## Composants

| Pièce | Rôle |
|---|---|
| Console | client public PKCE (`kayroslab-console`) |
| `https://api.kayroslab.com` | vérifie l’`id_token`, émet le jeton KayrosLab |
| `https://sso.kayroslab.com` | Authelia — Universal Login, comptes, OIDC |

## DNS

`sso.kayroslab.com` → **A** → `51.210.9.71`

Puis workflow **Setup SSL - sso.kayroslab.com**.

## Compte initial

Au premier déploiement : `/opt/kayroslab/data/authelia/INITIAL_PASSWORD.txt` (utilisateur `kayros`, e-mail `contact@kayroslab.com`). Autres comptes : éditer `users.yml` puis `docker compose -f deploy/ovh-vps/authelia.compose.yaml restart`.

## Autre IdP (Keycloak, Dex, Authentik…)

Renseigner `OIDC_ISSUER` et `OIDC_CLIENT_ID` dans `.env`. Le backend suit `.well-known/openid-configuration`.
