# Cahier des charges : Correction du parcours console KayrosLab

| Champ | Valeur |
| --- | --- |
| Produit | KayrosLab Console |
| Document | Cahier des charges fonctionnel et non fonctionnel |
| Date | 5 octobre 2026 (Europe/Paris) |
| Révision | 5 octobre 2026 après-midi (Europe/Paris) : extension du périmètre (connecteurs, CrystalKnows / LinkedIn, impersonator / swarm) |
| Source unique | Audit live du 5 octobre 2026 (parcours réel sur la production) |
| Compte de test | `kayros-audit-…@example.com` (rôle contributeur, tenant `default`) |
| Surfaces observées | `https://www.kayroslab.com/console/` (SPA), API `https://api.kayroslab.com` (VPS OVH), SSO `https://sso.kayroslab.com` |
| Fichiers d’ancrage | `frontend/console-app/src/App.jsx` ; `backend/fastify/routes/console.mjs` (`manager()` L96, routes sessions / run / arbitrate, crystal, impersonators, impersonator-teams) ; `backend/fastify/routes/auth-routes.mjs` |
| Statut | À traiter (aucun commit ni PR associé à ce document) |

Ce document ne contient que des exigences dérivées de l’audit live du 5 octobre 2026 et des **signaux** observés le même jour sur des surfaces **non exercées bout-en-bout**. Aucun bug non observé n’est inventé : pour ces surfaces, les exigences se limitent à rendre opérable, vérifier et documenter le parcours.

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
3. Création de session possible.
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

### 2.4 Surfaces présentes mais non exercées bout-en-bout (signaux uniquement)

Ces surfaces sont **dans le périmètre** à la demande du propriétaire. Elles n’ont **pas** fait l’objet d’un parcours bout-en-bout réussi ni d’un diagnostic de bug fonctionnel le 5 octobre 2026. Seuls les signaux suivants ont été observés.

| Surface | Signaux observés (audit 5 oct 2026) | Non observé (donc non affirmé) |
| --- | --- | --- |
| Connecteurs Slack / Discord / Teams | `overview.connections` : statut `not_configured` pour slack, discord, teams ; `capabilities.connector_oauth` : slack / discord / teams à `false` ; `encrypted_connector_storage: true` ; UI Settings console exposant les connecteurs | Aucun essai de configuration OAuth, de test de connecteur, ni d’envoi réel vers un canal |
| CrystalKnows / LinkedIn personality import | `capabilities.crystal_knows: false` ; routes crystal / personality présentes dans `console.mjs` ; UI Settings | Aucun import CrystalKnows ni LinkedIn exécuté bout-en-bout |
| Impersonator / swarm avancés | Routes `impersonators` / `impersonator-teams` dans `console.mjs` ; UI associée dans la console | Aucune création d’impersonator ni de swarm avancé exercée jusqu’à une mission / un arbitrage |

Conséquence pour le cahier des charges : les exigences EF-15 à EF-20 demandent de **rendre opérable**, **vérifier** et **documenter** ces parcours, sans présumer de défaillances non mesurées.

### 2.5 Synthèse As-Is

Le parcours d’entrée (landing, auth, création de session, lancement de mission) est opérationnel. Le parcours de **sortie décisionnelle** (verdicts fiables, arbitrage, navigation Décisions, isolation des sessions, reset mot de passe, démo publique, workbench) est rompu pour un contributeur sur le tenant `default`. Les surfaces connecteurs, CrystalKnows / LinkedIn et impersonator / swarm sont **visibles** (signaux ci-dessus) mais **non validées** bout-en-bout.

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

---

## 4. Exigences fonctionnelles

Légende priorités : **P0** bloqueur parcours décisionnel ou sécurité d’isolation ; **P1** UX / cohérence produit et surfaces étendues à rendre opérables ; **P2** surfaces satellites (démo, SMTP, workbench, activation connecteurs / imports) hors chemin critique console si le lot principal est priorisé autrement.

Colonne « Bloqueur » : B1-B8 = bloqueurs exercés ; **SX** = surface signalée non exercée (§2.4), sans bug inventé.

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
| EF-10 | P1 | B5 | **Démo publique étape 1/8.** Corriger le blocage de `kayroslab-complete-with-ai-agents.html` à l’étape 1/8 lié au format semantic map et à l’erreur JavaScript `Unexpected token 'var'`. |
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

---

## 6. Hors périmètre

- Refonte visuelle globale de la console (hors correctifs UX liés aux bloqueurs).
- Salon littéraire et surfaces hors console / démo / workbench / connecteurs / personality / impersonator cités.
- Changement d’hébergeur (VPS OVH) ou migration SSO.
- Création de commits ou de PR par le présent document (livraison code hors cadre de rédaction).
- Invention de bugs sur les surfaces SX (§2.4) : seules les exigences « rendre opérable / vérifier / documenter » sont admises tant qu’aucun parcours bout-en-bout n’a été rejoué.
- Toute exigence sans ancrage dans l’audit live du 5 octobre 2026 (bloqueurs B1-B8 ou signaux §2.4).

**Note.** Les connecteurs Slack / Discord / Teams, CrystalKnows / LinkedIn personality import, et impersonator / swarm avancés sont **entrés dans le périmètre** (révision après-midi). Ils restent soumis à l’avertissement « non exercés bout-en-bout ».

---

## 7. Livrables et lots de livraison ordonnés

### Lot A : P0 sécurité et parcours décisionnel (obligatoire)

1. Correctif isolation sessions / threads / activité (B4, EF-06, EF-07, ENF-01).
2. Alignement arbitrage rôle ↔ UI ↔ API (B1, EF-01, EF-02, ENF-02) selon décision produit (section 9).
3. Correctif verdicts / provider pour sortir du `needs_clarification` systématique (B2, EF-03, EF-04).
4. Correctif navigation `#activity` (B3, EF-05).

**Livrables Lot A :** correctifs front (`App.jsx`) et/ou API (`console.mjs` et couches listRooms / activity / threads) ; note de décision sur le rôle d’arbitrage ; checklist de retest audit.

### Lot B : P1 UX console et démo

1. Auto-sélection de session après création (B6, EF-08).
2. Suppression / remplacement de l’alerte native démo vide (B6, EF-09).
3. Correctif démo publique étape 1/8 + réponses démo (B5, EF-10, EF-11).

**Livrables Lot B :** correctifs SPA console ; correctifs `kayroslab-complete-with-ai-agents.html` et/ou `/v1/demo/chat` ; preuve de parcours démo au-delà de 1/8.

### Lot C : P2 exploitation

1. Configuration SMTP production + validation forgot/reset (B7, EF-12, ENF-07).
2. Déploiement workbench PR #33 / suppression du 404 `/workbench` (B8, EF-13).

**Livrables Lot C :** `smtp.configured: true` vérifié sur health ; e-mail de reset reçu sur boîte de test ; `/workbench` joignable.

### Lot D : Surfaces étendues (signaux §2.4, non exercées en audit)

1. Connecteurs Slack / Discord / Teams : configuration et/ou documentation OAuth (EF-15, EF-16, CA-9).
2. CrystalKnows / LinkedIn personality import : rendre opérable ou documenter l’indisponibilité (EF-17, EF-18, CA-10).
3. Impersonator / impersonator-teams / swarm avancé : parcours smoke documenté (EF-19, EF-20, CA-11).

**Livrables Lot D :** checklist de vérification bout-en-bout pour chaque surface SX ; mise à jour des capabilities observées (`connector_oauth`, `crystal_knows`, statuts `overview.connections`) ; note opérationnelle (prérequis secrets, rôles `manager()`, consentements impersonator). **Interdit :** déclarer des correctifs de bugs non reproduits.

Ordre recommandé : **A → B → C → D**. Le Lot A seul doit déjà permettre le critère CA-1 à CA-5 (arbitrage selon politique choisie). Le Lot D ne doit pas précéder la stabilisation isolation / verdicts (dépendance logique à A).

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

---

## 9. Risques / questions ouvertes

| Id | Sujet | Constat audit | Question ouverte | Impact |
| --- | --- | --- | --- | --- |
| Q1 | Provider console = mock | Agents en `[mock]` ; verdicts non parsables ; démo aussi en `provider: mock` | Pourquoi le provider console / démo est-il `mock` en production ? Clé LLM absente, choix volontaire, ou bug de résolution de provider ? | Conditionne EF-03 / EF-04 et l’acceptation « verdicts réels » vs « mock structuré parsable » |
| Q2 | Promotion de rôle | Contributeur reçoit 403 sur arbitrate ; `manager()` exige `comex` ou `admin` | Le parcours To-Be doit-il **promouvoir** le créateur de session au droit d’arbitrer, ajouter un rôle intermédiaire, ou **garder** le gate comex/admin et seulement corriger l’UI ? | Conditionne EF-01 et CA-1 |
| Q3 | Tenant par user vs `default` | Tous les inscrits de test semblent sur tenant `default` ; fuite de sessions entre users | Chaque utilisateur doit-il recevoir un **tenant dédié** à l’inscription, ou un filtrage **par propriétaire** (`by` / `user id`) à l’intérieur du tenant `default` ? | Conditionne EF-06 / EF-07 / ENF-01 |
| Q4 | Périmètre démo vs console | Démo publique et console partagent des symptômes mock / format | Corriger la démo dans le même lot que la console, ou la traiter en Lot B après stabilisation console ? | Planning Lot A vs B |
| Q5 | Workbench PR #33 | `/workbench` 404 | Le workbench est-il requis pour le parcours contributeur To-Be, ou uniquement pour un canal parallèle ? | Priorité réelle de EF-13 |
| Q6 | SMTP | `smtp.configured: false` | Le reset mot de passe est-il bloquant pour le go-live contributeur, ou acceptable en différé Lot C ? | Priorité EF-12 |
| Q7 | OAuth connecteurs | `connector_oauth` slack/discord/teams à `false` ; connections `not_configured` | Faut-il activer OAuth en production avant le Lot D, ou livrer d’abord la documentation des prérequis ? | EF-15 / EF-16 / CA-9 |
| Q8 | CrystalKnows | `capabilities.crystal_knows: false` | Quelle clé / contrat CrystalKnows est attendu, et LinkedIn seul suffit-il comme alternative d’import ? | EF-17 / EF-18 / CA-10 |
| Q9 | Impersonator vs contributeur | Routes gated par `manager()` (comex/admin) en code | Le contributeur du parcours To-Be doit-il pouvoir créer des impersonators, ou seulement comex/admin ? | EF-19 / EF-20 / alignement avec Q2 |

---

## 10. Références d’ancrage (non exhaustives)

- Audit live 5 octobre 2026 : parcours compte `kayros-audit-…@example.com`, observations B1-B8 ci-dessus.
- Signaux surfaces non exercées (même audit) : `overview.connections` `not_configured` (slack/discord/teams) ; `capabilities.crystal_knows: false` ; `capabilities.connector_oauth` slack/discord/teams `false` ; `encrypted_connector_storage: true` ; UI Settings ; routes crystal / impersonators / impersonator-teams dans `console.mjs`.
- Journal navigateur d’audit : appel `.../arbitrate` en 403 ; page démo `Unexpected token 'var'` ; réponses `[KayrosLab] ← {chars: 159, provider: mock}` et « Incomplete response format ».
- `backend/fastify/routes/console.mjs` : `manager()` L96 ; `POST /v1/console/threads/:threadId/arbitrate` gated par `manager()` ; listes sessions / activity / threads scopées `me.tenantId` ; routes crystal, impersonators, impersonator-teams, connecteurs.
- `frontend/console-app/src/App.jsx` : menu `activity` / « Décisions » ; boutons d’arbitrage toujours rendus ; état `selectedSession` initialisé une fois ; UI Settings.
- `backend/fastify/routes/auth-routes.mjs` : forgot / reset password dépendant de `passwordResetMailer` / SMTP.

---

*Fin du cahier des charges. Révision du 5 octobre 2026 après-midi : périmètre étendu aux surfaces SX (connecteurs, CrystalKnows / LinkedIn, impersonator / swarm) sur la base de signaux d’audit uniquement. Aucun commit ni PR n’accompagne ce document.*
