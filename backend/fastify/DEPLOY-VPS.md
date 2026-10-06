# Déploiement du backend Fastify sur le VPS OVH « OpenDPE »

Runbook pour mettre le proxy LLM gouverné en ligne sur ton VPS.

## Cible

| | |
|---|---|
| VPS | `vps-OpenDPE.vps.ovh.net` (interne `vps-088d27a3.vps.ovh.net`) |
| Modèle | VPS-1 2026 — 4 vCores / 8 Go RAM / 75 Go |
| IPv4 | `51.210.9.71` |
| Zone | Strasbourg (SBG) |

> Distro par défaut OVH = Debian/Ubuntu. Adapter les commandes `apt` si autre distribution.

## 1. Connexion SSH

```bash
ssh debian@51.210.9.71        # ou ubuntu@ / root@ selon l'installation
```

## 2. Dépendances (Node 20, git, nginx)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx
node --version                # doit afficher v20.x
```

## 3. Récupérer le backend

```bash
git clone https://github.com/Geoking2104/KayrosLab.git
cd KayrosLab/backend/fastify
npm install
```

## 4. Configuration (clé côté serveur)

```bash
cp .env.sample .env
nano .env
```
Renseigner :
```
PORT=8787
ALLOWED_ORIGIN=https://www.kayroslab.com
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-3-5-sonnet-latest   # adapter au modèle API courant
# Ollama reste strictement local au VPS (aucun port 11434 public)
OLLAMA_ENDPOINT=http://127.0.0.1:11434
EMBED_MODEL=bge-m3
# KAYROS_SECRET=...                        # secret partagé optionnel
```

### Fournisseur LLM : NVIDIA (prioritaire), Mistral en repli

En production, **les clés LLM ne se saisissent pas à la main dans `.env`** : le
workflow `.github/workflows/deploy-vps-backend.yml` réécrit à chaque déploiement
les lignes suivantes de `/opt/kayroslab/backend/fastify/.env` à partir des
secrets/variables GitHub (une valeur absente vide la ligne) :

| Ligne `.env` | Source GitHub | Rôle |
|---|---|---|
| `NVIDIA_API_KEY=` | **secret** `NVIDIA_API_KEY` | active NVIDIA NIM (prioritaire) |
| `NVIDIA_MODEL=` | variable `NVIDIA_MODEL` (optionnelle) | vide = `deepseek-ai/deepseek-v4.1-flash` |
| `LLM_PROVIDER=` | variable `LLM_PROVIDER` (optionnelle) | vide = sélection automatique |
| `LLM_MAX_CONCURRENCY=` | variable `LLM_MAX_CONCURRENCY` (optionnelle) | vide = 2 agents simultanés |
| `MISTRAL_API_KEY=` | secret `MISTRAL_API_KEY` | repli automatique (ou primaire sans NVIDIA) |

Activer NVIDIA = créer le secret de dépôt `NVIDIA_API_KEY`
(Settings → Secrets and variables → Actions → New repository secret, ou
`gh secret set NVIDIA_API_KEY` en saisissant la valeur au prompt), puis relancer
le workflow « Deploy KayrosLab backend - OVH VPS » (`workflow_dispatch`).
Aucune autre action sur le serveur. Vérification :

```bash
curl -s https://api.kayroslab.com/health | jq .llm
# { "provider": "nvidia", "live": true, "model": "deepseek-ai/deepseek-v4.1-flash",
#   "fallback": ["mistral", "mock"], "maxConcurrency": 2, "maxRetries": 2, ... }
```

Ordre de sélection (`lib/llm-config.mjs`) : `LLM_PROVIDER` forcé →
`NVIDIA_API_KEY` → `MISTRAL_API_KEY` → `ANTHROPIC_API_KEY` → `mock`.
Retour à Mistral sans supprimer la clé : variable `LLM_PROVIDER=mistral`.

> Modèle : « DeepSeek V4 Pro » n'est plus servi par l'API hébergée NVIDIA
> (`/v1/models/deepseek-ai/deepseek-v4-pro` et `…-v4-pro-0813` → 410 Gone).
> Le défaut est donc `deepseek-ai/deepseek-v4.1-flash`, seul DeepSeek génératif
> au catalogue ; `NVIDIA_MODEL` permet d'en changer
> (`curl -s https://integrate.api.nvidia.com/v1/models` liste les identifiants).

Hors workflow (instance lancée à la main), ajouter la ligne au `.env` du serveur :
`NVIDIA_API_KEY=<clé fournie par le porteur>` puis `pm2 restart kayros-api --update-env`.

Robustesse : un 429 est relancé avec backoff exponentiel + jitter (Retry-After
respecté, `LLM_MAX_RETRIES=2` → 3 essais), puis repli signalé (Mistral, puis
mock). Les agents du swarm sont interrogés au plus `LLM_MAX_CONCURRENCY` à la
fois. Les embeddings (Ollama `bge-m3`) ne changent pas.

## 5. Service permanent (pm2)

```bash
sudo npm i -g pm2
pm2 start "node --env-file=.env index.mjs" --name kayros-api
pm2 save
pm2 startup                   # exécuter la commande affichée (démarrage au boot)
pm2 logs kayros-api           # vérifier les logs
```

Test local sur le VPS :
```bash
curl -s localhost:8787/health
curl -s -X POST localhost:8787/v1/llm -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"bonjour"}],"provider":"mock"}'
```

## 6. HTTPS public via nginx + Let's Encrypt

1. **DNS** : créer un enregistrement `A`  `api.kayroslab.com` → `51.210.9.71`.
2. **Reverse proxy** — `/etc/nginx/sites-available/kayros-api` :
```nginx
server {
  listen 80;
  server_name api.kayroslab.com;
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/kayros-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```
3. **Certificat TLS** :
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.kayroslab.com
```

## 7. Pare-feu

Ouvrir 80/443 (le port 8787 reste interne, non exposé) :
```bash
sudo ufw allow 22,80,443/tcp && sudo ufw enable      # si ufw est utilisé
```
> Vérifier aussi le pare-feu OVH (Edge Network Firewall) dans le manager si activé.

## 8. Test public + câblage de l'app

```bash
curl https://api.kayroslab.com/health
```
Côté navigateur (`core/`) :
```js
createEngine({ backendUrl: 'https://api.kayroslab.com/v1/llm', backendProvider: 'anthropic' })
```

## Mises à jour

```bash
cd ~/KayrosLab && git pull && cd backend/fastify && npm install && pm2 restart kayros-api
```

## Option souveraine (Ollama sur le VPS)

8 Go RAM en CPU seul → petits modèles uniquement (`llama3.2`).
```bash
# Idempotent : installe Ollama, force 127.0.0.1:11434, télécharge bge-m3
# et vérifie un embedding multilingue.
bash deploy/ovh-vps/install-ollama.sh

# Pour le chat local (optionnel, distinct des embeddings) :
ollama pull llama3.2

# Le déploiement GitHub Actions renseigne automatiquement dans .env :
# OLLAMA_ENDPOINT=http://127.0.0.1:11434
# EMBED_MODEL=bge-m3
```
Pour du raisonnement stratégique, Claude via l'API reste recommandé.

## Boucle Projeter → Écouter (EF-43) — cron

L'endpoint `POST /v1/projeter/monitor` est un **tick sans état** (évalue les KPIs, renvoie
`{alerts, signals, reArbitrage}`). Un cron sur le VPS l'appelle périodiquement ; ton pipeline
décide ensuite de ré-injecter les `signals` dans le corpus d'Écouter et d'ouvrir un re-arbitrage.

Exemple (toutes les heures) — `crontab -e` :

```cron
0 * * * * curl -fsS -X POST http://localhost:8787/v1/projeter/monitor \
  -H 'Content-Type: application/json' \
  -d @/opt/kayroslab/monitor-payload.json >> /var/log/kayros-monitor.log 2>&1
```

`monitor-payload.json` : `{ "ideaId": "...", "kpis": [{ "id":"adoption","threshold":100,"comparator":"lte" }], "readings": [{ "kpiId":"adoption","value": 80 }] }`.

> Côté application (navigateur), la même logique tourne en pur JS via `MonitoringLoop` +
> `orchestrator.monitorProjection(...)` — pas d'appel réseau nécessaire.
