# KayrosLab Console harness and governed sessions

> La spécification de production V2 (agents administrables, coffre connecteurs et fils de décision) se trouve dans [PRODUCTION-CONSOLE-V2.md](./PRODUCTION-CONSOLE-V2.md).

La console est un **harness d'agents** : un poste de travail qui compose des collectifs, exécute des missions gouvernées et conserve chaque dossier sous arbitrage humain. Elle emprunte le vocabulaire d'un harness d'agents (agents, outils, collectif, session, mission, étapes, arbitrage) et s'appuie sur le runtime gouverné de KayrosLab. Elle ne dépend d'aucune application d'interface dérivée : le produit de conversation séparé possède ses propres surfaces.

## Product model

```text
Tenant
  ├─ Agent registry (rules + optional consented human profile)
  ├─ Swarm configurations (collectives)
  └─ Harness sessions
       └─ stable collective (agent rosters + voting threshold)
            ↓
       Governed mission (one step per agent + consensus)
            ↓
       Durable dossier + decision thread
            ↓
       Human arbitration
```

A **session** is the stable product boundary of the console. It binds one governed collective to one durable execution log. Each mission appends an ordered dossier to that session; the same log is exposed through the web console.

## Runtime guarantees

- Tenant isolation on session lookup, agent registry and swarm execution.
- One active execution slot per session; later missions queue behind the current run.
- Ordered, idempotent execution events for every mission.
- Human arbitration remains mandatory after every collective verdict.
- Consented hybrid personality data is still mediated by the existing swarm APIs.

## API

Authenticated console endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/console/overview` | User, agent, connector, session and activity summary |
| `GET` | `/v1/console/sessions` | List tenant harness sessions |
| `POST` | `/v1/console/sessions` | Open a session bound to an existing or newly created collective. Optional `agent_overrides` (per-session adjustment of a proposed agent: identity, mission, seniority, veto, behavioral profile, rules) and `custom_agents` (agents composed for this session only, possibly carrying a consented real-person profile) |
| `GET` | `/v1/console/sessions/:sessionId` | Session detail with its executions and activity log |
| `PATCH` | `/v1/console/sessions/:sessionId/collective` | Add or remove agents from the active collective (`add_custom_agents` adds session-only agents, e.g. imported real personalities) |
| `POST` | `/v1/console/personality/preview` | Preview a real personality (Crystal Knows Data API v4, Crystal JSON export or DISC type) and the proposed agent attributes, without saving anything. API lookups (credits) require comex/admin |
| `POST` | `/v1/console/sessions/:sessionId/agents/:agentId/promote` | Save a session-composed, session-adjusted or imported (Crystal/DISC) agent to the tenant's shared registry. comex/admin only. Body: `agent_id?`, `display_name?`, `include_human_profile` (default `true`), `share_consent_confirmed` (required with a real profile). In a shared self-service tenant (`KAYROS_SHARED_TENANT_IDS`, default `default`) a real profile is refused (403 `shared_tenant_real_profile`); `include_human_profile: false` saves the attributes only and scrubs the person's name from every text field |
| `POST` | `/v1/console/sessions/:sessionId/run` | Run a governed mission from the console |
| `POST` | `/v1/console/agents/:agentId/personality` | Import d'un profil humain consenti (Crystal Knows / LinkedIn / export autorisé / saisie) |
| `POST` | `/v1/console/impersonators` | Crée un **agent impersonator** : persona reconstruite depuis des indices (LinkedIn / Crystal Knows / export / manuel) + garde-fous |
| `POST` | `/v1/console/impersonator-teams` | Crée une **équipe d'impersonators** (2–12 personas) et ouvre la session correspondante |
| `PUT` | `/v1/console/agents/:agentId/human-profile` | Profil humain fourni directement (consentement explicite requis) |
| `POST` | `/v1/console/connectors/:platform/connect` | Démarre la connexion « un bouton » d'un canal (Slack / Teams / Discord) |
| `GET` | `/v1/console/activity` | Read the ordered execution stream |
| `GET` | `/v1/console/threads/:threadId` | Durable decision thread |
| `POST` | `/v1/console/threads/:threadId/arbitrate` | Human arbitration |

Connectors expose the external channel credentials trusted by the platform. The console stores,
tests them and starts a **one-click SSO connection** when the server holds the provider application
credentials (`SLACK_CLIENT_ID/SECRET` for Slack OAuth v2, `TEAMS_APP_ID/BOT_PASSWORD` for admin
consent, `DISCORD_CLIENT_ID/BOT_TOKEN/PUBLIC_KEY` for the bot invite). The public callback
`GET /v1/connectors/:platform/oauth/callback` completes the exchange with a single-use `state` and
never exposes a secret to the browser; manual token entry remains available as an advanced fallback.
Binding a channel to a collective belongs to the separate conversational application.

## Console build

```bash
cd frontend/console-app
npm install
npm run build
```

Vite writes the production app to `backend/web/public/console`, so the existing Express website serves it at `/console/`. During development, `npm run dev` proxies `/v1` to `http://localhost:8787`.

## Multi-instance PostgreSQL deployment

When `DATABASE_URL` is configured, every backend node shares the hybrid agent registry, swarm configurations and runs, the harness session store and the ordered execution stream. PostgreSQL advisory locks serialize agent execution per session across processes. A five-minute lease lets another node retry work after a crashed worker while completed missions remain idempotent.

Use the same database and connector secrets on every instance:

```dotenv
DATABASE_URL=postgres://kayros:***@postgres.internal:5432/kayroslab
KAYROS_REQUIRE_POSTGRES=true
KAYROS_PG_POOL_MAX=10
KAYROS_COLLAB_MESSAGE_LEASE_SECONDS=300
```

The schema is idempotently applied at startup. If production credentials cannot run DDL, apply `core/sql/schema.sql` with a migration role before deployment. Size `KAYROS_PG_POOL_MAX` so the sum of all instance pools stays below the server connection limit.

Deploy at least two identical instances behind the load balancer. Verify `/health`: `persistence` must equal `postgres` and `multiInstanceReady` must be `true`. With `KAYROS_REQUIRE_POSTGRES=true`, a node fails fast instead of serving isolated in-memory state when PostgreSQL is unavailable.


## Nouvelle session : agents ajustés, composés et personnalités réelles

- **Agents proposés** : chaque agent coché peut être vérifié (« Vérifier / modifier ») puis ajusté
  pour la session (nom affiché, rôle, département, séniorité, mission, instructions, contraintes,
  veto, personnalité, règles système désactivées ou réécrites, règles ajoutées). L'ajustement est
  stocké dans `agent_rule_overrides` de la configuration du collectif : le registre du tenant n'est
  pas modifié (`core/swarm.mjs` → `SESSION_OVERRIDE_FIELDS`, `applyIdentityOverrides`).
- **Agents composés** : stockés dans `session_agents` de la configuration (jamais dans le registre
  partagé), donc accessibles aux contributeurs sans fuite vers les autres utilisateurs du tenant.
- **Profil comportemental** (`behavioral_profile` : DISC, ton, style de décision, appétence au risque,
  traits, motivations, directives) : injecté dans le contexte d'exécution de l'agent
  (« Profil comportemental de l'agent »).
- **Seuil de consensus** : bouton « ? » expliquant majorité, unanimité et veto comité exécutif,
  d'après `aggregateSwarmConsensus`.

## Connecteur Crystal Knows

`CrystalKnowsProfileAdapter` (`core/personality.mjs`) suit la Data API v4 documentée
(<https://data.crystalknows.com/llms-full.txt>, Swagger <https://api.crystalknows.com/v4/swagger>) :

| Appel | Usage | Coût |
|---|---|---|
| `GET /v4/profile?email=…\|linkedin_url=…\|full_name=…&company_name=…&job_title=…` | profil existant | 1 crédit sur un résultat (dédupliqué) |
| `GET /v4/content/profile/:id` | contenu détaillé si absent | gratuit |
| `POST /v4/predictions` + `GET /v4/predictions/:job_id` | création asynchrone d'un profil inconnu (opt-in) | 1 crédit si trouvé |

Variables : `CRYSTALKNOWS_API_TOKEN` (clé créée sur <https://data.crystalknows.com/api-keys>, jamais
renvoyée au client), `CRYSTALKNOWS_API_VERSION` (`v4` par défaut, `v1` = ancien endpoint Entreprise
`GET /v1/profiles`), `CRYSTALKNOWS_ALLOW_PREDICTIONS=1` (active les prédictions payantes),
`CRYSTALKNOWS_API_BASE` (surcharge de l'URL, tests). Sans jeton : import d'un export JSON Crystal
(réponse de l'API collée ou fichier) ou saisie d'un type DISC (`profileFromDiscType`). Le profil est
projeté sur les attributs d'agent par `agentAttributesFromProfile` (DISC, archétype, traits 0–100 →
appétence au risque et style de décision, motivations, directives). Consentement explicite requis.


### Validation réelle de la Data API v4 (10/10/2026)

Testée avec un vrai jeton sur les profils de test gratuits (`pjones@`, `drew@`, `bkim@crystalknows.com`) :
`GET /v4/profile` renvoie `200` avec le contenu complet dans `data.content` (sections au format `{ phrase: [...] }`,
`recommendations: { do, dont }`) et des traits comportementaux aux clés capitalisées (`Dominance`, `Risk-Aversion`…),
tous deux gérés par `profileFromCrystalData` (fixture `core/fixtures/crystal-v4-profile-pjones.json`).
Un jeton valide d'une organisation sans l'option « API Access » obtient `401 Organization does not have the API Access feature`
pour tout autre profil (et pour `GET /v4/content/profile/:id`) : la console l'affiche explicitement ; l'import JSON / DISC reste disponible.


### Descriptif de personnalité (`behavioral_profile.descriptif`)

Chaque agent personnifié peut porter un descriptif éditable : `disc_type`, `archetype`, `disc_intensity` (0–100), `overview`, `qualities[]`, `traits` (`risk_aversion`, `skepticism`, `pragmatism`, `pace`, `expressiveness`, `social`, `dominance`, `leniency`, de 0 à 100), `sections` (`communication`, `building_trust`, `motivation`, `driving_action`, `energizers`, `drainers`, `strengths`, `blindspots`, `working_together`, `meetings`, `emails`, `following_up`, `negotiating`, `proposal`, `do`, `dont`) et `source` (`crystalknows`, `disc_template`, `manual` ou `anonymised`).
Le module `core/personality-descriptif.mjs`, partagé entre le serveur et la console, construit le descriptif depuis Crystal v4 (`descriptifFromCrystal`) ou depuis un type DISC (`descriptifFromDisc`), le normalise et l'injecte dans le contexte d'exécution (`descriptifContext`).
