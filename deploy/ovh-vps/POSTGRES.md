# PostgreSQL sur le VPS OVH — cohabitation avec openDPE

> VPS `51.210.9.71`. **openDPE y fait déjà tourner PostgreSQL.** Ce guide adosse
> une base KayrosLab à cette instance sans rien changer pour openDPE.

## Principes

| Décision | Raison |
|---|---|
| **Ne pas réinstaller PostgreSQL** | Le service est en production pour openDPE. On s'y adosse, on ne le remplace pas. |
| **Base et rôle dédiés**, pas un schéma dans la base d'openDPE | Une base partagée signifie une sauvegarde partagée, une restauration partagée et un incident partagé. |
| **`NOSUPERUSER NOCREATEDB NOCREATEROLE`** | Un rôle applicatif n'a aucune raison de créer des bases. Moindre privilège. |
| **`REVOKE ALL ... FROM PUBLIC`** | Par défaut, tout rôle de l'instance peut se connecter à une base neuve. openDPE et KayrosLab partagent une instance, jamais leurs données. |
| **5432 jamais exposé sur Internet** | Le backend est sur la même machine : il se connecte en `127.0.0.1`. Ouvrir le port transformerait une base interne en surface d'attaque publique, sans aucun gain. |
| **Mot de passe généré sur la machine** | Il n'est ni saisi, ni transmis, ni présent dans un dépôt ou un historique de shell. Il n'existe que dans `.env` (chmod 600). |

## Installation

```bash
ssh root@51.210.9.71
cd /opt/kayroslab && git pull
bash deploy/ovh-vps/provision-postgres.sh     # idempotent
bash deploy/ovh-vps/verify-postgres.sh        # 27 vérifications
pm2 restart kayros-api
```

Le script détecte PostgreSQL en mode système **ou** Docker, et ne l'installe que s'il est réellement absent.

## Vérifier la bascule

```bash
pm2 logs kayros-api --lines 20 | grep '\[canvas\]'
# [canvas] persistance : postgres (kayroslab, PostgreSQL 16.x)
```

Sans `DATABASE_URL`, le backend repart en mode fichiers — aucune panne, mais aucun partage multi-instance non plus.

## Ce que la recette vérifie

`verify-postgres.sh` lance `tests/recette-vps.mjs` : **27 vérifications** contre le serveur réel — cloisonnement vis-à-vis d'openDPE, absence d'accès croisé aux bases voisines, privilèges du rôle, trigger append-only actif, contrainte `CHECK` d'EF-243, index GIN et plein texte français, parcours HTTP complet, journal rejoué depuis la base, identité agent persistée.

Elle est **non destructive** : tout ce qu'elle crée est préfixé `recette-` et purgé en fin de parcours.

Avant de la lancer sur le serveur, on peut la valider à vide :

```bash
node backend/fastify/tests/recette-vps.mjs --embarque   # 22 vérifications contre PGlite
```

Les 5 contrôles de cloisonnement y sont annoncés comme non significatifs : un moteur embarqué tourne toujours en superutilisateur.

## Migrations ultérieures

Workflow **`migrate-vps-postgres.yml`**, déclenchement **manuel** avec confirmation explicite. Une migration de schéma sur une instance partagée avec openDPE ne doit pas partir sur un simple push. Le workflow sauvegarde avant d'appliquer, lance la recette, puis vérifie qu'openDPE est toujours en ligne.

## Sauvegardes

`provision-postgres.sh` installe `/etc/cron.daily/kayroslab-pgdump` — dump quotidien au format `custom`, rétention 14 jours, dans `/opt/kayroslab/data/backups`.

Restauration :

```bash
sudo -u postgres pg_restore -d kayroslab --clean --if-exists \
  /opt/kayroslab/data/backups/kayroslab-AAAAMMJJ.dump
```

> **Non testé en conditions réelles.** Une sauvegarde dont la restauration n'a jamais été essayée n'est pas une sauvegarde. À valider une fois sur une base jetable.

## Effacement de données

`canvas_event` est append-only par trigger : un `DELETE` ordinaire échoue, et le `ON DELETE CASCADE` d'un canvas aussi. Pour un effacement légitime (demande RGPD), la purge est délibérée :

```js
await repo.purge(workspaceId, { motif: 'demande d\'effacement — ticket #123', par: 'geoffroy' });
```

Elle exige un motif et s'inscrit dans `canvas_purge_log` : l'effacement lui-même laisse une trace.

## En cas de problème

| Symptôme | Cause probable |
|---|---|
| `[canvas] persistance : fichiers` alors que `DATABASE_URL` est défini | `.env` non rechargé — `pm2 restart kayros-api --update-env` |
| `ECONNREFUSED` au démarrage | PostgreSQL arrêté, ou `listen_addresses` sans `127.0.0.1` |
| `permission denied for schema public` | Migration appliquée en `postgres` sans `ALTER TABLE ... OWNER TO kayroslab` — relancer le provisionnement |
| La recette signale un accès croisé | `REVOKE CONNECT ON DATABASE <base_opendpe> FROM kayroslab;` |
