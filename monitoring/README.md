# Supervision et alerting — KayrosLab (VPS mono-nœud)

Prometheus + Alertmanager (+ Grafana optionnel) pour l'API `kayros-api`
(Fastify, pm2) du VPS OVH, qui héberge aussi Postgres et Ollama sur ~8 Go
de RAM. Tout écoute sur **127.0.0.1** : rien n'est exposé publiquement.

Cette pile est l'adaptation mono-nœud du dossier technique « Architecture &
Monitoring Redis HA » (Redis RDB/AOF, Sentinel, Docker Swarm, Alertmanager
HA ×3, PagerDuty + Slack, script de silences).

## Contenu

| Fichier | Rôle |
| --- | --- |
| `docker-compose.yml` | Prometheus 3.5 LTS, Alertmanager, blackbox exporter ; Grafana via le profil `grafana`. Réseau `host`, écoute 127.0.0.1, limites mémoire. |
| `prometheus/prometheus.yml` | Scrape de l'API (`127.0.0.1:8787/metrics`), sondes `/health` (publique + locale), auto-supervision. |
| `prometheus/rules/kayros-alerts.yml` | 19 règles d'alerte (API, LLM, missions console, supervision). |
| `prometheus/tests/kayros-alerts.test.yml` | Tests unitaires `promtool test rules`. |
| `alertmanager/alertmanager.yml` | Routage par sévérité vers Slack, inhibition, PagerDuty en commentaire. |
| `blackbox/blackbox.yml` | Sonde HTTP de `/health` (200 + `"ok":true`). |
| `alertmanager-silence.sh` | Silences API v2 (`start`/`stop`/`run`/`status`), utilisé par le déploiement. |
| `grafana/` | Datasource + tableau de bord « KayrosLab — API, LLM et missions console ». |
| `secrets/` | Secrets locaux du VPS (ignorés par git, voir `secrets/README.md`). |

Budget mémoire (limites dures `mem_limit`) : Prometheus 512 Mo, Alertmanager
96 Mo, blackbox 48 Mo, Grafana 256 Mo → **≈ 660 Mo**, **≈ 910 Mo** avec
Grafana. Rétention Prometheus : 15 jours ou 1 Go.

## Métriques exposées par l'API

Exposées par `/metrics` (fastify-metrics + `@platformatic/prom-client`),
définies dans `backend/fastify/lib/metrics.mjs`. **Aucun label ne contient de
donnée personnelle ni de secret** (pas de tenant, d'utilisateur, de question
ni de clé) ; le label `model` est plafonné à 20 valeurs (`other` au-delà).

| Métrique | Type | Labels | Sens |
| --- | --- | --- | --- |
| `kayros_llm_calls_total` | counter | `provider`, `model`, `outcome` | Chaque tentative vers un fournisseur (relances comprises). `outcome` : `success`, `rate_limited` (429), `timeout`, `not_configured`, `circuit_open`, `error`. |
| `kayros_llm_call_duration_seconds` | histogram | `provider`, `outcome` | Durée de ces tentatives. |
| `kayros_llm_requests_total` | counter | `outcome` | Requête de bout en bout : `success`, `degraded` (repli `llm_degraded`), `failed` (chaîne épuisée). |
| `kayros_llm_fallbacks_total` | counter | `from`, `to`, `reason` | Replis NVIDIA → Mistral → mock (`provider_fallback`) ou tag de quantification (`quant_tag_unavailable`). |
| `kayros_llm_last_fallback_to_mock_timestamp_seconds` | gauge | — | Dernier repli vers mock (epoch). |
| `kayros_llm_primary_info` | gauge | `provider`, `model` | Fournisseur primaire effectif (1). |
| `kayros_console_runs_total` | counter | `kind` (`message`/`continue`), `outcome` | Missions console asynchrones terminées : `completed` (en attente d'arbitrage), `needs_clarification`, `failed`, `timeout`. |
| `kayros_console_run_duration_seconds` | histogram | `kind`, `outcome` | Du 202 au statut final. |
| `kayros_console_runs_in_progress` | gauge | — | Missions `running` dans le processus. |
| `kayros_console_run_oldest_running_seconds` | gauge | — | Âge de la plus ancienne mission en cours. |
| `kayros_console_runs_interrupted_total` | counter | — | Missions `running` au démarrage, passées `failed`. |

S'y ajoutent les métriques existantes : `http_request_duration_seconds`
(méthode, route, code) et les métriques process/Node.js par défaut.

### Accès à `/metrics`

Jusqu'ici `/metrics` était **public** (aucune protection). Il est désormais :

- si `METRICS_TOKEN` est défini dans le `.env` de l'API : réservé à
  `Authorization: Bearer <METRICS_TOKEN>` (401 sinon) ;
- sinon (défaut) : réservé au **loopback direct**. Toute requête relayée par
  nginx (en-têtes `X-Real-IP` / `X-Forwarded-For`) ou venant d'une autre IP
  reçoit 403. `curl https://api.kayroslab.com/metrics` renvoie donc 403.

Prometheus tourne en réseau `host` et interroge `127.0.0.1:8787` sans nginx :
le mode par défaut lui suffit, aucun jeton n'est nécessaire.

## Alertes

| Alerte | Sévérité | Condition |
| --- | --- | --- |
| `KayrosApiDown` | critical | scrape `/metrics` en échec 2 min |
| `KayrosHealthCheckFailing` | critical | sonde `/health` (publique ou locale) en échec 3 min |
| `KayrosTlsCertificateExpiringSoon` | warning | certificat `api.kayroslab.com` < 14 jours |
| `KayrosApiHigh5xxRate` | warning | > 5 % de 5xx sur 10 min |
| `KayrosApiMemoryHigh` | warning | RSS > 350 Mo 10 min (pm2 redémarre à 400 Mo) |
| `KayrosApiRestartLoop` | warning | > 2 redémarrages en 30 min |
| `KayrosLlmDegradedToMock` | warning | au moins un repli vers mock en 10 min |
| `KayrosLlmMostlyMock` | critical | > 50 % des requêtes servies par mock pendant 15 min |
| `KayrosLlmPrimaryIsMock` | warning | aucun fournisseur configuré (primaire = mock) |
| `KayrosLlmHighErrorRate` | warning | > 25 % d'échecs sur un fournisseur réel (≥ 5 appels / 10 min) |
| `KayrosLlmRateLimited` | warning | > 5 réponses 429 en 10 min |
| `KayrosLlmTimeouts` | warning | > 3 délais dépassés en 15 min |
| `KayrosLlmRequestsFailing` | critical | > 3 requêtes sans aucune réponse (mock compris) en 10 min |
| `KayrosConsoleRunFailureRate` | warning | > 30 % de missions `failed`/`timeout` sur 1 h (≥ 3 missions) |
| `KayrosConsoleRunStuck` | warning | mission `running` depuis > 30 min |
| `KayrosConsoleRunsInterruptedAtStartup` | warning | missions passées `failed` au redémarrage |
| `TargetDown` | warning | composant de supervision injoignable 5 min |
| `PrometheusRuleEvaluationFailures` | warning | règle en erreur |
| `AlertmanagerNotificationsFailing` | warning | échec d'envoi Slack/PagerDuty |

Routage : `critical` → Slack **#devops-critical** (rappel toutes les heures),
`warning` → Slack **#devops-warnings** (toutes les 4 h). Une alerte critique
inhibe les warnings du même `service` ; `KayrosApiDown` inhibe
`KayrosHealthCheckFailing`.

## Installation sur le VPS

Prérequis : Docker + plugin compose (déjà présents pour Authelia/TimesFM).
Le dépôt est cloné dans `/opt/kayroslab` et mis à jour par le déploiement.

```bash
cd /opt/kayroslab/monitoring

# 1. Webhook Slack (Slack > Apps > Incoming Webhooks). Une URL par webhook :
#    un webhook Slack est lié à UN canal ; le champ `channel` des receivers
#    n'est respecté que par les webhooks « legacy ». Pour deux canaux
#    distincts, voir « Deux webhooks » plus bas.
sudo install -m 0400 -o 65534 -g 65534 /dev/null secrets/slack_webhook_url
sudo sh -c 'read -r url; printf "%s" "$url" > secrets/slack_webhook_url'   # coller l'URL puis Entrée

# 2. (optionnel) mot de passe admin Grafana
sudo sh -c 'openssl rand -base64 24 | tr -d "\n" > secrets/grafana_admin_password'
sudo chown 472:472 secrets/grafana_admin_password && sudo chmod 0400 secrets/grafana_admin_password

# 3. Démarrage
docker compose up -d                      # Prometheus + Alertmanager + blackbox
docker compose --profile grafana up -d    # + Grafana (optionnel)
docker compose ps

# 4. Vérifications
curl -fsS http://127.0.0.1:9090/-/ready && echo " prometheus OK"
curl -fsS http://127.0.0.1:9093/-/ready && echo " alertmanager OK"
curl -s http://127.0.0.1:9090/api/v1/targets | grep -o '"health":"[a-z]*"' | sort | uniq -c
curl -s http://127.0.0.1:8787/metrics | grep '^kayros_'
curl -s -o /dev/null -w '%{http_code}\n' https://api.kayroslab.com/metrics   # attendu : 403
```

Ports locaux : Prometheus 9090, Alertmanager 9093, blackbox 9115, Grafana
3300 (Authelia occupe 9091, openDPE 8080). Accès depuis un poste :

```bash
ssh -L 9090:127.0.0.1:9090 -L 9093:127.0.0.1:9093 -L 3300:127.0.0.1:3300 <user>@51.210.9.71
# puis http://localhost:9090, http://localhost:9093, http://localhost:3300
```

Test d'une notification de bout en bout :

```bash
curl -s -XPOST -H 'content-type: application/json' http://127.0.0.1:9093/api/v2/alerts -d '[{
  "labels": {"alertname":"TestNotification","severity":"warning","service":"monitoring","env":"production"},
  "annotations": {"summary":"Test d alerte KayrosLab","description":"Message de test, ignorer."}
}]'
```

Mise à jour de la configuration après un `git pull` (fait par le déploiement) :

```bash
cd /opt/kayroslab/monitoring
docker compose run --rm --entrypoint promtool prometheus check config /etc/prometheus/prometheus.yml
curl -XPOST http://127.0.0.1:9090/-/reload       # Prometheus (--web.enable-lifecycle)
curl -XPOST http://127.0.0.1:9093/-/reload       # Alertmanager
```

### Deux webhooks (un par canal)

Les Incoming Webhooks modernes postent toujours dans le canal choisi à leur
création. Pour séparer réellement #devops-critical et #devops-warnings :
créer un second webhook, le déposer dans `secrets/slack_webhook_url_critical`
et ajouter `api_url_file: /etc/alertmanager/secrets/slack_webhook_url_critical`
sous `slack_configs` du receiver `slack-critical-channel`.

### Jeton `/metrics` (optionnel)

Pour scraper `/metrics` depuis l'extérieur (Grafana Cloud, etc.) : créer le
secret GitHub `METRICS_TOKEN` (le workflow de déploiement l'écrit alors dans
le `.env`), déposer la même valeur dans `secrets/metrics_token` et
décommenter le bloc `authorization` de `prometheus/prometheus.yml`.

### PagerDuty (optionnel)

Décommenter la route et le receiver `pagerduty-oncall` dans
`alertmanager/alertmanager.yml`, déposer la clé Events v2 dans
`secrets/pagerduty_routing_key`, recharger Alertmanager.

## Silences pendant les déploiements

`.github/workflows/deploy-vps-backend.yml` encadre `deploy-backend.sh`
(redémarrage pm2) par un silence de 15 min sur `service=kayros-api,
env=production`, expiré par un `trap` en fin de script, **même en cas
d'échec**. Si Alertmanager n'est pas installé ou ne répond pas, le script
affiche un avertissement et sort en 0 : le déploiement n'est jamais bloqué.

```bash
monitoring/alertmanager-silence.sh start                       # 30 min par défaut
DURATION_MINUTES=60 SILENCE_COMMENT="Maintenance Postgres" monitoring/alertmanager-silence.sh start
monitoring/alertmanager-silence.sh status
monitoring/alertmanager-silence.sh stop
monitoring/alertmanager-silence.sh run pm2 restart kayros-api  # silence le temps de la commande
```

Corrections par rapport au script du dossier : l'expiration utilise
`DELETE /api/v2/silence/{id}` (singulier, conforme à l'API v2), plus de
dépendance à `jq`, délais `curl` bornés, code de sortie de `run` propagé.

## Ce qui n'a pas été repris du dossier source, et pourquoi

- **Redis (RDB + AOF), Sentinel, `redis_exporter`** : KayrosLab n'utilise pas
  Redis. L'état durable est dans Postgres (local) et des fichiers sous
  `/opt/kayroslab/data`, déjà sauvegardés (`backup-pg.sh`, `backup-data.sh`).
  Ajouter Redis créerait un composant à exploiter sans aucun consommateur.
- **Docker Swarm, réseau overlay, Docker configs/secrets Swarm** : un seul
  VPS. Swarm n'apporterait aucune redondance (un seul nœud = un seul point de
  défaillance) et ajouterait un plan de contrôle. `docker compose` + fichiers
  montés en lecture seule couvrent le besoin.
- **Alertmanager HA à 3 répliques (maillage gossip)** : sur un seul hôte, les
  trois répliques tomberaient ensemble ; la HA n'a de sens que sur plusieurs
  machines. Une instance suffit (`--cluster.listen-address=` vide).
- **Découverte DNS `tasks.alertmanager`** : spécifique à Swarm, remplacée par
  une cible statique `127.0.0.1:9093`.
- **Grafana exposé sur `0.0.0.0:3000`** : remplacé par 127.0.0.1:3300 +
  tunnel SSH, et rendu optionnel (profil compose) pour économiser la RAM.
- **Scrape toutes les 5 s** : 15 s pour l'API, 60 s pour les sondes `/health`
  (qui partagent le quota de rate-limit de l'API).

Limite assumée : la supervision tourne sur le même VPS que l'API. Si la
machine entière tombe, aucune alerte ne part. Pour couvrir ce cas, ajouter
une sonde externe gratuite (UptimeRobot, Better Stack, healthchecks.io…) sur
`https://api.kayroslab.com/health`.
