# Bootstrap KayrosLab sur le VPS OVH (mutualisé avec openDPE)

> VPS `51.210.9.71` / `vps-088d27a3.vps.ovh.net`. **openDPE y tourne déjà** : ce guide
> reprend ses conventions pour cohabiter sans rien casser.

## Cohabitation avec openDPE

| | openDPE | KayrosLab |
|---|---|---|
| Dossier | `/opt/opendpe` | `/opt/kayroslab` |
| Port backend | **8080** | **8787** |
| Process PM2 | `opendpe-backend` | `kayros-api` |
| nginx | `opendpe.net`, `api.opendpe.net` | `api.kayroslab.com` |
| Données | PostgreSQL | JSON `/opt/kayroslab/data` **ou** Postgres (`DATABASE_URL`) |

**Aucun conflit** : ports, dossiers, noms PM2 et serveurs nginx sont distincts.

## Étapes (une seule fois, en SSH root)

```bash
git clone https://github.com/Geoking2104/KayrosLab.git /opt/kayroslab
git config --global --add safe.directory /opt/kayroslab

cd /opt/kayroslab/backend/fastify
cp .env.sample .env
nano .env
```

Minimum :

```bash
PORT=8787
KAYROS_AUTH_SECRET=
ALLOWED_ORIGIN=https://www.kayroslab.com
KAYROS_USERS_FILE=/opt/kayroslab/data/users.json
KAYROS_IDEAS_FILE=/opt/kayroslab/data/ideas.json
KAYROS_GATES_FILE=/opt/kayroslab/data/gates.json
```

### Postgres optionnel (recommandé multi-instance)

```bash
# schéma
export DATABASE_URL='postgres://kayros:SECRET@127.0.0.1:5432/kayroslab'
psql "$DATABASE_URL" -f /opt/kayroslab/core/sql/schema.sql

cd /opt/kayroslab/backend/fastify
npm install pg --save
# ajouter DATABASE_URL=... dans .env
```

```bash
cd /opt/kayroslab
bash deploy/ovh-vps/deploy-backend.sh
```

## Sauvegardes (cron)

Deux scripts :

| Script | Contenu |
|--------|--------|
| `backup-data.sh` | tar.gz du dossier `data/` **+** appelle `backup-pg.sh` si dispo |
| `backup-pg.sh` | `pg_dump \| gzip` → `kayros-pg-YYYYMMDD-HHMMSS.sql.gz` |

```bash
chmod +x /opt/kayroslab/deploy/ovh-vps/backup-data.sh \
         /opt/kayroslab/deploy/ovh-vps/backup-pg.sh

# test manuel
bash /opt/kayroslab/deploy/ovh-vps/backup-data.sh

# cron quotidien 03:00
crontab -e
# 0 3 * * * /opt/kayroslab/deploy/ovh-vps/backup-data.sh >> /var/log/kayros-backup.log 2>&1
```

Variables optionnelles :

```bash
BACKUP_DIR=/opt/kayroslab/backups   # défaut
RETENTION_DAYS=30                   # défaut
DATABASE_URL=postgres://...         # ou lu depuis backend/fastify/.env
```

### Restauration Postgres

```bash
gunzip -c /opt/kayroslab/backups/kayros-pg-YYYYMMDD-HHMMSS.sql.gz \
  | psql "$DATABASE_URL"
```

### Restauration JSON

```bash
tar -xzf /opt/kayroslab/backups/kayros-data-YYYYMMDD-HHMMSS.tar.gz -C /opt/kayroslab/
```

## DNS

`api.kayroslab.com` → **A** → `51.210.9.71`

## Vérifications

```bash
pm2 status
pm2 logs kayros-api --lines 30
curl http://127.0.0.1:8787/health
ls -lh /opt/kayroslab/backups/
```
