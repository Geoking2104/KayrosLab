# KayrosLab — Runbook opérationnel

## Architecture

```
Domaine        → api.kayroslab.com (443)     www.kayroslab.com (80/443)
                      ↓ nginx                      ↓ nginx (fichiers)
VPS OVH        → 51.210.9.71
Process PM2    → kayros-api (port 8787 interne)
Site statique  → /var/www/kayroslab  (accueil, /salon/, /console/)
SSO (OIDC)     → Authelia 127.0.0.1:9091  (sso.kayroslab.com)
Données        → /opt/kayroslab/data/*.json
Salon          → /opt/kayroslab/data/salon/<user>.json
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

### Ollama local et embeddings multilingues

Le workflow backend appelle `deploy/ovh-vps/install-ollama.sh` avant le
redémarrage de l'API. Le script est idempotent, installe `bge-m3`, force
`OLLAMA_HOST=127.0.0.1:11434` dans systemd et refuse le déploiement si le port
11434 écoute sur une interface publique.

`/v1/embed` exige une session KayrosLab, applique une limite dédiée et n'accepte
plus de modèle fourni par le client. Le modèle est fixé côté serveur par
`EMBED_MODEL=bge-m3`.

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

`/metrics` n'est plus public : sans `METRICS_TOKEN`, il n'accepte que le
loopback direct (le Prometheus local) et répond 403 à travers nginx.

```bash
# Sur le VPS
curl -s http://127.0.0.1:8787/metrics | grep '^kayros_'
# Depuis l'extérieur, seulement si METRICS_TOKEN est défini (secret GitHub)
curl -H "Authorization: Bearer $METRICS_TOKEN" https://api.kayroslab.com/metrics
```

Métriques applicatives (`backend/fastify/lib/metrics.mjs`, aucun label
personnel ni secret) : `kayros_llm_calls_total{provider,model,outcome}`
(429 = `rate_limited`, `timeout`…), `kayros_llm_fallbacks_total{from,to}`
(replis `llm_degraded`, dont vers `mock`), `kayros_llm_requests_total`,
`kayros_llm_primary_info`, `kayros_console_runs_total{kind,outcome}`,
`kayros_console_run_duration_seconds`, `kayros_console_runs_in_progress`,
`kayros_console_run_oldest_running_seconds`,
`kayros_console_runs_interrupted_total`, plus `http_request_duration_seconds`
et les métriques process/Node.js.

### Supervision et alertes (Prometheus + Alertmanager)

Pile mono-nœud dans `monitoring/` (installation, secrets, choix d'architecture :
`monitoring/README.md`). Tout écoute sur 127.0.0.1 ; accès par tunnel SSH.

```bash
cd /opt/kayroslab/monitoring
docker compose ps                                  # prometheus, alertmanager, blackbox (+ grafana)
docker compose logs --tail 50 alertmanager
curl -s http://127.0.0.1:9093/api/v2/alerts | head -c 2000   # alertes actives
curl -XPOST http://127.0.0.1:9090/-/reload         # après modification des règles
curl -XPOST http://127.0.0.1:9093/-/reload         # après modification d'alertmanager.yml
```

- `critical` → Slack #devops-critical, `warning` → Slack #devops-warnings.
- Le déploiement GitHub Actions pose un silence de 15 min autour du
  redémarrage pm2 (`monitoring/alertmanager-silence.sh`, sans effet si
  Alertmanager est absent).
- Maintenance manuelle :
  `DURATION_MINUTES=60 monitoring/alertmanager-silence.sh start` … `stop`.

| Alerte | Premier réflexe |
|--------|-----------------|
| `KayrosApiDown` / `KayrosHealthCheckFailing` | `pm2 status`, `pm2 logs kayros-api --lines 100`, `curl -fsS http://127.0.0.1:8787/health` ; si seule l'URL publique échoue : `nginx -t`, certificat |
| `KayrosLlmDegradedToMock` / `KayrosLlmMostlyMock` | `curl -s http://127.0.0.1:8787/health` (bloc `llm`), quotas NVIDIA/Mistral, `pm2 logs kayros-api \| grep -i llm` |
| `KayrosLlmPrimaryIsMock` | secrets `NVIDIA_API_KEY` / `MISTRAL_API_KEY` absents : vérifier les secrets GitHub et relancer le déploiement |
| `KayrosLlmRateLimited` | baisser la variable de dépôt `LLM_MAX_CONCURRENCY`, vérifier le quota |
| `KayrosConsoleRunStuck` | vérifier `KAYROS_CONSOLE_RUN_TIMEOUT_MS` (0 = aucun délai) ; un `pm2 restart` passe la mission `failed` |
| `KayrosConsoleRunsInterruptedAtStartup` | redémarrage pendant une mission (déploiement, crash, limite mémoire pm2 400 Mo) |
| `KayrosApiMemoryHigh` / `KayrosApiRestartLoop` | `pm2 describe kayros-api`, mémoire de l'hôte (`free -m`, Ollama) |

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

## Intégrations (API publique v1, webhooks, file de missions)

Surface utilisée par n8n, Zapier et Salesforce. Guide utilisateur : `integrations/n8n/README.md` (PoC en 15 minutes).

| Élément | Où |
|---------|-----|
| Référence lisible | https://api.kayroslab.com/docs |
| Spécification OpenAPI 3.1 | https://api.kayroslab.com/v1/public/openapi.json (source : `docs/openapi/kayroslab-public-v1.json`) |
| Routes | `GET /v1/public/me`, `GET /v1/public/collectives`, `POST /v1/public/missions`, `GET /v1/public/missions/:id`, `GET /v1/public/missions?external_ref=` |
| Administration | Console → **Intégrations** (rôle comex) : clés d’API, URL et secret du webhook, test, livraisons |

### Variables d’environnement

| Variable | Défaut | Effet |
|----------|--------|-------|
| `NVIDIA_FAST_MODEL` | `nvidia/nemotron-3.5-lightning-30b-a3b` | Modèle du profil `fast` (variable de dépôt GitHub, optionnelle) |
| `KAYROS_CONNECTOR_ENCRYPTION_KEY` | — | Chiffre au repos le secret de signature des webhooks (sinon stocké en clair, avertissement au démarrage) |
| `KAYROS_PUBLIC_RATE_LIMIT` | `60` | Requêtes/min par clé d’API |
| `KAYROS_PUBLIC_MISSIONS_PER_DAY` | `200` | Missions/jour par tenant (429 au-delà) |
| `KAYROS_MISSION_QUEUE` | actif si Postgres | `off` = exécution dans le processus (pas de reprise après crash) |
| `KAYROS_MISSION_CONCURRENCY` / `KAYROS_MISSION_LEASE_MS` | `2` / `120000` | Missions simultanées par processus / bail avant reprise |
| `KAYROS_WEBHOOK_INTERVAL_MS` | `5000` | Fréquence de la boîte d’envoi des webhooks |
| `KAYROS_INTEGRATION_WORKERS` | actif | `off` = ni worker ni envoi de webhooks (tests) |

### Vérifier

```bash
curl -fsS https://api.kayroslab.com/v1/public/openapi.json | head -c 120; echo
curl -s https://api.kayroslab.com/v1/public/me -H "Authorization: Bearer $KAYROS_API_KEY"
# Mission de démonstration (< 5 s, aucun appel LLM)
curl -s https://api.kayroslab.com/v1/public/missions -H "Authorization: Bearer $KAYROS_API_KEY" \
  -H "Idempotency-Key: runbook-$(date +%s)" -H 'Content-Type: application/json' \
  -d '{"collective_id":"room_…","question":"Test runbook","profile":"demo"}'
```

### File de missions et webhooks (Postgres)

```sql
-- Missions en file / en cours / échouées (reprise automatique après crash à l’expiration du bail)
select status, count(*) from kayros_mission_jobs group by 1;
select job_id, thread_id, attempts, locked_by, lease_until, last_error from kayros_mission_jobs where status <> 'done' order by created_at desc limit 20;
-- Webhooks en attente ou abandonnés (6 essais : 1 min, 5 min, 30 min, 2 h, 6 h)
select status, count(*) from kayros_webhook_deliveries group by 1;
select delivery_id, event_type, attempts, last_status, last_error, next_attempt_at from kayros_webhook_deliveries where status <> 'delivered' order by created_at desc limit 20;
```

Rejouer un webhook abandonné : `update kayros_webhook_deliveries set status='pending', next_attempt_at=now(), attempts=0 where delivery_id='whd_…';`

## Dépannage

### Le backend répond 503

Cause : `KAYROS_AUTH_SECRET` absent — les routes protégées sont désactivées.
Solution : définir la variable dans `.env`, redémarrer.

### Les notifications email ne partent pas

`contact@kayroslab.com` est une **redirection IONOS** vers Gmail, pas une boîte SMTP. L’envoi passe par `smtp.gmail.com` avec le compte Gmail.

1. Activer la validation en deux étapes du compte Google.
2. Créer un [mot de passe d’application](https://myaccount.google.com/apppasswords) (16 caractères).
3. Secret GitHub **`KAYROS_SMTP_PASS`** = ce mot de passe (pas le mot de passe du compte). Relancer le déploiement VPS.

```
KAYROS_SMTP_HOST=smtp.gmail.com
KAYROS_SMTP_USER=geoffroydelatournelle@gmail.com
KAYROS_SMTP_PASS=…          # secret, jamais dans git
KAYROS_MAIL_FROM=KayrosLab <geoffroydelatournelle@gmail.com>
KAYROS_CONTACT_TO=contact@kayroslab.com   # IONOS redirige vers Gmail
```

Vérifier :
```bash
curl -s https://api.kayroslab.com/health | grep smtp
# Tester le transport
cd /opt/kayroslab/backend/fastify
node --input-type=module -e 'import { smtpFromEnv, createSmtpTransport } from "./lib/smtp.mjs"; const s=smtpFromEnv(); const t=await createSmtpTransport(s); console.log(s.host, s.user, await t.verify());'
```

### Intégrations : n8n / Zapier ne reçoit rien

1. Console → Intégrations → **Dernières livraisons** : code HTTP et erreur de la cible.
2. `401`/`400` côté n8n : signature refusée → secret différent (re-révéler le secret, le recoller), ou corps modifié avant vérification (la signature porte sur le **corps brut**).
3. `pending` qui s’accumulent : `pm2 logs kayros-api | grep webhook` ; vérifier que `KAYROS_INTEGRATION_WORKERS` n’est pas à `off`.
4. Mission bloquée en `running` : voir `kayros_mission_jobs` ci-dessus ; un job `running` dont le bail est expiré est repris par le prochain worker, au-delà de 3 tentatives le fil passe `failed`.

### Intégrations : 401 / 403 / 409 / 429 sur /v1/public

| Code | Cause |
|------|-------|
| 401 | Clé absente, invalide, révoquée ou expirée |
| 403 | Scope manquant (`missions:write`, `missions:read`, `collectives:read`) |
| 404 | Collectif inactif, inconnu ou hors des collectifs autorisés pour la clé |
| 409 | `Idempotency-Key` réutilisée avec un corps différent |
| 429 | 60 req/min par clé, ou quota quotidien de missions (`KAYROS_PUBLIC_MISSIONS_PER_DAY`) |

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
| Fuite DNS | Vérifier `api.kayroslab.com` et `www.kayroslab.com` → A → `51.210.9.71` chez IONOS |

## Références

| Fichier | Rôle |
|---------|------|
| `backend/fastify/.env` | Configuration sensible (hors git) |
| `deploy/ovh-vps/nginx-kayroslab-api.conf` | Reverse proxy API |
| `deploy/ovh-vps/nginx-kayroslab-www.conf` | Site statique www |
| `deploy/ovh-vps/deploy-sso.sh` | Authelia (OIDC Apache-2.0) |
| `deploy/ovh-vps/deploy-backend.sh` | Script de déploiement |
| `deploy/ovh-vps/backup-data.sh` | Sauvegarde des données |
| `deploy/ovh-vps/BOOTSTRAP.md` | Procédure d'installation initiale |
| `backend/fastify/DEPLOY-VPS.md` | Documentation déploiement détaillée |
| `monitoring/README.md` | Supervision Prometheus/Alertmanager/Grafana (mono-nœud) |
| `monitoring/alertmanager-silence.sh` | Silences d'alertes (déploiement, maintenance) |
| `docs/openapi/kayroslab-public-v1.json` | Spécification de l’API publique v1 |
| `docs/ARCHITECTURE-CONSOLE-INTEGRATIONS.md` | Architecture des intégrations (n8n, Zapier, Salesforce) |
| `integrations/n8n/README.md` | PoC Salesforce en 15 minutes |
