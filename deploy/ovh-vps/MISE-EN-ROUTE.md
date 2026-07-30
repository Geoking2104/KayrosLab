# Mise en route — PostgreSQL sur le VPS OVH

> VPS `vps-OpenDPE.vps.ovh.net` · `51.210.9.71` · Strasbourg · VPS-1 2026, 4 vCores, 8 Go
> **openDPE tourne dessus en production.** Rien de ce qui suit ne le touche.

## Pourquoi passer par GitHub Actions

Le provisionnement demande un accès root au VPS. Le faire depuis GitHub Actions présente trois avantages sur une connexion manuelle :

- **aucun secret ne transite par un tiers** — la clé SSH reste dans les secrets du dépôt et sur le runner, effacée en fin de job ;
- **tout est tracé** — qui a déclenché, quand, avec quelle sortie ;
- **le chemin est rejouable** — la même mécanique sert ensuite aux migrations.

## Secrets à configurer (une fois)

`Settings → Secrets and variables → Actions → New repository secret`

| Secret | Valeur | Déjà utilisé par |
|---|---|---|
| `VPS_SSH_USER` | l'utilisateur SSH ayant `sudo` (souvent `root` ou `ubuntu`) | `deploy-vps-backend.yml` |
| `VPS_SSH_KEY` | la **clé privée** dont la publique est dans `~/.ssh/authorized_keys` du VPS | `deploy-vps-backend.yml` |

Ces deux secrets sont ceux que votre `BOOTSTRAP.md` mentionne déjà : s'ils sont configurés pour le déploiement du backend, il n'y a rien à faire.

## Étape 1 — Diagnostic (aucune modification)

`Actions → PostgreSQL VPS — diagnostic & provisionnement → Run workflow`, mode **`diagnostic`**.

Ne provisionnez pas un serveur de production à l'aveugle. Cette exécution est en lecture seule et répond aux questions qui conditionnent la suite :

- PostgreSQL est-il **système ou Docker** ? Le script s'adapte, mais autant le savoir.
- Sur quelles interfaces **écoute-t-il** ? S'il écoute sur `*`, vérifier que le pare-feu bloque 5432.
- Quelles **bases** existent déjà, et sous quels rôles ? C'est le voisinage d'openDPE.
- `/opt/kayroslab` est-il **à jour**, `.env` présent ?
- openDPE et `kayros-api` **répondent-ils** ?

Lisez la sortie avant d'aller plus loin. Si quelque chose surprend, on ajuste le script plutôt que de forcer.

## Étape 2 — Provisionnement

Même workflow, mode **`provision`**, confirmation **`PROVISIONNER`**.

Enchaînement :

1. sauvegarde de la base `kayroslab` si elle existe ;
2. mise à jour du dépôt sur le VPS ;
3. `provision-postgres.sh` — rôle et base dédiés, cloisonnement, migration, sauvegarde quotidienne ;
4. `verify-postgres.sh` — **27 vérifications** contre le serveur réel ;
5. redémarrage de `kayros-api` ;
6. **contrôle qu'openDPE est toujours en ligne** — le job échoue sinon.

Le mot de passe est généré **sur le VPS** et écrit dans `.env` en `chmod 600`. Il n'apparaît ni dans les journaux du workflow, ni dans le dépôt, ni dans un historique de shell.

## Vérifier après coup

```
pm2 logs kayros-api --lines 20 | grep '\[canvas\]'
# [canvas] persistance : postgres (kayroslab, PostgreSQL 16.x)
```

Si la ligne indique `fichiers`, le `.env` n'a pas été rechargé : `pm2 restart kayros-api --update-env`.

## Ce que le workflow ne fait pas

- Il **n'ouvre jamais 5432** sur Internet. Le backend est sur la même machine.
- Il **ne touche pas** aux bases, rôles ni configuration d'openDPE.
- Il **ne supprime rien**. L'effacement passe par `repo.purge()`, qui exige un motif.

## Si ça se passe mal

Le provisionnement est idempotent : on le relance. En cas de doute sur la base :

```
sudo -u postgres pg_restore -d kayroslab --clean --if-exists \
  /opt/kayroslab/data/backups/pre-provision-AAAAMMJJ-HHMMSS.dump
```

> Cette restauration n'a **jamais été testée en conditions réelles**. Une sauvegarde dont on n'a jamais éprouvé la restauration n'est pas une sauvegarde. À valider une fois sur une base jetable — c'est le dernier trou connu de la chaîne.

## Note de calendrier

OVH annonce dans le manager un **correctif de sécurité sur les VPS**, avec une interruption de moins de 30 minutes. Si elle survient pendant le provisionnement, relancez simplement le workflow : rien n'est laissé à moitié fait, chaque étape est idempotente.
