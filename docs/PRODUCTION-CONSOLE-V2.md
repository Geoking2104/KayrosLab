# Console de production V2

Statut : implémenté sur `codex/production-console`, prêt à migrer et déployer après fourniture des identifiants externes.

## Objectif et périmètre

La console est le poste de travail d’un tenant KayrosLab. Elle rend opérants trois parcours qui étaient auparavant absents ou de démonstration : administrer les agents, configurer les connecteurs de messagerie et poursuivre une décision ambiguë dans un fil durable. Les fonctions existantes de salons, essaims, règles, consentement et arbitrage sont conservées.

Un administrateur ou membre `comex` peut créer et modifier un agent, expliciter son rôle, département, séniorité, focus, mission, instructions, contraintes, provider/modèle, outils, connecteurs, règles, métadonnées, profil comportemental, veto et état actif. Un agent désactivé ne peut plus être ajouté à un nouvel essaim ni exécuté.

Une Mission rapide crée toujours un dossier et, lorsqu’un verdict est conditionnel ou qu’une hypothèse n’est pas vérifiée, un fil `needs_clarification`. Le fil contient la question initiale, les contributions individuelles, preuves, objections, conditions, synthèse et verdict. Il formule des demandes ciblées, conserve les réponses humaines et relance le même collectif avec tout l’historique. L’arbitrage humain accepte le consensus, réévalue ou justifie une dérogation au veto.

## Architecture

```text
React /console (hash routes)
  └─ API Fastify authentifiée /v1/console/*
       ├─ SwarmService + AgentRegistry
       ├─ HybridAgentGateway
       │    └─ fils, messages, exécutions, arbitrages
       ├─ ConnectorConfigurationService
       │    └─ coffre AES-256-GCM côté serveur
       └─ PostgreSQL
            ├─ registre/essaims/runs existants
            ├─ collaboration rooms/events/messages existants
            ├─ kayros_decision_threads (+ messages)
            └─ kayros_connector_configurations
```

Le frontend ne reçoit jamais les secrets. Fastify chiffre l’objet d’identifiants avant persistance et ne renvoie que les noms de champs configurés, une empreinte interne et l’état. Les webhooks dynamiques utilisent un `connection_id` UUID puis vérifient obligatoirement la signature Slack/Discord ou le JWT Bot Framework Teams avant tout dispatch. Le `tenant_id` résolu côté serveur est imposé au gateway.

## Modèle de données et migration

La migration additive et transactionnelle est `core/sql/migrations/20260828_console_v2.sql`. Le schéma idempotent de démarrage `core/sql/schema.sql` contient les mêmes objets :

- `kayros_decision_threads` : tenant, salon, run racine/courant, statut, question et snapshot JSONB ;
- `kayros_decision_thread_messages` : flux ordonné de questions, runs, demandes de précision, réponses et arbitrages ;
- `kayros_connector_configurations` : une connexion par tenant/plateforme, paramètres non secrets, secret opaque chiffré, état et résultat du dernier test.

Les tables et données existantes ne sont ni supprimées ni réécrites. Sur un compte de production sans droit DDL, exécuter d’abord la migration avec le rôle de migration. Le backend continue d’appliquer le schéma complet de façon idempotente au démarrage.

## Contrats API

Toutes les routes console exigent l’authentification du tenant. Les mutations d’agents/connecteurs exigent `comex` ou `admin`.

| Méthode | Route | Résultat |
|---|---|---|
| `GET` | `/v1/console/overview` | résumé, capacités, agents, salons, connecteurs et fils |
| `GET/POST` | `/v1/console/agents` | liste/création d’agents |
| `PATCH` | `/v1/console/agents/:agentId` | modification complète ou activation |
| `POST` | `/v1/console/agents/:agentId/crystal` | import consenti d’un profil Crystal |
| `GET` | `/v1/console/connectors` | états publics des trois connecteurs |
| `PUT` | `/v1/console/connectors/:platform` | chiffrement et sauvegarde d’identifiants/paramètres |
| `PATCH` | `/v1/console/connectors/:platform/enabled` | activation/désactivation |
| `POST` | `/v1/console/connectors/:platform/test` | test officiel de connectivité |
| `GET` | `/v1/console/threads` | fils du tenant |
| `GET` | `/v1/console/threads/:threadId` | historique complet |
| `POST` | `/v1/console/threads/:threadId/messages` | réponse humaine et relance contextuelle |
| `POST` | `/v1/console/threads/:threadId/arbitrate` | arbitrage final |

Les webhooks publics par connexion sont `POST /v1/connectors/{slack|discord|teams}/configured/:connectionId`. Ils sont publics uniquement au sens HTTP : la preuve cryptographique de la plateforme reste obligatoire.

## Sécurité et confidentialité

### Coffre des connecteurs

Définir `KAYROS_CONNECTOR_ENCRYPTION_KEY` avec exactement 32 octets encodés en base64, par exemple via `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`, puis l’injecter depuis le gestionnaire de secrets de l’hébergeur. Ne jamais la committer. La perte de cette clé rend les secrets existants irrécupérables ; sa rotation nécessite un déchiffrement/réchiffrement contrôlé avant bascule.

Les tests de connectivité utilisent uniquement les APIs officielles : Slack `auth.test`, Discord `users/@me`, Microsoft OAuth Bot Framework. Les erreurs sont expurgées avant exposition et aucun token n’est renvoyé au navigateur.

### Crystal Knows

L’intégration appelle uniquement l’API documentée `https://api.crystalknows.com/v1/profiles` avec un Bearer token serveur. Elle recherche par email ou URL LinkedIn fournie ; elle ne visite ni ne scrape LinkedIn ou Crystal. L’écran impose une confirmation de consentement avant l’appel et le backend exige littéralement `consent_confirmed: true`.

Le profil est facultatif et réservé à l’adaptation de communication, au développement et à la simulation comportementale. Il ne doit pas servir à une décision d’embauche, crédit, logement, assurance ou autre décision à effet matériel. Le token reste dans `CRYSTALKNOWS_API_TOKEN`; sans token, la capacité est annoncée indisponible et aucun appel n’est tenté. Politique d’entreprise requise : base légale, information de la personne, durée de conservation, droit d’accès/suppression et journal d’audit.

## Parcours UX et états

- **Agents** : liste, état actif, création/édition dans un panneau, champs structurés et aperçu des règles effectives ; import Crystal distinct et consenti.
- **Réglages** : carte par plateforme avec `à configurer`, `à tester`, `connecté`, `erreur` ou `désactivé`; sauvegarde masquée, test explicite, URL webhook copiable et rappel de rattachement du salon.
- **Salons** : création à partir des seuls agents actifs et identifiant externe explicite.
- **Mission rapide** : sélection du salon, question et contexte ; ouverture automatique du dossier/fils.
- **Décisions** : timeline durable, contributions et objections visibles, questions ciblées, réponse humaine, nouvelle exécution du même collectif, puis arbitrage.

La mise en page reste un workbench sobre, clavier-compatible, avec rail latéral sur grand écran et grille/commandes empilées sous 840 et 560 px. La largeur minimale supportée est 320 px.

## Variables d’environnement

```dotenv
DATABASE_URL=postgres://...
KAYROS_REQUIRE_POSTGRES=true
KAYROS_CONNECTOR_ENCRYPTION_KEY=<base64-32-octets>
KAYROS_PUBLIC_API_URL=https://api.kayroslab.com
CRYSTALKNOWS_API_TOKEN=
VITE_API_BASE_URL=https://api.kayroslab.com
```

Les anciens secrets `SLACK_*`, `DISCORD_*` et `TEAMS_*` restent supportés comme configuration d’environnement globale. Les connexions saisies dans la console sont isolées par tenant et prioritaires pour leurs webhooks dynamiques.

## Critères d’acceptation

1. Un admin crée, modifie et désactive un agent ; les champs sont persistés et un agent désactivé n’est plus exécutable.
2. Aucun secret de connecteur n’apparaît dans une réponse API, un log applicatif, le bundle frontend ou le dépôt ; la sauvegarde échoue fermée sans clé de coffre.
3. Chaque connecteur peut être sauvegardé, testé, activé/désactivé, associé à un salon et reçoit ses événements via une URL signée propre à la connexion.
4. Un verdict conditionnel produit un fil durable lié au salon et au dossier avec questions ciblées, historique, réponse humaine et relance du même essaim.
5. Les contributions, preuves, objections, conditions, synthèse, verdict et arbitrage restent lisibles après rechargement et redémarrage avec PostgreSQL.
6. L’import Crystal est impossible sans token serveur et consentement ; aucun scraping ni appel réel n’est effectué par les tests.
7. Les tests unitaires, Fastify, PostgreSQL, le contrat UI et le build Vite réussissent ; le workflow Pages publie `/console/`.

## Déploiement et contrôles

1. Sauvegarder PostgreSQL, appliquer `core/sql/migrations/20260828_console_v2.sql`, puis déployer une seule instance canari.
2. Fournir les variables via le coffre de production et vérifier `/health` (`persistence=postgres`, `multiInstanceReady=true`).
3. Construire la console avec `npm ci && npm run build` dans `frontend/console-app`; le résultat va dans `backend/web/public/console`.
4. Créer/tester les connexions dans Réglages, reporter leurs URLs dans les consoles officielles, puis rattacher les identifiants de salons.
5. Tester une mission conditionnelle, répondre dans le fil, relancer puis arbitrer ; étendre ensuite à toutes les instances.

Les seules étapes non automatisables sans autorisation externe sont l’obtention/rotation des credentials Slack, Discord, Teams et Crystal, la configuration de leurs consoles officielles et le déploiement sur l’infrastructure de production.
