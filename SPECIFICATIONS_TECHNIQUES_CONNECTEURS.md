# KayrosLab — Spécifications techniques : adaptateurs Slack & Teams

> **Objet.** Conception technique des adaptateurs conversationnels (EF-88 → EF-109).
> **Version.** 1.0 · **Date.** 2026-07-21 · **Statut.** À arbitrer.
> **Vérifications.** Mécanismes confirmés sur la documentation officielle courante :
> Slack — *Verifying requests from Slack* (docs.slack.dev) ; Teams — *Work with Universal Actions for Adaptive Cards* (learn.microsoft.com).

---

## 0. Deux faits vérifiés qui contraignent la conception

**1. Slack impose une réponse en 3 secondes, Teams non.** Slack considère une interaction en échec au-delà de 3 s et affiche une erreur à l'utilisateur. Or un arbitrage déclenche : vérification d'identité, résolution du gate, mise à jour de l'idée, notifications. Cela ne tient pas dans le budget de façon fiable.
→ **Conséquence : traitement asynchrone obligatoire côté Slack.** Accusé de réception immédiat (HTTP 200 vide), puis traitement en tâche de fond, puis mise à jour du message via `response_url` (valable 30 minutes, 5 utilisations).

**2. Teams met la carte à jour *nativement*, via `Action.Execute`.** Le modèle *Universal Actions* (Adaptive Cards **1.5**) déclenche une invocation `adaptiveCard/action` à laquelle le bot **répond en renvoyant la carte mise à jour**. C'est exactement le comportement voulu au §4.1 fonctionnel — pas besoin d'appel séparé.
→ **Mais** : `version` doit valoir **1.5**, et il faut un `fallback: Action.Submit` pour les clients Teams anciens, sinon **la carte cesse de fonctionner**. Le bot doit donc traiter les deux formes.

**3. Le `refresh` automatique de Teams est plafonné à 60 utilisateurs.** La propriété `userIds` accepte au maximum 60 MRI ; au-delà, ou si la liste est vide, Teams affiche un bouton « Actualiser la carte » manuel.
→ **Conséquence : ne pas compter sur le rafraîchissement automatique dans un canal large.** La carte est mise à jour à l'action, pas en continu. Pour un canal de gouvernance (quelques censeurs), c'est sans effet ; pour un canal de collecte ouvert, l'agrégat de vote peut être périmé à l'affichage — assumé et signalé dans la carte.

---

## 1. Architecture

### 1.1 Position dans le système

```
Slack / Teams                  Backend Fastify                    core/
─────────────                  ───────────────                    ─────
requête signée   ──►  /v1/connect/{slack|teams}/*
                         │  1. vérification signature (§2)
                         │  2. anti-rejeu + idempotence (§3)
                         │  3. résolution d'identité (§4)   ──►  auth.mjs (compte lié, rôle, tenant)
                         │  4. traduction → intention        ──►  connect/intents.mjs
                         │  5. exécution métier              ──►  governance / evaluation / model
                         └► 6. rendu → vue native (§5)       ◄──  connect/views.mjs (abstrait)
```

**Règle structurante.** `core/` ne connaît **ni Slack ni Teams**. Il expose des intentions et des vues abstraites ; les adaptateurs traduisent. Le module prolonge `core/notify.mjs`, qui possède déjà l'abstraction de canal sortant.

### 1.2 Modules

| Module | Rôle | Dépendances |
|---|---|---|
| `core/connect/intents.mjs` | Modèle d'intention (`arbitrer_gate`, `voter`, `soumettre_idee`…) + validation | aucune |
| `core/connect/views.mjs` | Vue abstraite : titre, champs, actions, état | aucune |
| `core/connect/identity.mjs` | Liaison compte plateforme ↔ compte KayrosLab, jetons de liaison | `auth.mjs` |
| `core/connect/slack.mjs` | Signature, parsing, rendu Block Kit, `response_url` | `identity`, `views` |
| `core/connect/teams.mjs` | Validation JWT, invokes, rendu Adaptive Card 1.5 | `identity`, `views` |
| `backend/fastify/connect.mjs` | Routes, file de traitement asynchrone, idempotence | tout ce qui précède |

**Zéro dépendance ajoutée au cœur** : HMAC via `node:crypto` (déjà utilisé par `auth.mjs`), JWT vérifié à la main contre les clés publiques Bot Framework, `fetch` natif pour les appels sortants.

---

## 2. Vérification des requêtes entrantes (EF-89)

### 2.1 Slack — signature HMAC

Mécanisme confirmé par la documentation :

```
base    = "v0:" + X-Slack-Request-Timestamp + ":" + <corps BRUT>
attendu = "v0=" + HMAC_SHA256(signing_secret, base).hex()
compare(attendu, X-Slack-Signature)   // temps constant
```

**Contraintes d'implémentation, dans l'ordre :**

1. **Le corps doit être brut**, avant toute désérialisation. Fastify parse le JSON par défaut → il faut un `preParsing`/`addContentTypeParser` conservant le `rawBody`. **C'est l'erreur classique** : signer un corps re-sérialisé produit une signature valide mais différente, et tout échoue silencieusement.
2. **Fenêtre de 5 minutes** sur l'horodatage (anti-rejeu), vérifiée *avant* le calcul HMAC.
3. **Comparaison en temps constant** (`crypto.timingSafeEqual`), jamais `===`.
4. Les en-têtes sont **insensibles à la casse** — ne pas présumer `X-Slack-Signature`.

Concerne : Events API, shortcuts, slash commands, interactions.

### 2.2 Teams — jeton JWT du Bot Framework

Teams n'utilise pas de secret partagé mais un **JWT porteur** dans `Authorization: Bearer <token>` :

1. Récupérer le document OpenID Bot Framework et **mettre les clés en cache** (rotation possible ; cache avec TTL, rechargement sur `kid` inconnu).
2. Vérifier signature, `iss`, expiration.
3. Vérifier que `aud` **est l'identifiant applicatif du bot** — sans ce contrôle, un jeton émis pour un autre bot serait accepté.
4. Vérifier que `serviceUrl` du payload correspond à celui de l'activité.

> **Différence structurante.** Slack se vérifie hors ligne (secret local) ; Teams exige un **appel réseau** aux clés publiques. Le cache de clés est donc un composant de disponibilité : s'il échoue, plus aucune interaction Teams ne passe. Prévoir un cache persistant et une dégradation explicite (rejet + journalisation), jamais une acceptation par défaut.

---

## 3. Anti-rejeu & idempotence (EF-92)

| Plateforme | Clé d'idempotence |
|---|---|
| Slack | `payload.trigger_id` (interactions) ou `event_id` (Events API) |
| Teams | `activity.id` + `activity.replyToId` |

**Mise en œuvre.** Table `interactions_vues(cle, ts)` avec TTL de 15 minutes. Insertion conditionnelle : si la clé existe déjà, on **ne rejoue pas l'effet métier** et on renvoie l'état courant.

**Pourquoi c'est nécessaire ici.** Slack **répète** une requête si la réponse dépasse 3 s. Sans idempotence, un arbitrage lent serait rejoué et pourrait produire une double résolution. La garde existe déjà côté métier (`resolve()` lève sur un gate inconnu), mais elle produirait une erreur visible plutôt qu'une réponse propre.

---

## 4. Identité & habilitation (EF-90, EF-91)

### 4.1 Modèle

```js
Liaison = {
  plateforme: 'slack' | 'teams',
  externalId: string,      // U123… (Slack) | 29:1abc… (MRI Teams)
  workspaceId: string,     // team_id | tenantId AAD
  userId: string,          // compte KayrosLab
  creeeLe, dernierUsage,
}
```

**Résolution à chaque requête** : `(plateforme, externalId, workspaceId)` → compte → **rôle et tenant issus du compte**. Jamais de la charge utile reçue.

### 4.2 Liaison de compte

1. L'utilisateur lance `/kayros lier` → le bot répond, **en éphémère**, une URL contenant un jeton à usage unique (TTL 10 min, HMAC signé, portant `plateforme`, `externalId`, `workspaceId`).
2. L'URL ouvre le back-office ; l'utilisateur **s'authentifie normalement** (§EF-47).
3. À la validation, la liaison est créée côté serveur.

> **Le jeton ne porte aucun droit.** Il identifie une demande de liaison, pas une session. Un jeton intercepté ne permet rien sans authentification préalable au back-office. C'est la raison pour laquelle la liaison ne peut pas se faire entièrement dans le chat.

### 4.3 Refus

| Situation | Slack | Teams |
|---|---|---|
| Compte non lié | `response_type: ephemeral` | **Pas d'éphémère en canal** → message direct (1:1) au cliqueur |
| Rôle non habilité | idem | idem |

> **Limite Teams assumée.** Teams n'offre pas d'équivalent fiable au message éphémère en canal. Le refus part en conversation privée. Conséquence : le bot **doit pouvoir initier une conversation 1:1**, ce qui suppose que l'utilisateur ait déjà installé l'application. À défaut, l'action échoue silencieusement pour lui — comportement à documenter côté utilisateur.

---

## 5. Rendu : une vue abstraite, deux traductions

### 5.1 La vue

```js
Vue = {
  id: 'gate',
  titre: string,
  sousTitre: string|null,
  champs: [{ label, valeur, emphase?: boolean }],
  alerte: string|null,            // « Aucun vote — décision non instruite »
  actions: [{ id, libelle, style: 'primaire'|'danger'|'neutre', formulaire?: FormulaireRef }],
  etat: 'ouvert'|'resolu',
  pied: string|null,              // décision, auteur, horodatage après résolution
}
```

### 5.2 Correspondance

| Vue | Slack | Teams |
|---|---|---|
| titre / sousTitre | `header` + `section` | `TextBlock` (`weight: Bolder`, `size: Large`) |
| champs | `section.fields` (2 colonnes) | `FactSet` |
| alerte | `context` avec émoji | `TextBlock` `color: Attention` |
| actions | `actions` + `button` (`style: primary/danger`) | `Action.Execute` + `fallback: Action.Submit` |
| formulaire | `views.open` (modal, `trigger_id`) | `task/fetch` → module de tâche |
| état résolu | `chat.update` ou `response_url` | **retour direct** de la carte dans la réponse à l'invocation |

**Asymétrie majeure.** Sur Teams, la mise à jour est *la réponse* à `adaptiveCard/action` — un aller-retour. Sur Slack, c'est un **second appel** après accusé de réception. L'adaptateur Slack porte donc un état intermédiaire (`response_url` à conserver le temps du traitement) que Teams n'a pas.

### 5.3 Contraintes de formulaire

| | Slack | Teams |
|---|---|---|
| Ouverture | `views.open` avec `trigger_id` — **valable 3 s** | `task/fetch` sur l'action |
| Champs | Libres | Libres (Adaptive Card) |
| Canevas Recueillir (6 champs) | Tient | Tient |

> **Piège Slack.** Le `trigger_id` expire en **3 secondes**. Un modal ne peut donc **pas** être ouvert après un traitement asynchrone. Conséquence : pour « Refuser » et « Réviser », le modal de motif doit être ouvert **immédiatement** à la réception du clic (avant toute vérification lente), la vérification d'habilitation ayant lieu **à la soumission du modal**. C'est contre-intuitif mais imposé par la plateforme.

---

## 6. Flux d'arbitrage — séquence détaillée

### 6.1 Slack

```
1. Clic « Refuser »
2. Backend : vérif signature (<50 ms) → ouverture IMMÉDIATE du modal de motif (trigger_id)
   └─ HTTP 200 dans le budget de 3 s
3. Soumission du modal (view_submission)
   ├─ vérif signature + idempotence
   ├─ résolution d'identité → rôle
   ├─ si non habilité : réponse d'erreur DANS le modal (errors) — pas de résolution
   ├─ si motif vide : erreur de champ (la garde métier est doublée côté UI)
   └─ HTTP 200 (ferme le modal)
4. Tâche de fond : governance.resolve() → mise à jour de l'idée → journal
5. chat.update sur le message d'origine : boutons retirés, décision + auteur + motif + horodatage
```

**« Approuver »** ne demande pas de motif : accusé de réception immédiat, puis traitement de fond, puis `chat.update`.

### 6.2 Teams

```
1. Clic « Refuser » (Action.Execute)
2. Invocation adaptiveCard/action
   ├─ validation JWT (clés en cache)
   ├─ idempotence sur activity.id
   ├─ résolution d'identité → rôle
   ├─ si non habilité : réponse = carte inchangée + message 1:1 au cliqueur
   └─ sinon : task/fetch → module de tâche « motif »
3. Soumission du module
   ├─ governance.resolve()
   └─ réponse = CARTE MISE À JOUR (état résolu)
```

Teams tient dans un seul aller-retour synchrone. Le budget est plus confortable, mais **la validation JWT ajoute une dépendance réseau** (§2.2).

---

## 7. Surface HTTP

| Route | Méthode | Plateforme | Rôle |
|---|---|---|---|
| `/v1/connect/slack/commands` | POST | Slack | Slash commands |
| `/v1/connect/slack/interactions` | POST | Slack | Boutons, modals, shortcuts |
| `/v1/connect/slack/events` | POST | Slack | Events API (+ `url_verification`) |
| `/v1/connect/teams/messages` | POST | Teams | Messages, invokes, `task/fetch`, `task/submit` |
| `/v1/connect/link/:token` | GET | — | Page de liaison de compte (back-office) |
| `/v1/connect/link` | POST | — | Confirmation de liaison (authentifiée) |

**Configuration.**

```bash
KAYROS_SLACK_SIGNING_SECRET=
KAYROS_SLACK_BOT_TOKEN=
KAYROS_TEAMS_APP_ID=
KAYROS_TEAMS_APP_PASSWORD=
KAYROS_CONNECT_LINK_SECRET=      # signature des jetons de liaison
```

Absence de secret ⇒ routes correspondantes en **503**, jamais ouvertes — même règle que `KAYROS_AUTH_SECRET`.

---

## 8. Stratégie de test

Le cœur étant sans dépendance et les entrées étant des charges utiles HTTP, **tout est testable hors ligne**.

| Test | Méthode |
|---|---|
| Signature Slack valide / falsifiée / expirée | Vecteurs construits, y compris le vecteur de la documentation officielle |
| Corps brut vs re-sérialisé | Vérifier que la re-sérialisation **échoue** (garde anti-régression) |
| JWT Teams : `aud` erroné, expiré, `kid` inconnu | Clés générées en test, `fetch` injecté |
| Idempotence | Même clé deux fois ⇒ un seul effet métier |
| Habilitation | Compte non lié / rôle non habilité ⇒ aucune résolution |
| Motif obligatoire | Refus sans motif ⇒ rejet, gate toujours ouvert |
| Rendu | Vue abstraite ⇒ Block Kit **et** Adaptive Card 1.5 avec `fallback` |
| Dégradation | Canal en panne ⇒ arbitrage effectué malgré tout |

**Test prioritaire** : *un refus sans motif ne doit jamais résoudre un gate, quelle que soit la plateforme.* C'est la règle de gouvernance que le confort du chat risque le plus de contourner.

---

## 9. Risques techniques

| Risque | Conséquence | Mitigation |
|---|---|---|
| Corps re-sérialisé par Fastify | **Toutes** les signatures Slack échouent | `rawBody` conservé ; test anti-régression |
| `trigger_id` expiré (3 s) | Modal impossible à ouvrir | Ouverture avant traitement (§5.3) |
| Carte Teams en version < 1.5 | **La carte cesse de fonctionner** | Version 1.5 + `fallback: Action.Submit` ; le bot traite les deux |
| Cache de clés Bot Framework indisponible | Aucune interaction Teams | Cache persistant + TTL ; rejet explicite, jamais d'acceptation par défaut |
| `refresh` plafonné à 60 utilisateurs | Agrégat de vote périmé dans un canal large | Ne pas dépendre du refresh ; horodater la donnée affichée |
| Slack rejoue une requête lente | Double résolution | Idempotence (§3) |
| Bot Teams non installé par l'utilisateur | Le refus d'habilitation n'arrive pas | Documenter ; journaliser l'échec d'envoi |

---

## 10. Réserves

- **Aucun prototype réalisé.** Les mécanismes de signature (Slack) et le modèle Universal Actions (Teams) sont confirmés par la documentation officielle ; les **budgets de temps réels**, le comportement exact des modules de tâche et la fiabilité des messages 1:1 Teams demandent une validation empirique.
- Le **JWT Bot Framework** est décrit dans ses principes ; les URL de métadonnées OpenID et la liste d'émetteurs valides doivent être relevées sur la documentation Microsoft au moment de l'implémentation, car elles évoluent.
- Ces adaptateurs supposent le **backend déployé et joignable en HTTPS public** (P2), condition non remplie à ce jour : Slack et Teams exigent une URL publique vérifiable.
- La publication sur les marketplaces impose un **dossier de conformité** (rétention, SSO, contact sécurité) qui n'est pas couvert ici.

---

*Spécification technique alignée sur SPECIFICATIONS_CONNECTEURS_CHAT.md (EF-88 → EF-109) et sur les modules existants de `core/`.*
