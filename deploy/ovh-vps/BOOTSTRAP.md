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
| Données | PostgreSQL | fichiers JSON dans `/opt/kayroslab/data` |

**Aucun conflit** : ports, dossiers, noms PM2 et serveurs nginx sont distincts. Node, PM2, nginx et certbot sont déjà installés par le bootstrap openDPE — rien à réinstaller.

## Étapes (une seule fois, en SSH root)

```bash
# 1. Cloner le dépôt
git clone https://github.com/Geoking2104/KayrosLab.git /opt/kayroslab
git config --global --add safe.directory /opt/kayroslab

# 2. Configurer l'environnement
cd /opt/kayroslab/backend/fastify
cp .env.sample .env
nano .env
```

Renseigner au minimum :

```bash
PORT=8787
KAYROS_AUTH_SECRET=            # laisser vide : généré au 1er déploiement
ANTHROPIC_API_KEY=sk-ant-...
ALLOWED_ORIGIN=https://www.kayroslab.com
KAYROS_USERS_FILE=/opt/kayroslab/data/users.json
KAYROS_IDEAS_FILE=/opt/kayroslab/data/ideas.json
KAYROS_GATES_FILE=/opt/kayroslab/data/gates.json
```

```bash
# 3. Premier déploiement
cd /opt/kayroslab
bash deploy/ovh-vps/deploy-backend.sh
```

## Ensuite, tout est automatique

| Action | Déclencheur |
|---|---|
| Déploiement | Push sur `main` touchant `backend/fastify/`, `core/` ou `deploy/` |
| HTTPS | Workflow `setup-ssl-vps.yml`, à lancer une fois le DNS en place |

## DNS requis

`api.kayroslab.com` → **A** → `51.210.9.71`

> ⚠️ À ajouter chez IONOS. Le domaine `www.kayroslab.com` pointe vers GitHub Pages
> (site vitrine) ; seul le sous-domaine `api` vise le VPS.

## Sauvegarde automatique (cron)

Les données JSON (comptes, idées, gates) sont dans `/opt/kayroslab/data`. Ajouter une sauvegarde
quotidienne dans la crontab :

```bash
crontab -e
# Ajouter la ligne :
0 3 * * * /opt/kayroslab/deploy/ovh-vps/backup-data.sh >> /var/log/kayros-backup.log 2>&1
```

## Métriques Prometheus

Le backend expose un endpoint `/metrics` au format Prometheus. Configurer un scrape dans
`/etc/prometheus/prometheus.yml` :

```yaml
scrape_configs:
  - job_name: 'kayroslab'
    static_configs:
      - targets: ['127.0.0.1:8787']
```

## Vérifications

```bash
pm2 status                          # kayros-api en ligne
pm2 logs kayros-api --lines 30
curl http://127.0.0.1:8787/health   # local
curl -I https://api.kayroslab.com/health
```

## Sécurité

- `/opt/kayroslab/data` en `0700`, `users.json` en `0600` : empreintes de mots de passe.
- Sans `KAYROS_AUTH_SECRET`, les routes protégées répondent **503** — jamais ouvertes.
- Le script **interrompt le déploiement si les tests du cœur échouent**.
