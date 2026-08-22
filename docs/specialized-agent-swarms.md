# Specialized Agent Swarms v6

Cette couche étend l'orchestrateur KayrosLab avec des panels métiers
configurables. Elle ne remplace ni le pipeline agentique existant, ni les gates
de gouvernance : elle produit un dossier contradictoire qui doit être arbitré
par un humain.

Un swarm peut mélanger librement :

- des agents système `system_predefined` ;
- des agents créés par l'utilisateur `user_defined` ;
- des agents système enrichis/modifiés `hybrid_modified`, qui conservent leur
  `base_agent_id` et ajoutent règles ou profil humain.

## Profils de personnalité

Le profil v6 couvre l'identité assignée, les URLs LinkedIn/Crystal, DISC,
Ennéagramme, Myers-Briggs, archétype, motivations, scepticisme, contexte
professionnel, déclencheurs de décision/stress et directives de communication.

La provenance de chaque fragment est conservée dans `profile_sources` avec le
mode d'import, la date, l'auteur, les champs importés et le consentement. Une
personnalité ne peut être assignée ou simulée sans `consent_confirmed: true`.

La réaction produite est toujours nommée
`simulated_stakeholder_feedback`. Le prompt interdit de la présenter comme une
citation réelle et interdit d'inventer des faits privés.

### Imports autorisés

- **LinkedIn** : `LinkedInSelfProfileAdapter` appelle l'API officielle
  `GET /v2/me`. Elle est limitée au membre authentifié et refuse une URL visant
  une autre personne. LinkedIn n'alimente que l'identité et le contexte
  professionnel ; aucun DISC n'est inféré depuis ces données.
- **Crystal Knows** : `CrystalKnowsProfileAdapter` appelle officiellement
  `GET /v1/profiles` par `linkedin_url` ou `email`, puis mappe DISC, archétype,
  motivations, drainers et recommandations de communication.
- **Export structuré** : les deux sources acceptent `profile_data` lorsque
  l'utilisateur fournit un export autorisé et qu'aucun jeton serveur n'est
  configuré.

Variables serveur facultatives : `LINKEDIN_ACCESS_TOKEN` et
`CRYSTALKNOWS_API_TOKEN`. Elles ne sont jamais renvoyées au client.

## Modèle de règles

Un agent possède trois couches effectives :

1. règles système proposées (`active`, `overridden`, `disabled`) ;
2. règles ajoutées par l'utilisateur ;
3. remplacements explicites de règles système, identifiés par `rule_id`.

Les overrides attachés à une configuration de swarm sont isolés : ils ne
modifient pas la définition globale de l'agent. L'API renvoie à la fois la
configuration originale, `effective_rules` et le contexte réellement injecté
au modèle.

## Contrat de décision

Chaque agent rend un objet structuré contenant : verdict, raison principale,
opportunités, risques critiques, métriques, mitigations et hypothèses non
vérifiées. Un résultat sans verdict parsable est dégradé en
`CONDITIONAL_GO`, jamais promu silencieusement en `GO`.

Seuils disponibles :

- `unanimous` : tous les agents doivent rendre `GO` ;
- `majority` : majorité stricte ;
- `veto_power_csuite` : un `NO_GO` exécutif bloque, sinon majorité stricte.

Un agent marqué `veto_power: true` bloque quel que soit le seuil. Dans tous
les cas, le consensus est consultatif et le run reste
`pending_human_arbitration`.

## API

| Méthode | Route | Fonction |
|---|---|---|
| `GET` | `/v1/swarm/agents` | Liste des agents et règles effectives |
| `POST` | `/v1/swarm/agents` | Création d'un agent utilisateur |
| `PATCH` | `/v1/swarm/agents/:agentId/rules` | Désactivation, remplacement ou ajout de règles |
| `POST` | `/v1/swarm/agents/:agentId/personality/import` | Importe/fusionne LinkedIn, Crystal ou un profil manuel consenti |
| `POST` | `/v1/swarm/configurations` | Création d'une configuration |
| `POST` | `/v1/swarm/configurations/:swarmId/run` | Exécution parallèle du panel |
| `GET` | `/v1/swarm/runs/:runId` | Résultat structuré et audit |
| `GET` | `/v1/swarm/runs/:runId/dossier` | Dossier Markdown |
| `POST` | `/v1/swarm/runs/:runId/arbitrate` | Acceptation, override justifié ou réévaluation |

Toutes les routes exigent une session authentifiée et dérivent le tenant du
compte, jamais du corps de requête. L'arbitrage exige en plus le rôle `comex`.
`override_veto` impose une justification et une décision explicite `GO` ou
`CONDITIONAL_GO`.
