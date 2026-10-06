# Secrets de supervision (VPS uniquement)

Ce répertoire est monté en lecture seule dans les conteneurs. Son contenu
est ignoré par git (voir `.gitignore`) : **ne jamais commiter de secret**.

| Fichier | Requis | Lu par | Usage |
| --- | --- | --- | --- |
| `slack_webhook_url` | oui (alertes) | Alertmanager | URL d'Incoming Webhook Slack, sur une seule ligne. |
| `grafana_admin_password` | si profil `grafana` | Grafana | Mot de passe admin Grafana. |
| `metrics_token` | si `METRICS_TOKEN` est défini côté API | Prometheus | Même valeur que `METRICS_TOKEN` dans le `.env` de l'API. |
| `pagerduty_routing_key` | non (bloc commenté) | Alertmanager | Clé d'intégration PagerDuty Events v2. |

Droits : Prometheus et Alertmanager tournent en `nobody` (uid 65534),
Grafana en uid 472.

```bash
cd /opt/kayroslab/monitoring/secrets
sudo chown 65534:65534 slack_webhook_url && sudo chmod 0400 slack_webhook_url
# optionnels
[ -f metrics_token ] && sudo chown 65534:65534 metrics_token && sudo chmod 0400 metrics_token
[ -f grafana_admin_password ] && sudo chown 472:472 grafana_admin_password && sudo chmod 0400 grafana_admin_password
```
