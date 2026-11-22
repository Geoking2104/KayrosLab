
## 9 ter. Limites corrigées (second lot)

| Limite | Correction | Preuve |
| --- | --- | --- |
| Deux onglets s'écrasaient (« dernier arrivé gagne ») | `POST /v1/salon/room` accepte `baseUpdatedAt` + `intent` ; en cas de conflit, `mergeRooms` fait l'union des convives et des tours (dédoublonnage auteur+texte, ordre chronologique). `intent: 'replace'` reste réservé aux actions destructives (recommencer, retirer un convive, nouvelle question). | Live : onglet A écrit 1 tour, onglet B écrit sans avoir lu ? `merged: true`, 2 tours, 3 convives ; un `replace` remet bien la table à zéro. 9 tests unitaires (`tests/salon-room-merge.test.mjs`). |
| `/health` annonçait `nvidia` alors que les répliques venaient de Mistral | Registre runtime `llmRuntimeSnapshot()` alimenté à chaque complétion : `effective`, `effectiveAt`, `lastFallback {from,to,error}`. `/health` expose ces champs à côté du fournisseur configuré. | Live : `provider: nvidia`, `effective: mistral`, `lastFallback: {from: nvidia, to: mistral, error: "nvidia http 410"}`. |
| Citations rejetées à cause de la ponctuation française | `canonical` neutralise l'espace avant `; : ! ? .` ; la vérification vit dans `backend/fastify/lib/salon-quotes.mjs` et est testée seule. | Cas réel Candide (« en enrageant ; car » vs « enrageant; car ») : citation acceptée au lieu du repli. 6 tests (`tests/salon-quotes.test.mjs`). |

### Le 410 NVIDIA est réel

Le health corrigé le montre : le modèle primaire répond `410 Gone`, et chaque
réplique paie d'abord cet échec avant de basculer sur Mistral. Deux corrections
possibles, toutes deux côté configuration (aucun code à changer) :

1. `LLM_PROVIDER=mistral` dans les variables du dépôt — plus d'appel perdu ;
2. ou `NVIDIA_MODEL` avec un modèle encore servi par `integrate.api.nvidia.com`.

Tant que ce n'est pas fait, `lastFallback` restera renseigné : c'est le signal,
pas une panne silencieuse.

### Défaut de CI corrigé au passage

`tests/www-nginx-deploy.test.mjs` interdisait au workflow VPS de se déclencher
sur `backend/web/public/salon/**`, alors qu'un commit antérieur (18:17) venait
d'ajouter ces chemins pour garder le miroir VPS à jour. Le test exprimait une
intention devenue obsolète : il vérifie désormais la présence de ces chemins,
avec le commentaire correspondant. `Site tests` est repassé au vert.

*Note d'environnement : sous Windows, le test `assemble-www` échoue car `bash`
pointe sur WSL, qui ne reçoit pas `APP_DIR` (chemin Windows). Le script a été
validé dans WSL avec des chemins convertis : `app.js?v=50e3fee0`.*
