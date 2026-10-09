# Salesforce × KayrosLab avec n8n — PoC en 15 minutes

**Objectif :** quand une opportunité Salesforce passe à l'étape **Proposal**, un collectif d'agents KayrosLab (finance, juridique, technique…) la passe en revue. Son **verdict** (GO / CONDITIONAL GO / NO GO) arrive en **tâche sur l'opportunité**, avec les risques, les conditions et le lien vers le dossier complet. Quand un humain arbitre dans la console, une seconde tâche « Décision » suit.

```
Salesforce                    n8n (n8n.kayroslab.com)                     KayrosLab (api.kayroslab.com)
──────────                    ───────────────────────                     ─────────────────────────────
Opportunité → Proposal ──▶ [1] « lancer la revue »  ── POST /v1/public/missions ──▶ collectif d'agents
                              (clé d'API, Idempotency-Key)                        │ 1–2 min (fast)
Tâche « Verdict » ◀────── [2] « verdict et arbitrage » ◀── webhook signé HMAC ────┘
Tâche « Décision » ◀───── [2]                          ◀── webhook signé ◀── arbitrage dans la console
```

| Fichier | Rôle |
|---------|------|
| `workflows/salesforce-opportunity-review.json` | Workflow 1 : déclencheur Salesforce → mission KayrosLab |
| `workflows/kayroslab-verdict-to-salesforce.json` | Workflow 2 : webhook signé → vérification HMAC → tâche Salesforce (+ arbitrage, + champs personnalisés en option) |
| `docker-compose.yml`, `.env.example`, `init-n8n-db.sql` | n8n auto-hébergé sur le VPS (127.0.0.1, 512 Mo, base Postgres dédiée) |
| `nginx-n8n.kayroslab.com.conf` | Reverse proxy HTTPS + authentification de l'éditeur |
| `CUSTOM-FIELDS.md` | Option : champs Verdict / Score / Dossier sur l'opportunité |
| `../zapier/README.md` | Variante Zapier (2 Zaps) |

---

## Partie A — Installer n8n sur le VPS (une seule fois, ~20 min)

> Installation **manuelle** volontaire la première fois : chaque étape se vérifie à l'œil. Le dépôt est déjà cloné dans `/opt/kayroslab` sur le VPS.

### Installation automatisée (GitHub Actions)

Le workflow **Setup n8n - OVH VPS** (`.github/workflows/setup-n8n-vps.yml`, lancement manuel) déroule les étapes A2 à A4 via `setup-n8n-vps.sh`, avec les secrets de déploiement existants :

| Étape | Effet |
|-------|-------|
| `install` | base et rôle Postgres `n8n` (repli SQLite si Postgres est indisponible), `.env` avec une `N8N_ENCRYPTION_KEY` générée, `docker compose up -d`, vhost nginx + htpasswd, certificat **seulement si** le DNS pointe déjà vers 51.210.9.71 |
| `certbot` | à relancer une fois l'enregistrement DNS en place : active le vhost et obtient le certificat |
| `status` | conteneur, `healthz`, DNS, vhost, certificat, santé de l'API — aucun secret |

```bash
gh workflow run setup-n8n-vps.yml -f step=install
gh workflow run setup-n8n-vps.yml -f step=certbot   # après le DNS
```

Rejouable sans risque : clé, mots de passe et htpasswd existants sont conservés ; nginx n'est rechargé qu'après `nginx -t`. Aucun secret n'apparaît dans les logs. Sur le VPS (root) :

| Secret | Emplacement |
|--------|-------------|
| `N8N_ENCRYPTION_KEY`, mot de passe Postgres `n8n` | `/opt/kayroslab/integrations/n8n/.env` (600, ignoré par git) |
| Identifiant / mot de passe nginx de l'éditeur | `/root/kayros-n8n/basic-auth.txt` (600) — `sudo cat /root/kayros-n8n/basic-auth.txt` |

> ⚠️ **Sauvegardez `N8N_ENCRYPTION_KEY`** hors du VPS (gestionnaire de mots de passe) : `sudo grep N8N_ENCRYPTION_KEY /opt/kayroslab/integrations/n8n/.env`. Sans elle, les identifiants enregistrés dans n8n (Salesforce, clé KayrosLab, secret HMAC) sont perdus si le VPS doit être reconstruit.

Installation à la main, étape par étape :

### A1. DNS (à faire en premier : la propagation prend quelques minutes)

Chez le registraire du domaine (IONOS), ajoutez un enregistrement :

| Type | Nom | Valeur | TTL |
|------|-----|--------|-----|
| A | `n8n` | `51.210.9.71` | 3600 |

Vérifier : `dig +short n8n.kayroslab.com` doit répondre `51.210.9.71`.

### A2. Base de données

Postgres local (recommandé) : base et rôle `n8n` dédiés, sans aucun droit sur les tables KayrosLab.

```bash
cd /opt/kayroslab/integrations/n8n
N8N_DB_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')
sudo -u postgres psql -v ON_ERROR_STOP=1 -v n8n_password="$N8N_DB_PASSWORD" -f init-n8n-db.sql
```

Pas de Postgres sur la machine ? Mettez `DB_TYPE=sqlite` dans `.env` à l'étape suivante (fichier dans le volume Docker, suffisant pour le PoC).

### A3. Démarrer n8n

```bash
cd /opt/kayroslab/integrations/n8n
cp .env.example .env
sed -i "s|^N8N_ENCRYPTION_KEY=.*|N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)|" .env
sed -i "s|^N8N_DB_PASSWORD=.*|N8N_DB_PASSWORD=$N8N_DB_PASSWORD|" .env
chmod 600 .env
docker compose up -d
docker compose logs -f n8n        # attendre « Editor is now accessible via »
curl -fsS http://127.0.0.1:5678/healthz && echo " n8n OK"
```

> ⚠️ Sauvegardez `N8N_ENCRYPTION_KEY` (gestionnaire de mots de passe) : sans elle, les identifiants enregistrés dans n8n sont perdus.

### A4. HTTPS et protection de l'éditeur

```bash
sudo apt-get install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd-n8n geoffroy
sudo cp nginx-n8n.kayroslab.com.conf /etc/nginx/sites-available/n8n.kayroslab.com
sudo ln -sf /etc/nginx/sites-available/n8n.kayroslab.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d n8n.kayroslab.com --redirect --agree-tos -m contact@kayroslab.com -n
```

### A5. Compte propriétaire

Ouvrez https://n8n.kayroslab.com (identifiant nginx, puis écran n8n) et créez le **compte propriétaire**. Activez la double authentification (Paramètres → Personnel).

---

## Partie B — Le PoC en 15 minutes

Prérequis : un compte **comex** dans la console KayrosLab, un compte **administrateur Salesforce** (une *Developer Edition* ou une *sandbox* est idéale pour un premier essai).

### B1. KayrosLab (2 min)

1. Console → **Sessions** → *Nouvelle session* : par exemple « Revue des deals » avec CFO, Legal Counsel et CTO. Son identifiant `room_…` s'affiche dans Intégrations → *Collectifs autorisés* (ou via `GET /v1/public/collectives`, ci-dessous).
2. Console → **Intégrations** → *Clés d'API* : nom « n8n — Salesforce », droits par défaut → **Créer la clé**. Copiez la clé `kl_live_…` : elle n'est affichée qu'une fois.
3. Même page, *Webhook sortant* → **Créer / Révéler le secret** et copiez le secret `whsec_…`.

Contrôle rapide : `curl -s https://api.kayroslab.com/v1/public/collectives -H "Authorization: Bearer kl_live_…"` liste votre collectif.

### B2. Salesforce → application connectée (5 min)

Salesforce : **Setup → App Manager → New Connected App** (selon l'org : *New External Client App*).

| Champ | Valeur |
|-------|--------|
| Connected App Name | `n8n KayrosLab` |
| Enable OAuth Settings | ✔ |
| Callback URL | `https://n8n.kayroslab.com/rest/oauth2-credential/callback` |
| Selected OAuth Scopes | *Manage user data via APIs (api)* et *Perform requests at any time (refresh_token, offline_access)* |
| Require PKCE | décoché |

Enregistrez, puis **Manage Consumer Details** : copiez la *Consumer Key* et le *Consumer Secret*. Comptez jusqu'à 10 minutes avant que l'application soit utilisable.

n8n → **Credentials → Add credential → Salesforce OAuth2 API** :
- *Environment Type* : `Production` (ou `Sandbox`) ;
- *Client ID* : la Consumer Key ; *Client Secret* : le Consumer Secret ;
- **Connect my account**, puis acceptez dans la fenêtre Salesforce.

### B3. Identifiants KayrosLab dans n8n (2 min)

n8n → **Credentials → Add credential** :

| Type | Nom conseillé | Champs |
|------|---------------|--------|
| **Header Auth** | `KayrosLab API` | Name : `Authorization` · Value : `Bearer kl_live_…` |
| **Crypto** | `KayrosLab webhook` | Hmac Secret : `whsec_…` |

Les identifiants sont chiffrés par n8n (`N8N_ENCRYPTION_KEY`) et n'apparaissent pas dans les workflows exportés.

### B4. Importer et activer les deux workflows (4 min)

n8n → **Workflows → Create → ⋯ → Import from File**, ou *Import from URL* avec l'URL « Raw » GitHub du fichier.

**Workflow 2 d'abord**, `kayroslab-verdict-to-salesforce.json` :
1. Nœud *Calculer la signature (HMAC)* : identifiant `KayrosLab webhook`.
2. Nœud *Créer la tâche Salesforce* : identifiant Salesforce.
3. **Publiez** le workflow (bouton *Publish* en haut à droite ; *Active* dans les anciennes versions). L'URL de production est `https://n8n.kayroslab.com/webhook/kayros-mission-events`.

**Puis le workflow 1**, `salesforce-opportunity-review.json` :
1. Nœuds *Opportunité modifiée*, *Opportunité créée* et *Lire l'opportunité* : identifiant Salesforce.
2. Nœud *Lancer la mission KayrosLab* : identifiant `KayrosLab API`.
3. Nœud *Configuration et filtre* : remplacez `collective_id` par votre `room_…`. Pour une première démonstration, mettez `profile: 'demo'` (verdict simulé en moins de 5 s, étiqueté « [Démo] »). Vérifiez `stage` : c'est la valeur exacte de l'étape dans votre org (en standard : `Proposal/Price Quote`).
4. **Publiez** le workflow.

Test du webhook seul (facultatif) : console → Intégrations → *URL du webhook* = `https://n8n.kayroslab.com/webhook/kayros-mission-events` → **Envoyer un test**. Une exécution « ping » réussie apparaît dans n8n (aucune tâche créée), et la console affiche « livré ».

### B5. La démonstration (2 min)

1. Dans Salesforce, passez une opportunité à l'étape **Proposal/Price Quote**.
2. Moins d'une minute plus tard (n8n interroge Salesforce chaque minute), la mission apparaît dans la console (**Décisions**).
3. La tâche **« KayrosLab — Verdict : … »** apparaît dans l'activité de l'opportunité : verdict, score d'adhésion, risques, conditions, avis par agent et lien **Dossier complet**.
4. Ouvrez le lien, **arbitrez** dans la console : une tâche **« KayrosLab — Décision : … »** suit sur l'opportunité.
5. Repassez `profile: 'fast'` pour un vrai verdict (1 à 2 min), ou `deep` (~12 min) pour les dossiers sensibles.

---

## Comment c'est sécurisé

- **Clé d'API par outil**, limitée aux droits nécessaires (et éventuellement à certains collectifs), révocable dans la console. KayrosLab n'en garde que l'empreinte.
- **Webhooks signés** : `X-Kayros-Signature: t=<unix>,v1=HMAC-SHA256(secret, t + "." + corps)`. Le workflow 2 refuse une signature fausse, un corps modifié ou un horodatage de plus de 5 minutes, et ignore les doublons (`event_id`).
- **Une seule revue par opportunité et par étape** : clé d'idempotence `sf-<Id>-<Étape>` côté KayrosLab, et mémoire du workflow côté n8n.
- **Livraison garantie** : le workflow 2 ne répond 200 qu'une fois la tâche créée. En cas d'erreur (Salesforce indisponible…), KayrosLab réessaie à 1 min, 5 min, 30 min, 2 h et 6 h. Historique dans console → Intégrations → *Dernières livraisons*.
- **Éditeur n8n** derrière HTTPS, mot de passe nginx et compte n8n. Seules les URL `/webhook*` sont publiques.

## Personnaliser

| Besoin | Où |
|--------|----|
| Autre étape déclencheuse | *Configuration et filtre* → `stage` |
| Profil d'analyse | *Configuration et filtre* → `profile` (`demo`, `fast`, `deep`) |
| Ne pas suivre les arbitrages | *Vérifier la signature* → `notify_arbitration: false` |
| Champs Verdict / Score / Dossier sur l'opportunité | `CUSTOM-FIELDS.md` puis activer le nœud *Champs KayrosLab sur l'opportunité (option)* |
| Libellés et contenu de la tâche | *Vérifier la signature* (section 3) |

## Dépannage

| Symptôme | Piste |
|----------|-------|
| Aucune mission ne part | Workflow 1 publié ? Étape exacte (`stage`) ? Exécutions n8n en erreur ? Une opportunité déjà traitée à cette étape n'est pas relancée. |
| `401` sur *Lancer la mission* | Clé révoquée ou mal copiée : la valeur doit être `Bearer kl_live_…`. |
| `404 collectif introuvable` | `collective_id` erroné, session archivée, ou clé limitée à d'autres collectifs. |
| Mission terminée mais pas de tâche | Console → Intégrations → *Dernières livraisons* : un code 500 indique une erreur dans le workflow 2 (voir ses exécutions) ; « Signature invalide » signifie que le secret de l'identifiant Crypto diffère de celui de la console. |
| `INVALID_SESSION_ID` côté Salesforce | Reconnectez l'identifiant Salesforce OAuth2 dans n8n. |

## Exploitation

```bash
cd /opt/kayroslab/integrations/n8n
docker compose ps && docker stats --no-stream kayros-n8n     # < 512 Mo
docker compose logs --tail 100 n8n
# Mise à jour : changer la version de l'image dans docker-compose.yml, puis
docker compose pull && docker compose up -d
# Sauvegarde (Postgres)
sudo -u postgres pg_dump -Fc n8n > /opt/kayroslab/backups/n8n-$(date +%F).dump
```

Les workflows sont générés depuis `tools/build-workflows.mjs` et vérifiés par `tests/n8n-workflows.test.mjs`, qui contrôle le JSON et exécute le code des nœuds contre de vraies signatures. Après modification : `node integrations/n8n/tools/build-workflows.mjs`.
