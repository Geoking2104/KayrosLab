# Jetons OAuth X — Salon

## Quoi

Un hôte lié = un fichier `KAYROS_SALON_X_DIR/<userKey>.x.json` mode `0600`.

Dedans :
- `handle`, `xUserId`, `scopes`, `engagement`, `linkedAt`
- `accessSealed` / `refreshSealed` : AES-256-GCM (`X_TOKEN_SECRET` ou `KAYROS_AUTH_SECRET`)
- jamais de jeton en clair dans les réponses HTTP (`publicBinding`)

PKCE `state` + `verifier` vivent **en mémoire** 15 min (`putPending` / `takePending`). Un redémarrage pendant le consentement X casse le callback : relancer **Lier X**.

## Cycle

| Événement | Action |
|---|---|
| Lier X | `POST /v1/salon/x/oauth/start` → x.com → `POST .../callback` → scelle access + refresh |
| Lire l'état | `GET /v1/salon/x/binding` → `{ handle, engagement }` seulement |
| Engagement | `PATCH` `{ engagement: off \| prepare \| autopost_mentions }` |
| Délier | `DELETE /v1/salon/x/binding` → `revoke` du refresh côté X + fichier vidé |
| Publier | access déscellé le temps de l'appel ; 45 s ; @mention obligatoire |

Access X ~ 2 h. Refresh ~ 6 mois si `offline.access`. Sans refresh réussi : l'hôte relie.

## Rotation

**Client Secret X** (fuite ou régénération console.x.com) :
1. Nouveau secret → `X_CLIENT_SECRET` sur le VPS
2. Restart API
3. Chaque hôte **Délie** puis **Lie** (les refresh émis avec l'ancien secret restent valides jusqu'à révocation X)

**Sceau local `X_TOKEN_SECRET`** : changer la valeur rend tous les `*.x.json` illisibles. Avant : `DELETE` binding pour chaque hôte, ou supprimer le répertoire `KAYROS_SALON_X_DIR`, puis faire relier.

**App X révoquée** dans la console : les fichiers restent ; `GET binding` montre encore le handle jusqu'au prochain appel X (401). Purger le dir.

## Exploitation VPS

```bash
# secrets (ne pas committer)
install -d -m 700 /var/lib/kayros/salon-x
# dans l'unit systemd / .env :
# X_CLIENT_ID=...
# X_CLIENT_SECRET=...
# X_TOKEN_SECRET=$(openssl rand -hex 32)
# X_OAUTH_REDIRECT=https://www.kayroslab.com/salon/flux/callback/
# KAYROS_SALON_X_DIR=/var/lib/kayros/salon-x

ls -l /var/lib/kayros/salon-x          # un fichier par hôte
# révoquer un hôte à la main :
rm -f /var/lib/kayros/salon-x/<userKey>.x.json
```

Ne jamais `cat` ces JSON en ticket ou en log : même scellés, ce sont des secrets.
