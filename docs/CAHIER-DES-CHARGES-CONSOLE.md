# Cahier des charges : Correction du parcours console KayrosLab

| Champ | Valeur |
| --- | --- |
| Produit | KayrosLab Console |
| Document | Cahier des charges fonctionnel et non fonctionnel |
| Date | 5 octobre 2026 (création) ; 6 octobre 2026 (révision) (Europe/Paris) |
| Révision | **6 octobre 2026 (Europe/Paris) : re-audit live** (état B1–B8, nouveaux bloqueurs N1–N5, agents hybrides personnifiés, question Rust). Révision précédente : 5 octobre 2026 après-midi : extension du périmètre (connecteurs, CrystalKnows / LinkedIn, impersonator / swarm) |
| Sources | Audit live du 5 octobre 2026 et re-audit live du 6 octobre 2026 (parcours réels sur la production) |
| Compte de test | `kayros-audit-…@example.com` (rôle contributeur, tenant `default`) |
| Surfaces observées | `https://www.kayroslab.com/console/` (SPA), API `https://api.kayroslab.com` (VPS OVH), SSO `https://sso.kayroslab.com` |
| Fichiers d’ancrage | `frontend/console-app/src/App.jsx` ; `backend/fastify/routes/console.mjs` (`manager()` L96, routes sessions / run / arbitrate, crystal, impersonators, impersonator-teams ; quota sessions L363-365) ; `backend/fastify/routes/auth-routes.mjs` (L80-87) ; `auth.mjs` (L127) ; `context.mjs` (L498-499, `bindEngineToServer`) ; `hybrid-agent-gateway.mjs` (statut, L151-159) ; `swarm.mjs` (L256) ; `specialized-agent.mjs` (L27) |
| Statut | À traiter (aucun commit ni PR associé à ce document) |

Ce document ne contient que des exigences dérivées de l’audit live du 5 octobre 2026, du re-audit live du 6 octobre 2026 et des **signaux** observés lors de ces audits sur des surfaces **non exercées bout-en-bout**. Aucun bug non observé n’est inventé : pour ces surfaces, les exigences se limitent à rendre opérable, vérifier et documenter le parcours.

---

## Re-audit du 6 octobre 2026

**Contexte.** Aucun commit console n’a été poussé depuis le 5 octobre 2026 : les écarts constatés par rapport à l’audit initial ne résultent d’aucun correctif livré.

### État des bloqueurs B1–B8 au 6 octobre 2026

| Id | Statut au 6/10 | Constat |
| --- | --- | --- |
| B1 | Toujours présent | Arbitrage en **403** « rôle comex ou admin requis » pour un contributeur ; les boutons d’arbitrage restent actifs. |
| B2 | Toujours présent | Réponses d’agents `[mock]`, verdict non parsable, boucle de clarification (`needs_clarification`). Cause probable : N5 (hypothèse à vérifier). |
| B3 | Corrigé ou non reproduit | La vue `#activity` change bien en UI le 6/10. EF-05 et S4 sont conservés comme tests de non-régression. |
| B4 | **Aggravé** | Lecture **et** écriture croisées : un contributeur peut lancer une mission et répondre aux fils dans la session d’un autre compte (`/run` → **200**, `/messages` → **202**). Voir N2. |
| B5 | Toujours présent | `SyntaxError` « Unexpected token 'var' » dans le script inline de configuration Tailwind de la démo. |
| B6 | Non retestable | Pas de constat le 6/10. |
| B7 | Toujours présent | SMTP non configuré. |
| B8 | Toujours présent | `/workbench` répond **404**. |

**Note `/health` (6/10).** `embedModel: bge-m3` ; `llm.provider: mistral` (live). Le provider LLM serveur est donc réel, alors que les agents de mission restent en `[mock]` (voir N5).

### Synthèse des ajouts de la révision

- Nouveaux bloqueurs **N1–N5** : §2.6.
- Constat **agents hybrides personnifiés** (CrystalKnows / LinkedIn / impersonators) : §2.7.
- Nouvelles exigences **EF-21 à EF-29**, **ENF-08 / ENF-09**, critères **CA-12 à CA-14**, scénarios **S13 à S19**, question **Q10** (préférence Rust).
- Lots : N1, N2 et N5 ajoutés au **Lot A** ; N3, N4 et la politique de rôles agents au **Lot B** ; personnalité des agents console au **Lot D**.

---

## 1. Objet et périmètre

### 1.1 Objet

Corriger le parcours console KayrosLab afin qu’un utilisateur authentifié avec le rôle **contributeur** puisse aller de l’inscription à une **décision arbitrée**, sans rencontrer les bloqueurs constatés en production le 5 octobre 2026.

### 1.2 Périmètre inclus

- SPA console : `www.kayroslab.com/console/`
- API console / auth : `api.kayroslab.com` (routes console, auth, health)
- SSO : `sso.kayroslab.com` (accès login / register déjà fonctionnel)
- Démo publique : `kayroslab-complete-with-ai-agents.html` (bloqueur d’étape 1/8 observé)
- Workbench associé à la PR #33 (route `/workbench` en 404 en production)
- **Connecteurs** Slack, Discord, Teams (configuration / OAuth connecteurs), signalés non configurés en audit (voir §2.4)
- **CrystalKnows / LinkedIn** personality import (`capabilities.crystal_knows: false` en audit)
- **Impersonator / swarm avancés** (routes et UI présentes, parcours non exercé bout-en-bout en audit)

**Avertissement périmètre étendu.** Les trois derniers items n’ont **pas** été validés bout-en-bout lors de l’audit live du 5 octobre 2026. Seuls des signaux d’état / de présence ont été relevés (overview.connections, capabilities, routes `console.mjs`, UI Settings). Les exigences associées (EF-15 et suivantes) ne prétendent pas corriger des bugs non observés.

### 1.3 Périmètre exclu

Voir section 6 (Hors périmètre).

---

## 2. Contexte / état actuel (parcours As-Is)

### 2.1 Infrastructure vérifiée

| Élément | Observation audit |
| --- | --- |
| Frontend console | SPA déployée sur `www.kayroslab.com/console/` |
| API | `api.kayroslab.com` sur VPS OVH |
| SSO | `sso.kayroslab.com` |
| Compte de test | `kayros-audit-…@example.com`, rôle **contributeur**, tenant **default** |

### 2.2 Ce qui marche (As-Is positif)

1. Accès landing puis console.
2. Login / register immédiat via SSO.
3. Création de session possible (5 octobre ; **le 6 octobre, impossible pour un nouvel utilisateur** du tenant `default` : voir N1).
4. Lancement de mission aboutit en environ **8 secondes**.

### 2.3 Bloqueurs constatés (As-Is négatif)

| Id | Bloqueur | Observation concrète |
| --- | --- | --- |
| B1 | Arbitrage 403 | L’appel `POST /v1/console/threads/:threadId/arbitrate` renvoie **403** avec le message « rôle comex ou admin requis » pour un contributeur. Les boutons d’arbitrage restent actifs dans l’UI. Ancrage backend : `manager()` dans `console.mjs` (L96) gate l’arbitrage aux rôles `comex` et `admin`. |
| B2 | Agents mock / verdicts non parsables | Les agents tournent en **[mock]** ; les verdicts ne sont pas parsables ; le statut bascule systématiquement en `needs_clarification`. |
| B3 | Hash `#activity` | Le menu « Décisions » et l’URL passent à `#activity`, mais le **contenu affiché ne change pas**. |
| B4 | Isolation tenant / sessions | Dans l’espace **ESPACE DEFAULT**, le contributeur voit des sessions d’autres utilisateurs (exemple observé : session de `yeye@yeye.com` intitulée « Échange - Nietsche »). |
| B5 | Démo publique cassée | Sur `kayroslab-complete-with-ai-agents.html`, le parcours se bloque à l’étape **1/8** (format semantic map + erreur JS `Unexpected token 'var'`). Les appels démo répondent avec `provider: mock` et « Incomplete response format ». |
| B6 | Session créée non sélectionnée ; alerte démo | Après création, la session n’est pas auto-sélectionnée. Une alerte native apparaît sur démo vide. |
| B7 | SMTP non configuré | Health / config : `smtp.configured: false` (reset mot de passe inutilisable en conditions réelles). |
| B8 | Workbench non déployé | La PR #33 (workbench) n’est pas déployée ; `/workbench` répond **404**. |

> Statut de ces bloqueurs au 6 octobre 2026 : voir la section « Re-audit du 6 octobre 2026 » en tête de document (B4 aggravé, B3 corrigé ou non reproduit, B6 non retestable, autres toujours présents).

### 2.4 Surfaces présentes mais non exercées bout-en-bout (signaux uniquement)

Ces surfaces sont **dans le périmètre** à la demande du propriétaire. Elles n’ont **pas** fait l’objet d’un parcours bout-en-bout réussi ni d’un diagnostic de bug fonctionnel le 5 octobre 2026. Seuls les signaux suivants ont été observés.

| Surface | Signaux observés (audit 5 oct 2026) | Non observé (donc non affirmé) |
| --- | --- | --- |
| Connecteurs Slack / Discord / Teams | `overview.connections` : statut `not_configured` pour slack, discord, teams ; `capabilities.connector_oauth` : slack / discord / teams à `false` ; `encrypted_connector_storage: true` ; UI Settings console exposant les connecteurs | Aucun essai de configuration OAuth, de test de connecteur, ni d’envoi réel vers un canal |
| CrystalKnows / LinkedIn personality import | `capabilities.crystal_knows: false` ; routes crystal / personality présentes dans `console.mjs` ; UI Settings | Aucun import CrystalKnows ni LinkedIn exécuté bout-en-bout |
| Impersonator / swarm avancés | Routes `impersonators` / `impersonator-teams` dans `console.mjs` ; UI associée dans la console | Aucune création d’impersonator ni de swarm avancé exercée jusqu’à une mission / un arbitrage |

Conséquence pour le cahier des charges : les exigences EF-15 à EF-20 demandent de **rendre opérable**, **vérifier** et **documenter** ces parcours, sans présumer de défaillances non mesurées.

**Mise à jour 6 octobre 2026.** Les surfaces CrystalKnows / LinkedIn et impersonator ont été partiellement exercées lors du re-audit : constat détaillé en §2.7 (exigences EF-26 à EF-29).

### 2.5 Synthèse As-Is

Le parcours d’entrée (landing, auth, création de session, lancement de mission) est opérationnel. Le parcours de **sortie décisionnelle** (verdicts fiables, arbitrage, navigation Décisions, isolation des sessions, reset mot de passe, démo publique, workbench) est rompu pour un contributeur sur le tenant `default`. Les surfaces connecteurs, CrystalKnows / LinkedIn et impersonator / swarm sont **visibles** (signaux ci-dessus) mais **non validées** bout-en-bout.

**Au 6 octobre 2026**, le parcours d’entrée est lui-même rompu pour un nouvel utilisateur (création de session refusée, N1), l’isolation est rompue en écriture (N2), et les agents hybrides personnifiés ne sont pas utilisables de bout en bout (§2.7).

### 2.6 Nouveaux bloqueurs (re-audit du 6 octobre 2026)

| Id | Priorité | Bloqueur | Observation / ancrage | Exigences |
| --- | --- | --- | --- | --- |
| N1 | P0 | Création de session impossible pour un nouvel utilisateur | La création de session renvoie **403** « 3 sessions maximum par utilisateur ». Le code compte les sessions **du tenant** (`listRooms({tenantId})`, `console.mjs` L363-365) et non celles de l’utilisateur ; le tenant `default` en compte déjà 3. | EF-22 |
| N2 | P0 | Écriture croisée entre utilisateurs d’un même tenant | Un contributeur peut lancer une mission (`/run` → 200) et répondre aux fils (`/messages` → 202) dans la session d’un autre compte. Aggravation de B4 (lecture et écriture). | EF-21, ENF-08 |
| N3 | P1 (sécurité) | `tenantId` client accepté à l’inscription | `/v1/auth/register` accepte un `tenantId` fourni par le client (`auth-routes.mjs` L80-87, `auth.mjs` L127). Ce champ doit être refusé ou ignoré côté serveur. | EF-25, ENF-08 |
| N4 | P1 | Tout `CONDITIONAL_GO` repasse en clarification | Dans `hybrid-agent-gateway.mjs`, le statut est calculé par `verdict === 'CONDITIONAL_GO' \|\| questions.length` : tout résultat `CONDITIONAL_GO` repasse en `needs_clarification` et n’atteint **jamais** `awaiting_arbitration`. | EF-24 |
| N5 | P0 | Swarm resté sur un LLM local absent (**cause probable de B2, hypothèse à vérifier**) | Le moteur est créé avec `sovereignty: 'local'` (`context.mjs` L498-499). `bindEngineToServer` remplace le LLM du moteur, de l’orchestrateur et des agents, mais **pas** `engine.swarm.llm`, qui reste sur Ollama `llama3.2` (non installé) → fallback mock. | EF-23, ENF-09 |

### 2.7 Agents hybrides personnifiés (CrystalKnows / LinkedIn / impersonators) : constat du 6 octobre 2026

Ce constat complète les signaux du §2.4 (lignes CrystalKnows / LinkedIn et impersonator / swarm) et les exigences EF-17 à EF-20.

**Pour un contributeur.** Les 7 routes suivantes répondent **403**, car `manager()` est évalué **avant** la validation de la requête :

| Route | Réponse contributeur (6/10) |
| --- | --- |
| `POST /agents` | 403 |
| `PATCH /agents/:id` | 403 |
| `POST /agents/:id/personality` | 403 |
| `POST /agents/:id/crystal` | 403 |
| `PUT /agents/:id/human-profile` | 403 |
| `POST /impersonators` | 403 |
| `POST /impersonator-teams` | 403 |

L’UI affiche pourtant les boutons « Agent hybride », « Agent impersonator » et « Équipe d’impersonators », et n’annonce le refus qu’**après** la saisie du formulaire et le recueil du consentement.

**Même avec un rôle comex :**

- les agents tournent en mock (cf. B2 / N5) ;
- le tenant est plein (cf. N1) ;
- les agents créés en console sont enregistrés avec `agent_type: 'user_defined'` (`swarm.mjs` L256), alors que la simulation de personnalité ne s’active automatiquement que pour `hybrid_modified` (`hybrid-agent-gateway.mjs` L151-159, `specialized-agent.mjs` L27) ;
- `personality_simulation_enabled` est absent de l’UI de session et n’est jamais transmis par `impersonator-teams` ;
- le compteur « Profils hybrides » ne compte pas ces agents ;
- `capabilities.crystal_knows` reste `false` en production.

**Conséquence.** En l’état, un agent créé depuis la console n’obtient pas automatiquement la simulation de personnalité, et aucune option d’UI ne permet de l’activer. Exigences associées : EF-26 à EF-29 (plus EF-17 / EF-18 pour CrystalKnows).

---

## 3. Objectifs et critères d’acceptation du parcours To-Be

### 3.1 Objectif métier

Permettre à un **contributeur** nouvellement inscrit d’obtenir une **décision arbitrée** sur une mission lancée dans sa propre session, sans voir les données d’autres utilisateurs, sans erreur 403 trompeuse, et avec des verdicts exploitables (hors mock non déclaré ou mock explicitement accepté pour la démo).

### 3.2 Parcours To-Be cible (contributeur)

1. Inscription / connexion (SSO).
2. Arrivée dans la console sur un espace isolé (sessions du seul utilisateur, ou règle d’isolation explicite validée).
3. Création de session : la session créée est **sélectionnée automatiquement**.
4. Lancement de mission : exécution aboutie avec verdicts **parsables**.
5. Consultation de l’historique via `#activity` (Décisions) : le contenu correspond au menu.
6. Arbitrage : soit le contributeur peut arbitrer selon la règle produit retenue, soit l’UI désactive clairement les actions et explique le rôle requis (plus de 403 « silencieux » côté boutons actifs).
7. Optionnellement : reset mot de passe fonctionnel si SMTP est dans le lot livré ; démo publique franchit l’étape 1/8 ; `/workbench` disponible si le lot PR #33 est livré.

### 3.3 Critères d’acceptation globaux

| Id | Critère | Mesure |
| --- | --- | --- |
| CA-1 | Parcours contributeur bout-en-bout | Un compte contributeur neuf crée une session, lance une mission, obtient un verdict parsable, puis finalise un arbitrage **ou** voit une UI cohérente avec la politique de rôles (pas de bouton actif menant à un 403). |
| CA-2 | Isolation | Le contributeur ne voit aucune session créée par un autre utilisateur (cas de non-régression : absence de la session « Échange - Nietsche » / `yeye@yeye.com` dans sa liste). |
| CA-3 | Navigation Décisions | Un clic sur « Décisions » (`#activity`) affiche la page Décisions (contenu distinct de la page précédente). |
| CA-4 | UX session | Après création, la session créée est la session active du workbench mission. |
| CA-5 | Pas d’alerte native injustifiée | Aucune `alert` native sur démo vide dans le scénario console corrigé (comportement à remplacer par un message UI contrôlé, si le cas se représente). |
| CA-6 | Démo publique (si dans le lot) | `kayroslab-complete-with-ai-agents.html` dépasse l’étape 1/8 sans `Unexpected token 'var'`. |
| CA-7 | SMTP (si dans le lot) | `smtp.configured: true` en production et flux forgot/reset mot de passe délivre un e-mail. |
| CA-8 | Workbench (si dans le lot) | `GET /workbench` n’est plus 404 (déploiement de la PR #33 ou équivalent). |
| CA-9 | Connecteurs (si Lot D) | Au moins un connecteur parmi Slack, Discord, Teams passe de `not_configured` à un état configuré / testé documenté, ou le produit documente clairement les prérequis OAuth manquants (`connector_oauth: false`). |
| CA-10 | Personality import (si Lot D) | Le parcours CrystalKnows et/ou LinkedIn est soit opérable avec `crystal_knows` cohérent, soit explicitement documenté comme indisponible lorsque `capabilities.crystal_knows: false`. |
| CA-11 | Impersonator / swarm (si Lot D) | Un parcours documenté crée un impersonator (ou une impersonator-team) puis l’associe à une session, sans prétendre à des bugs non observés. |
| CA-12 | Quota et isolation en écriture (re-audit 6/10) | Un compte contributeur neuf crée sa première session sur le tenant `default` déjà chargé (N1) ; ses appels `/run` et `/messages` sur la session d’un autre compte sont refusés (N2). |
| CA-13 | LLM serveur et sortie de boucle (re-audit 6/10) | Tous les composants d’une mission (moteur, orchestrateur, agents, swarm) utilisent le provider serveur annoncé par `/health` : aucune réponse `[mock]` quand `llm.provider` est un LLM live (N5) ; un verdict `CONDITIONAL_GO` atteint `awaiting_arbitration` (N4). |
| CA-14 | Agents hybrides personnifiés (re-audit 6/10) | Aucune action agents / impersonators n’aboutit à un 403 après saisie et consentement ; un agent console avec profil consenti a sa personnalité simulée en mission et est compté dans « Profils hybrides ». |

---

## 4. Exigences fonctionnelles

Légende priorités : **P0** bloqueur parcours décisionnel ou sécurité d’isolation ; **P1** UX / cohérence produit et surfaces étendues à rendre opérables ; **P2** surfaces satellites (démo, SMTP, workbench, activation connecteurs / imports) hors chemin critique console si le lot principal est priorisé autrement.

Colonne « Bloqueur » : B1-B8 = bloqueurs exercés ; **SX** = surface signalée non exercée (§2.4), sans bug inventé ; **N1-N5** = nouveaux bloqueurs du re-audit du 6 octobre 2026 (§2.6) ; **AH** = constat agents hybrides personnifiés du 6 octobre 2026 (§2.7).

| Id | Priorité | Bloqueur | Exigence |
| --- | --- | --- | --- |
| EF-01 | P0 | B1 | **Cohérence rôle / arbitrage.** Soit l’endpoint `POST /v1/console/threads/:threadId/arbitrate` autorise le rôle nécessaire au parcours To-Be contributeur (politique produit à trancher, voir section 9), soit l’UI (boutons « Accepter le consensus », « Passer sous conditions », « Demander une réévaluation » dans `App.jsx`) est désactivée / masquée pour un contributeur avec message explicite aligné sur `manager()` (« rôle comex ou admin requis »). Interdit : boutons actifs qui produisent un 403. |
| EF-02 | P0 | B1 | **Feedback d’erreur d’arbitrage.** Si un 403 survient encore, l’UI affiche le motif serveur de façon lisible (pas seulement l’échec réseau) et ne laisse pas croire que l’action a réussi. |
| EF-03 | P0 | B2 | **Verdicts parsables.** Une mission lancée depuis la console produit des réponses d’agents dont le format est accepté par le parseur de verdicts ; le statut ne doit plus être systématiquement `needs_clarification` pour une mission nominale du parcours de test. |
| EF-04 | P0 | B2 | **Transparence du provider.** Si le provider effectif est `mock`, l’UI console l’indique clairement (déjà visible en `[mock]` côté agents) et le parcours To-Be documente si le mock est acceptable pour l’acceptation ou si un provider LLM réel est requis (voir questions ouvertes). |
| EF-05 | P0 | B3 | **Navigation `#activity`.** Lorsque l’URL / le menu passe à « Décisions » (`#activity`), le contenu principal affiche la page Décisions (liste des threads / dossiers), et non la page précédente. |
| EF-06 | P0 | B4 | **Isolation des sessions.** La liste des sessions d’un utilisateur connecté ne contient que les sessions qu’il est autorisé à voir selon la règle d’isolation retenue (au minimum : pas de sessions d’autres utilisateurs du même tenant `default` dans le scénario audit). |
| EF-07 | P0 | B4 | **Isolation des threads / activité.** Les threads et l’activité exposés à l’utilisateur respectent la même règle d’isolation que les sessions (pas de fuite croisée du type session `yeye@yeye.com`). |
| EF-08 | P1 | B6 | **Auto-sélection de session.** Après création réussie d’une session, cette session devient la session sélectionnée dans le sélecteur de mission (plus besoin de la choisir manuellement pour lancer tout de suite). |
| EF-09 | P1 | B6 | **Remplacement de l’alerte native.** Le cas « démo vide » ne doit plus s’appuyer sur une alerte native du navigateur ; un message UI dans la console (ou absence d’action) est requis. |
| EF-10 | P1 | B5 | **Démo publique étape 1/8.** Corriger le blocage de `kayroslab-complete-with-ai-agents.html` à l’étape 1/8 lié au format semantic map et à l’erreur JavaScript `Unexpected token 'var'` (re-audit 6/10 : erreur localisée dans le script inline de configuration Tailwind de la démo). |
| EF-11 | P1 | B5 | **Réponses démo exploitables.** Les appels `POST /v1/demo/chat` utilisés par la démo ne doivent plus boucler sur « Incomplete response format » avec `provider: mock` de façon à bloquer l’étape 1/8. |
| EF-12 | P2 | B7 | **SMTP pour reset mot de passe.** Configurer le relais SMTP en production de sorte que `smtp.configured` soit `true` et que `POST /v1/auth/password/forgot` (auth-routes) puisse envoyer l’e-mail de reset. |
| EF-13 | P2 | B8 | **Déploiement workbench.** Déployer la PR #33 (ou livrable équivalent) afin que `/workbench` ne réponde plus 404. |
| EF-14 | P1 | B1, B2 | **Parcours contributeur documenté.** Le produit expose (UI ou doc opérationnelle livrée avec le lot) le rôle minimal pour arbitrer et le provider attendu pour des verdicts non mock. |
| EF-15 | P1 | SX | **Connecteurs : rendre opérable ou documenter.** Pour Slack, Discord et Teams, rendre le parcours Settings → configuration (et OAuth si applicable) opérable jusqu’à un état autre que `not_configured`, **ou** documenter explicitement pourquoi `capabilities.connector_oauth` reste à `false` et quelles variables / étapes manquent. Aucun échec OAuth non observé n’est inventé. |
| EF-16 | P2 | SX | **Connecteurs : vérifier le test de connexion.** Après configuration, exécuter et consigner le test de connecteur exposé par l’API / l’UI (route test connecteur dans `console.mjs`), et aligner le statut affiché dans `overview.connections` avec l’état réel. Prérequis : `encrypted_connector_storage: true` déjà observé. |
| EF-17 | P1 | SX | **CrystalKnows / LinkedIn : rendre le personality import vérifiable.** Rendre opérable le parcours d’import personality (CrystalKnows et/ou LinkedIn) depuis l’UI Settings / agents, **ou** documenter l’indisponibilité lorsque `capabilities.crystal_knows: false`, avec les prérequis de configuration attendus. Pas d’affirmation de bug d’import non exercé. |
| EF-18 | P2 | SX | **CrystalKnows / LinkedIn : documenter le résultat d’un import réussi.** Lorsqu’un import est possible, documenter le résultat attendu sur l’agent (champs personality / human_profile visibles en console) et le rôle requis (`manager()` / comex-admin si applicable). |
| EF-19 | P1 | SX | **Impersonator : rendre opérable la création.** Rendre vérifiable le parcours de création d’un impersonator via les routes / UI console (`impersonators`), jusqu’à l’apparition de l’agent dans la liste du tenant, puis documenter les consentements et champs obligatoires. Aucun incident d’exécution non observé n’est inventé. |
| EF-20 | P2 | SX | **Impersonator-teams / swarm avancé : vérifier et documenter.** Rendre opérable ou documenter la création d’une `impersonator-team` / collective avancé, son rattachement à une session, et le lancement d’une mission de contrôle (smoke) une fois le Lot A (verdicts / isolation) stabilisé. |
| EF-21 | P0 | N2, B4 | **Isolation lecture / écriture par utilisateur.** Toute route de lecture (sessions, threads, activité) **et** d’écriture (`/run`, `/messages`, arbitrage, modification de session) vérifie côté serveur que l’utilisateur courant est propriétaire de la session ou explicitement autorisé selon la règle d’isolation retenue (Q3). À défaut : refus (403 ou 404), aucune mission lancée, aucun message enregistré. Complète EF-06 / EF-07. |
| EF-22 | P0 | N1 | **Quota de sessions par utilisateur.** La limite « 3 sessions maximum par utilisateur » est calculée sur les sessions de l’utilisateur courant (filtre propriétaire en plus du `tenantId`), et non sur l’ensemble du tenant (`listRooms({tenantId})`, `console.mjs` L363-365). Un nouvel utilisateur peut créer sa première session quel que soit le nombre de sessions existantes dans le tenant ; le message d’erreur correspond à la règle réellement appliquée. |
| EF-23 | P0 | N5, B2 | **Swarm branché sur le LLM serveur.** Après `bindEngineToServer`, tous les composants qui appellent un LLM (moteur, orchestrateur, agents **et** `engine.swarm.llm`) utilisent le provider serveur annoncé par `/health` (`llm.provider: mistral` au 6/10), y compris lorsque le moteur est créé avec `sovereignty: 'local'` (`context.mjs` L498-499). Aucun fallback mock silencieux vers un modèle local non installé (Ollama `llama3.2`) ; tout fallback est signalé (EF-04, ENF-09). L’hypothèse N5 est vérifiée avant de clore EF-03. |
| EF-24 | P1 | N4 | **Sortie de boucle `CONDITIONAL_GO`.** Un verdict `CONDITIONAL_GO` mène à `awaiting_arbitration`, les conditions étant présentées à l’arbitrage (ex. « Passer sous conditions ») ; `needs_clarification` est réservé aux cas où des questions de clarification sont réellement attendues de l’utilisateur. La règle `verdict === 'CONDITIONAL_GO' \|\| questions.length` de `hybrid-agent-gateway.mjs` est revue en conséquence. |
| EF-25 | P1 | N3 | **Refus du `tenantId` client à l’inscription.** `/v1/auth/register` ignore ou rejette tout champ `tenantId` fourni par le client (`auth-routes.mjs` L80-87, `auth.mjs` L127) ; le tenant est attribué exclusivement côté serveur selon la règle retenue (Q3). |
| EF-26 | P1 | AH, B1 | **Politique de rôles explicite et UI alignée.** Documenter le rôle requis pour chaque action console (arbitrage et les 7 routes agents / impersonators du §2.7). L’UI applique cette politique **avant** toute saisie : soit les boutons « Agent hybride », « Agent impersonator », « Équipe d’impersonators » (et l’arbitrage) sont masqués ou grisés avec un message indiquant le rôle requis, soit ces actions sont ouvertes aux contributeurs dans leur périmètre (agents de leurs propres sessions). Interdit : un refus 403 annoncé après saisie et consentement. Le contrôle d’autorisation serveur est conservé et son message reste lisible (EF-02). Décision liée à Q2 / Q9. |
| EF-27 | P1 | AH | **Personnalité activée pour tout agent console avec profil consenti.** Tout agent créé en console (y compris enregistré `agent_type: 'user_defined'`, `swarm.mjs` L256) et disposant d’un profil humain / personnalité consenti active la simulation de personnalité en mission, sans dépendre du seul type `hybrid_modified` (`hybrid-agent-gateway.mjs` L151-159, `specialized-agent.mjs` L27). |
| EF-28 | P1 | AH | **Option de simulation de personnalité en session et dans `impersonator-teams`.** `personality_simulation_enabled` est proposé dans l’UI de création de session et transmis par `POST /impersonator-teams`. |
| EF-29 | P2 | AH | **Compteur « Profils hybrides » cohérent.** Le compteur inclut tous les agents disposant d’un profil personnifié consenti, dont les agents créés en console (cohérent avec EF-27). |

---

## 5. Exigences non fonctionnelles

| Id | Domaine | Exigence | Lien audit |
| --- | --- | --- | --- |
| ENF-01 | Isolation / multi-tenant | Aucune session, thread ou activité d’un autre utilisateur ne doit apparaître chez un contributeur du tenant `default` dans le scénario reproduit (ESPACE DEFAULT). La correction doit être vérifiable par test d’acceptation, pas seulement par revue de code. | B4 |
| ENF-02 | Sécurité des rôles | Le gate `manager()` (`comex` / `admin`) et l’UI doivent être alignés : pas d’escalade involontaire de privilèges sans décision produit explicite ; pas non plus d’UI qui invite à une action interdite. | B1 |
| ENF-03 | Performance mock vs LLM | Le lancement de mission reste dans un ordre de grandeur compatible avec l’observation As-Is (~8 s) lorsque le provider est mock. Si un provider LLM réel est activé pour corriger B2, le temps de mission doit rester documenté et acceptable pour le parcours de test (seuil à fixer à la livraison, sans inventer de SLA non mesuré). | B2, parcours positif |
| ENF-04 | Observabilité | Les erreurs 403 d’arbitrage, le provider effectif (`mock` / autre) et les échecs de parse de verdict doivent être visibles côté client ou logs API pour le diagnostic. | B1, B2 |
| ENF-05 | Robustesse front | La navigation par hash (`#activity`, etc.) doit synchroniser menu et contenu sans rechargement complet obligatoire. | B3 |
| ENF-06 | Disponibilité démo | La page démo publique ne doit pas échouer sur une erreur de syntaxe JS (`Unexpected token 'var'`) en production. | B5 |
| ENF-07 | Confidentialité auth | Le flux reset mot de passe ne doit être annoncé comme disponible que si SMTP est réellement configuré (`smtp.configured: true`). | B7 |
| ENF-08 | Contrôle d’accès serveur | Le tenant et le propriétaire d’une ressource sont dérivés de l’identité authentifiée côté serveur, jamais d’un champ fourni par le client ; toute écriture (run, messages, arbitrage, agents) vérifie propriétaire et rôle avant traitement. Vérifiable par test d’acceptation (S14, S17). | N2, N3, B4 |
| ENF-09 | Observabilité du provider par composant | Le provider effectif de chaque composant (moteur, orchestrateur, agents, swarm) est visible (logs API ou `/health`) afin de détecter tout écart avec `llm.provider` (ex. swarm resté sur Ollama). | N5, B2 |

---

## 6. Hors périmètre

- Refonte visuelle globale de la console (hors correctifs UX liés aux bloqueurs).
- Salon littéraire et surfaces hors console / démo / workbench / connecteurs / personality / impersonator cités.
- Changement d’hébergeur (VPS OVH) ou migration SSO.
- Création de commits ou de PR par le présent document (livraison code hors cadre de rédaction).
- Invention de bugs sur les surfaces SX (§2.4) : seules les exigences « rendre opérable / vérifier / documenter » sont admises tant qu’aucun parcours bout-en-bout n’a été rejoué.
- Toute exigence sans ancrage dans l’audit live du 5 octobre 2026 ou le re-audit live du 6 octobre 2026 (bloqueurs B1-B8, N1-N5, constat §2.7 ou signaux §2.4).

**Note.** Les connecteurs Slack / Discord / Teams, CrystalKnows / LinkedIn personality import, et impersonator / swarm avancés sont **entrés dans le périmètre** (révision après-midi). Ils restent soumis à l’avertissement « non exercés bout-en-bout ».

---

## 7. Livrables et lots de livraison ordonnés

### Lot A : P0 sécurité et parcours décisionnel (obligatoire)

1. Correctif isolation sessions / threads / activité (B4, EF-06, EF-07, ENF-01).
2. Alignement arbitrage rôle ↔ UI ↔ API (B1, EF-01, EF-02, ENF-02) selon décision produit (section 9).
3. Correctif verdicts / provider pour sortir du `needs_clarification` systématique (B2, EF-03, EF-04).
4. Correctif navigation `#activity` (B3, EF-05) : au 6/10 non reproduit, à confirmer en non-régression.
5. Isolation en écriture par utilisateur : `/run`, `/messages` et autres écritures (N2, B4, EF-21, ENF-08).
6. Quota de sessions par utilisateur (N1, EF-22).
7. Branchement du swarm sur le LLM serveur, après vérification de l’hypothèse N5 (N5, B2, EF-23, ENF-09).

**Livrables Lot A :** correctifs front (`App.jsx`) et/ou API (`console.mjs` et couches listRooms / activity / threads) ; correctif du quota (`console.mjs` L363-365) et des contrôles propriétaire en écriture ; correctif de liaison LLM du swarm (`bindEngineToServer`, `engine.swarm.llm`) ; note de décision sur le rôle d’arbitrage ; checklist de retest audit (incluant S13 à S15).

### Lot B : P1 UX console et démo (+ correctifs P1 du re-audit du 6 octobre)

1. Auto-sélection de session après création (B6, EF-08).
2. Suppression / remplacement de l’alerte native démo vide (B6, EF-09).
3. Correctif démo publique étape 1/8 + réponses démo (B5, EF-10, EF-11).
4. Sortie de boucle `CONDITIONAL_GO` vers `awaiting_arbitration` (N4, EF-24).
5. Refus du `tenantId` client à l’inscription (N3, EF-25, ENF-08).
6. Politique de rôles explicite et UI agents / impersonators alignée (AH, B1, EF-26).

**Livrables Lot B :** correctifs SPA console ; correctifs `kayroslab-complete-with-ai-agents.html` et/ou `/v1/demo/chat` ; preuve de parcours démo au-delà de 1/8 ; correctif `hybrid-agent-gateway.mjs` (statut `CONDITIONAL_GO`) ; correctif `auth-routes.mjs` / `auth.mjs` (`tenantId`) ; note de politique de rôles et UI agents alignée (S16 à S18).

### Lot C : P2 exploitation

1. Configuration SMTP production + validation forgot/reset (B7, EF-12, ENF-07).
2. Déploiement workbench PR #33 / suppression du 404 `/workbench` (B8, EF-13).

**Livrables Lot C :** `smtp.configured: true` vérifié sur health ; e-mail de reset reçu sur boîte de test ; `/workbench` joignable.

### Lot D : Surfaces étendues (signaux §2.4, non exercées en audit)

1. Connecteurs Slack / Discord / Teams : configuration et/ou documentation OAuth (EF-15, EF-16, CA-9).
2. CrystalKnows / LinkedIn personality import : rendre opérable ou documenter l’indisponibilité (EF-17, EF-18, CA-10).
3. Impersonator / impersonator-teams / swarm avancé : parcours smoke documenté (EF-19, EF-20, CA-11).
4. Agents hybrides personnifiés : simulation de personnalité pour tout agent console avec profil consenti, option `personality_simulation_enabled` en session et dans `impersonator-teams`, compteur « Profils hybrides » (AH, EF-27, EF-28, EF-29, CA-14, S19).

**Livrables Lot D :** checklist de vérification bout-en-bout pour chaque surface SX ; mise à jour des capabilities observées (`connector_oauth`, `crystal_knows`, statuts `overview.connections`) ; note opérationnelle (prérequis secrets, rôles `manager()`, consentements impersonator). **Interdit :** déclarer des correctifs de bugs non reproduits.

Ordre recommandé : **A → B → C → D**. Le Lot A seul doit déjà permettre les critères CA-1 à CA-5 (arbitrage selon politique choisie) et CA-12 ; CA-13 requiert les Lots A (LLM serveur) et B (sortie de boucle `CONDITIONAL_GO`). Le Lot D ne doit pas précéder la stabilisation isolation / verdicts (dépendance logique à A).

---

## 8. Tests d’acceptation (Gherkin-light)

### Scénario S1 : Auth et création de session (régression positive)

```
Étant donné un visiteur sur www.kayroslab.com
Quand il ouvre /console/ et s’inscrit ou se connecte via SSO avec un compte contributeur
Alors il accède à la console
Quand il crée une session
Alors la session apparaît dans la liste
Et cette session est sélectionnée automatiquement (EF-08)
```

### Scénario S2 : Mission et verdicts (B2)

```
Étant donné un contributeur avec une session sélectionnée
Quand il lance une mission nominale
Alors l’exécution se termine (ordre de grandeur ~8 s en mock, ou durée documentée si LLM)
Et les verdicts sont parsables
Et le statut n’est pas systématiquement needs_clarification
Et le provider affiché est cohérent avec la configuration (mock ou LLM)
```

### Scénario S3 : Arbitrage cohérent (B1)

```
Étant donné un contributeur devant un thread arbitrable
Quand la politique produit autorise le contributeur à arbitrer
Alors POST .../arbitrate réussit (non 403) et le thread est mis à jour
Quand la politique produit refuse le contributeur
Alors les boutons d’arbitrage sont désactivés ou absents avec message « rôle comex ou admin requis »
Et aucun clic ne produit un 403 après action sur bouton actif
```

### Scénario S4 : Navigation Décisions (B3)

```
Étant donné un contributeur sur une page console autre que Décisions
Quand il active le menu Décisions (hash #activity)
Alors l’URL contient #activity
Et le contenu principal affiche la page Décisions (liste des dossiers / threads)
```

### Scénario S5 : Isolation (B4)

```
Étant donné le tenant default contenant des sessions d’autres utilisateurs (ex. yeye@yeye.com « Échange - Nietsche »)
Quand le contributeur kayros-audit-…@example.com liste ses sessions
Alors il ne voit pas la session de yeye@yeye.com
Et il ne voit que les sessions autorisées par la règle d’isolation retenue
```

### Scénario S6 : Démo publique (B5, Lot B)

```
Étant donné la page kayroslab-complete-with-ai-agents.html en production
Quand l’utilisateur démarre le parcours démo
Alors aucune erreur Unexpected token 'var' ne bloque la page
Et l’étape 1/8 est franchie (semantic map acceptée)
```

### Scénario S7 : SMTP reset (B7, Lot C)

```
Étant donné smtp.configured: true en production
Quand un utilisateur demande un reset via forgot password
Alors un e-mail de reset est envoyé
Et le lien permet de définir un nouveau mot de passe
```

### Scénario S8 : Workbench (B8, Lot C)

```
Étant donné le déploiement de la PR #33 (ou équivalent)
Quand l’utilisateur ouvre /workbench
Alors la réponse n’est pas 404
```

### Scénario S9 : Alerte native (B6)

```
Étant donné le parcours console corrigé
Quand l’utilisateur rencontre un état « démo vide »
Alors aucune alert native du navigateur n’est affichée
Et un message UI contrôlé (ou une no-op) est utilisé
```

### Scénario S10 : Connecteurs Slack / Discord / Teams (SX, Lot D)

```
Étant donné un compte avec le rôle requis (selon manager() / politique produit)
Et overview.connections indiquant not_configured pour slack, discord et teams
Quand l’opérateur suit le parcours Settings documenté pour configurer au moins un connecteur
Alors soit le statut du connecteur n’est plus not_configured et un test de connexion est consigné
Soit le produit documente explicitement les prérequis manquants (connector_oauth à false, secrets, redirect URI)
Et encrypted_connector_storage reste pris en charge comme observé (true)
```

### Scénario S11 : CrystalKnows / LinkedIn personality import (SX, Lot D)

```
Étant donné capabilities.crystal_knows observé à false en audit
Quand l’opérateur tente le parcours d’import personality (CrystalKnows et/ou LinkedIn) depuis la console
Alors soit l’import aboutit et les champs personality / human_profile sont visibles sur l’agent
Soit l’UI / la doc indique clairement l’indisponibilité et les prérequis pour passer crystal_knows à true
Sans alléguer un bug d’API non reproduit lors de l’audit
```

### Scénario S12 : Impersonator / swarm avancé (SX, Lot D)

```
Étant donné les routes impersonators et impersonator-teams exposées par console.mjs
Quand un opérateur autorisé crée un impersonator (consentement inclus) puis l’associe à une session
Alors l’agent apparaît dans la liste du tenant
Et une note de parcours documente les étapes jusqu’à une mission smoke (après Lot A)
Quand une impersonator-team est créée
Alors la team est listable et rattachable selon la doc livrée
Sans inventer d’erreur d’exécution non observée le 5 octobre 2026
```

### Scénario S13 : Quota de sessions par utilisateur (N1, Lot A)

```
Étant donné le tenant default contenant déjà au moins 3 sessions créées par d’autres utilisateurs
Quand un contributeur nouvellement inscrit crée sa première session
Alors la session est créée (pas de 403 « 3 sessions maximum par utilisateur »)
Quand ce même contributeur possède déjà 3 sessions et en crée une quatrième
Alors la création est refusée avec un message correspondant à la règle par utilisateur
```

### Scénario S14 : Écriture croisée refusée (N2, B4, Lot A)

```
Étant donné deux comptes contributeurs A et B du tenant default
Et une session appartenant à B
Quand A appelle /run sur la session de B
Alors la requête est refusée (403 ou 404) et aucune mission n’est lancée
Quand A appelle /messages sur un fil de la session de B
Alors la requête est refusée (403 ou 404) et aucun message n’est enregistré
```

### Scénario S15 : Swarm sur le LLM serveur (N5, B2, Lot A)

```
Étant donné /health indiquant llm.provider mistral (live)
Quand un contributeur lance une mission nominale dans sa session
Alors aucune réponse d’agent n’est marquée [mock]
Et le provider effectif du moteur, de l’orchestrateur, des agents et du swarm est le provider serveur (ENF-09)
Et aucun appel n’est tenté vers Ollama llama3.2
```

### Scénario S16 : Sortie de boucle CONDITIONAL_GO (N4, Lot B)

```
Étant donné une mission dont le verdict agrégé est CONDITIONAL_GO
Quand le résultat est enregistré
Alors le statut du fil est awaiting_arbitration (et non needs_clarification)
Et les conditions sont présentées à l’arbitrage
```

### Scénario S17 : tenantId client refusé à l’inscription (N3, Lot B)

```
Étant donné un visiteur non authentifié
Quand il appelle /v1/auth/register avec un champ tenantId choisi par lui
Alors la requête est rejetée, ou le champ est ignoré
Et le compte créé n’est jamais rattaché au tenant fourni par le client
```

### Scénario S18 : Politique de rôles agents / impersonators (AH, Lot B)

```
Étant donné un contributeur sur la page agents de la console
Quand la politique produit réserve la création d’agents à comex / admin
Alors les boutons « Agent hybride », « Agent impersonator » et « Équipe d’impersonators » sont masqués ou grisés avec le rôle requis
Et aucun formulaire ni consentement n’est demandé avant ce refus
Quand la politique produit ouvre ces actions aux contributeurs dans leur périmètre
Alors POST /agents, POST /impersonators et POST /impersonator-teams aboutissent pour ses propres sessions (non 403)
```

### Scénario S19 : Personnalité des agents console (AH, Lot D)

```
Étant donné un compte autorisé et un agent créé en console avec un profil humain / personnalité consenti
Quand il crée une session avec personality_simulation_enabled activé (ou via POST /impersonator-teams)
Et lance une mission dans cette session
Alors la simulation de personnalité est active pour cet agent, même s’il est enregistré user_defined
Et l’agent est compté dans le compteur « Profils hybrides »
```

---

## 9. Risques / questions ouvertes

| Id | Sujet | Constat audit | Question ouverte | Impact |
| --- | --- | --- | --- | --- |
| Q1 | Provider console = mock | Agents en `[mock]` ; verdicts non parsables ; démo aussi en `provider: mock`. 6/10 : `/health` indique `llm.provider: mistral` (live) ; piste N5 (swarm resté sur Ollama `llama3.2`) | Pourquoi le provider console / démo est-il `mock` en production ? Clé LLM absente, choix volontaire, ou bug de résolution de provider ? | Conditionne EF-03 / EF-04 et l’acceptation « verdicts réels » vs « mock structuré parsable » |
| Q2 | Promotion de rôle | Contributeur reçoit 403 sur arbitrate ; `manager()` exige `comex` ou `admin` | Le parcours To-Be doit-il **promouvoir** le créateur de session au droit d’arbitrer, ajouter un rôle intermédiaire, ou **garder** le gate comex/admin et seulement corriger l’UI ? | Conditionne EF-01 et CA-1 |
| Q3 | Tenant par user vs `default` | Tous les inscrits de test semblent sur tenant `default` ; fuite de sessions entre users | Chaque utilisateur doit-il recevoir un **tenant dédié** à l’inscription, ou un filtrage **par propriétaire** (`by` / `user id`) à l’intérieur du tenant `default` ? | Conditionne EF-06 / EF-07 / ENF-01, et EF-21 / EF-22 / EF-25 (N1-N3) |
| Q4 | Périmètre démo vs console | Démo publique et console partagent des symptômes mock / format | Corriger la démo dans le même lot que la console, ou la traiter en Lot B après stabilisation console ? | Planning Lot A vs B |
| Q5 | Workbench PR #33 | `/workbench` 404 | Le workbench est-il requis pour le parcours contributeur To-Be, ou uniquement pour un canal parallèle ? | Priorité réelle de EF-13 |
| Q6 | SMTP | `smtp.configured: false` | Le reset mot de passe est-il bloquant pour le go-live contributeur, ou acceptable en différé Lot C ? | Priorité EF-12 |
| Q7 | OAuth connecteurs | `connector_oauth` slack/discord/teams à `false` ; connections `not_configured` | Faut-il activer OAuth en production avant le Lot D, ou livrer d’abord la documentation des prérequis ? | EF-15 / EF-16 / CA-9 |
| Q8 | CrystalKnows | `capabilities.crystal_knows: false` | Quelle clé / contrat CrystalKnows est attendu, et LinkedIn seul suffit-il comme alternative d’import ? | EF-17 / EF-18 / CA-10 |
| Q9 | Impersonator vs contributeur | Routes gated par `manager()` (comex/admin) en code ; 6/10 : 7 routes agents / impersonators en 403 pour le contributeur alors que l’UI affiche les boutons (§2.7) | Le contributeur du parcours To-Be doit-il pouvoir créer des impersonators, ou seulement comex/admin ? | EF-19 / EF-20 / EF-26 / alignement avec Q2 |
| Q10 | Préférence du porteur pour Rust | Préférence exprimée par le porteur ; les corrections N1-N5 et EF-21 à EF-29 portent sur le backend Node / Fastify existant | À cadrer : Rust ne serait pertinent que pour un composant séparé (ex. service d’embeddings / recherche, ou passerelle) ou dans le cadre d’une réécriture planifiée. Quel composant, à quelle échéance, et après quels lots ? | Aucun impact sur les correctifs des Lots A-D (Node / Fastify) ; à trancher avant toute nouvelle brique |

---

## 10. Références d’ancrage (non exhaustives)

- Audit live 5 octobre 2026 : parcours compte `kayros-audit-…@example.com`, observations B1-B8 ci-dessus.
- Signaux surfaces non exercées (même audit) : `overview.connections` `not_configured` (slack/discord/teams) ; `capabilities.crystal_knows: false` ; `capabilities.connector_oauth` slack/discord/teams `false` ; `encrypted_connector_storage: true` ; UI Settings ; routes crystal / impersonators / impersonator-teams dans `console.mjs`.
- Journal navigateur d’audit : appel `.../arbitrate` en 403 ; page démo `Unexpected token 'var'` ; réponses `[KayrosLab] ← {chars: 159, provider: mock}` et « Incomplete response format ».
- `backend/fastify/routes/console.mjs` : `manager()` L96 ; `POST /v1/console/threads/:threadId/arbitrate` gated par `manager()` ; listes sessions / activity / threads scopées `me.tenantId` ; routes crystal, impersonators, impersonator-teams, connecteurs.
- `frontend/console-app/src/App.jsx` : menu `activity` / « Décisions » ; boutons d’arbitrage toujours rendus ; état `selectedSession` initialisé une fois ; UI Settings.
- `backend/fastify/routes/auth-routes.mjs` : forgot / reset password dépendant de `passwordResetMailer` / SMTP.
- Re-audit live 6 octobre 2026 : aucun commit console depuis le 5 octobre ; `/run` 200 et `/messages` 202 sur la session d’un autre compte ; 403 « 3 sessions maximum par utilisateur » ; 403 sur les 7 routes agents / impersonators pour un contributeur ; `/health` : `embedModel: bge-m3`, `llm.provider: mistral` (live) ; `crystal_knows: false`.
- `console.mjs` L363-365 : quota calculé via `listRooms({tenantId})` ; `manager()` évalué avant la validation sur les routes agents / impersonators.
- `auth-routes.mjs` L80-87 et `auth.mjs` L127 : `tenantId` fourni par le client accepté à l’inscription.
- `hybrid-agent-gateway.mjs` : statut `verdict === 'CONDITIONAL_GO' || questions.length` → `needs_clarification` ; L151-159 : simulation de personnalité automatique limitée à `hybrid_modified` (cf. `specialized-agent.mjs` L27).
- `context.mjs` L498-499 : moteur créé avec `sovereignty: 'local'` ; `bindEngineToServer` ne remplace pas `engine.swarm.llm` (Ollama `llama3.2`, non installé).
- `swarm.mjs` L256 : agents créés en console enregistrés `agent_type: 'user_defined'`.

---

*Fin du cahier des charges. Révision du 6 octobre 2026 : re-audit live (état B1-B8, nouveaux bloqueurs N1-N5, agents hybrides personnifiés, question Rust Q10). Révision du 5 octobre 2026 après-midi : périmètre étendu aux surfaces SX (connecteurs, CrystalKnows / LinkedIn, impersonator / swarm) sur la base de signaux d’audit uniquement. Aucun correctif de code ni PR n’accompagne ce document.*
