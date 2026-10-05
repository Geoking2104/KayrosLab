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
| Statut | Déposé dans le dépôt sous `docs/CAHIER-DES-CHARGES-CONSOLE.md` |

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

Voir le fichier complet dans le dépôt pour le détail EF-01 à EF-20, ENF, lots A–D, scénarios S1–S12 et questions ouvertes Q1–Q9.

*Document complet déposé : le corps intégral des sections 4 à 10 suit dans le blob du dépôt (contenu source `/workspace/KayrosLab-console-cahier-des-charges.md`).*