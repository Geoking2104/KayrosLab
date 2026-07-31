# Runbook — mise en service sur le VPS OVH

> `vps-OpenDPE` · `51.210.9.71` · **openDPE tourne dessus en production.**
> Rien ici ne touche à ses bases, ses rôles ni sa configuration.

Quatre étapes, en SSH root. Chacune est idempotente : relançable sans dommage.

---

## 1. PostgreSQL, schéma, pilote et `DATABASE_URL`

```bash
cd /opt/kayroslab && git fetch origin && git checkout feat/canvas-ideation && git pull
bash deploy/ovh-vps/provision-postgres.sh
```

Le script détecte PostgreSQL (système **ou** Docker) et ne l'installe que s'il est réellement absent. Il crée le rôle `kayroslab` en `NOSUPERUSER NOCREATEDB NOCREATEROLE`, la base éponyme, révoque `PUBLIC`, applique la migration, et écrit `DATABASE_URL` dans `.env` en `chmod 600`.

**Le mot de passe est généré sur la machine** : il n'apparaît ni à l'écran, ni dans le dépôt, ni dans l'historique du shell.

Puis le pilote et le redémarrage :

```bash
cd /opt/kayroslab/backend/fastify
npm install --omit=dev
pm2 restart kayros-api --update-env
pm2 logs kayros-api --lines 20 --nostream | grep '\[canvas\]'
```

Attendu :

```
[canvas] persistance : postgres (kayroslab, PostgreSQL 16.x)
```

Si la ligne dit `fichiers`, le `.env` n'a pas été relu — refaites le `restart` avec `--update-env`.

### Vérifier

```bash
bash deploy/ovh-vps/verify-postgres.sh    # 27 vérifications
```

Elle contrôle notamment qu'aucun **accès croisé** ne subsiste vers les bases d'openDPE. Si elle en signale un :

```sql
REVOKE CONNECT ON DATABASE <base_opendpe> FROM kayroslab;
```

---

## 2. Droits d'exécution des scripts

```bash
cd /opt/kayroslab && git pull
chmod +x deploy/ovh-vps/*.sh
ls -l deploy/ovh-vps/*.sh
```

Git ne conserve le bit exécutable que s'il a été committé ainsi — d'où ce `chmod` explicite après chaque `pull`.

---

## 3. Cron de sauvegarde

**Un seul mécanisme.** `backup-data.sh` sauvegarde désormais les JSON **et** la base PostgreSQL, dans le même répertoire, avec la même rétention. Le provisionnement ne crée plus de cron concurrent — deux dispositifs finissent toujours par diverger, et on découvre lequel tournait le jour où l'on restaure.

```bash
(crontab -l 2>/dev/null | grep -v backup-data.sh; \
 echo '0 3 * * * /opt/kayroslab/deploy/ovh-vps/backup-data.sh >> /var/log/kayros-backup.log 2>&1') | crontab -
crontab -l | grep backup
```

Le `grep -v` d'abord évite d'empiler des lignes en double à chaque exécution.

---

## 4. Test de la sauvegarde

Deux temps : produire, puis **éprouver**.

```bash
bash deploy/ovh-vps/backup-data.sh
ls -lh /opt/kayroslab/backups/ | tail -4
```

Attendu : une archive `kayros-data-*.tar.gz` **et** un dump `kayros-db-*.dump`.

```bash
bash deploy/ovh-vps/test-restauration.sh
```

Ce script restaure le dernier dump dans une base **jetable**, compare les comptes de lignes à la production, vérifie que le trigger append-only, la contrainte `CHECK` d'EF-243 et les index ont survécu, contrôle que le **chaînage du journal** est intact, puis supprime la base de test. La production n'est jamais touchée.

Attendu :

```
RESTAURATION VALIDEE — la sauvegarde est exploitable.
```

> C'est l'étape qui lève la dernière réserve du projet. Une sauvegarde dont la restauration n'a jamais été essayée n'est pas une sauvegarde : c'est un fichier dont on espère qu'il servira. Tant que ce script n'est pas passé au vert, considérez que vous n'avez pas de sauvegarde.

### Restauration réelle, le jour venu

```bash
pm2 stop kayros-api
sudo -u postgres pg_restore -d kayroslab --clean --if-exists \
  /opt/kayroslab/backups/kayros-db-AAAAMMJJ-HHMMSS.dump
pm2 start kayros-api
```

---

## Récapitulatif

| # | Commande | Vérification |
|---|---|---|
| 1 | `provision-postgres.sh` puis `npm install --omit=dev` | `[canvas] persistance : postgres` |
| 2 | `chmod +x deploy/ovh-vps/*.sh` | `ls -l` montre `rwx` |
| 3 | cron `0 3 * * *` | `crontab -l \| grep backup` |
| 4 | `backup-data.sh` puis `test-restauration.sh` | `RESTAURATION VALIDEE` |

## Si openDPE bronche

Aucune étape ne le touche, mais en cas de doute :

```bash
pm2 status
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/
```

`kayros-api` (8787) et `opendpe-backend` (8080) sont indépendants : arrêter l'un n'affecte pas l'autre.
