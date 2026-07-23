# KayrosLab — Runbook opérationnel

## Architecture

```
Domaine        → api.kayroslab.com (443)
                      ↓ (nginx reverse proxy)
VPS OVH        → 51.210.9.71
Process PM2    → kayros-api (port 8787 interne)
Données        → /opt/kayroslab/data/*.json
Backups        → /opt/kayroslab/backups/
```

## Démarrage

### Premier déploiement (VPS nu)

```bash
ssh root@51.210.9.71
git clone https://github.com/Geoking2104/KayrosLab.git /opt/kayroslab
cd /opt/kayroslab/backend/fastify
cp .env.sample .env
nano .env    # renseigner ANTHROPIC_API_KEY, KAYROS_AUTH_SECRET, etc.
cd /opt/kayroslab
bash deploy/ovh-vps/deploy-backend.sh
```

### Redémarrage du service

```bash
pm2 restart kayros-api
pm2 logs kayros-api --lines 30
```

### Rechargement nginx

```bash
nginx -t && systemctl reload nginx
```

## Mise à jour

Via GitHub Actions (push sur `main` touchant `backend/fastify/`, `core/` ou `deploy/`) :

```bash
# Ou manuellement :
cd /opt/kayroslab
git pull origin main
find deploy/ovh-vps -name "*.sh" -exec sed -i 's/\r$//' {} \;
bash deploy/ovh-vps/deploy-backend.sh
```

## Sauvegarde

### Automatique (cron)

```
0 3 * * * /opt/kayroslab/deploy/ovh-vps/backup-data.sh >> /var/log/kayros-backup.log 2>&1
```

### Restauration

```bash
# Lister les sauvegardes
ls -lh /opt/kayroslab/backups/

# Restaurer la plus récente
RESTORE=/opt/kayroslab/backups/kayros-data-$(date +%Y%m%d)*.tar.gz
tar -xzf "$RESTORE" -C /opt/kayroslab
pm2 restart kayros-api
```

## Surveillance

### Healthcheck

```bash
curl https://api.kayroslab.com/health
# Réponse : {"ok":true,"providers":["mock","anthropic","ollama"],...}
```

### Métriques Prometheus

```bash
curl https://api.kayroslab.com/metrics
# Exposition au format Prometheus : http_request_duration_seconds, etc.
```

### Logs

```bash
pm2 logs kayros-api --lines 50
tail -f /var/log/pm2/kayros-api-*.log
```

### Vérifications post-déploiement

```bash
curl -fsS http://127.0.0.1:8787/health && echo " health OK"
curl -fsS https://api.kayroslab.com/health && echo " public OK"
pm2 status | grep kayros-api
```

## Dépannage

### Le backend répond 503

Cause : `KAYROS_AUTH_SECRET` absent — les routes protégées sont désactivées.
Solution : définir la variable dans `.env`, redémarrer.

### Les notifications email ne partent pas

Cause : `nodemailer` non installé ou `KAYROS_SMTP_URL` invalide.
Vérifier :
```bash
# Tester le transport SMTP
node -e "const {createTransport}=await import('nodemailer'); const t=createTransport('$KAYROS_SMTP_URL'); console.log(await t.verify())"
```

### Rate limit atteint (429)

Le backend limite à 100 req/min par IP. Si dépassé, attendre 60s.
Pour les tests, désactiver temporairement via `DISABLE_RATE_LIMIT=1` (non recommandé en prod).

### Données corrompues

```bash
# Restaurer la dernière sauvegarde
cd /opt/kayroslab
cp backups/kayros-data-*.tar.gz /tmp/
tar -xzf /tmp/kayros-data-*.tar.gz
pm2 restart kayros-api
```

### Actions d'urgence

| Problème | Action |
|----------|--------|
| Process crash | `pm2 restart kayros-api && pm2 logs` |
| OOM (8 Go RAM) | Vérifier Ollama (`ollama stop`), redémarrer PM2 avec `--max-memory-restart 6G` |
| Erreur TLS | `certbot renew --dry-run` puis `systemctl reload nginx` |
| Fuite DNS | Vérifier `api.kayroslab.com` → A → `51.210.9.71` chez IONOS |

## Références

| Fichier | Rôle |
|---------|------|
| `backend/fastify/.env` | Configuration sensible (hors git) |
| `deploy/ovh-vps/nginx-kayroslab-api.conf` | Reverse proxy nginx |
| `deploy/ovh-vps/deploy-backend.sh` | Script de déploiement |
| `deploy/ovh-vps/backup-data.sh` | Sauvegarde des données |
| `deploy/ovh-vps/BOOTSTRAP.md` | Procédure d'installation initiale |
| `backend/fastify/DEPLOY-VPS.md` | Documentation déploiement détaillée |
