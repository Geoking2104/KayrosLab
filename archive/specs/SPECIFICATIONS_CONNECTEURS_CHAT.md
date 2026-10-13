# KayrosLab — Connecteurs conversationnels (Slack · Teams · Discord)

> **Objet.** Spécification fonctionnelle des connecteurs chat.
> **Version.** 1.0 · **Date.** 2026-07-21 · **Statut.** À arbitrer.
> **Référence comparée.** App Brightidea sur le Slack Marketplace (analysée le 2026-07-21).

---

## 0. La thèse

**Ce que fait Brightidea dans Slack.** Un raccourci de message pour transformer une conversation en idée, une commande slash pour saisir une idée, un onglet d'accueil, et un lien entre la conversation d'origine et l'idée créée. C'est une **boîte à idées déportée** : le flux va de Slack vers la plateforme, et s'arrête là. Tout le travail d'évaluation et de décision se fait ensuite dans l'outil.

**Ce que KayrosLab doit faire.** La capture est nécessaire mais c'est la partie la moins différenciante. La valeur propre de KayrosLab est ailleurs : **la gouvernance**. Or nous avons établi un fait opérationnel dans ce projet — *un gate ouvert sans notification fige le processus, parce que le censeur ne sait pas qu'on l'attend*. Le canal de discussion est précisément l'endroit où se trouvent les décideurs.

> **Thèse retenue.** Le connecteur ne doit pas être une boîte à idées dans le canal, mais **une salle d'arbitrage dans le canal**. Un COMEX doit pouvoir approuver, refuser avec motif ou demander une révision **sans ouvrir l'application**, et cette décision doit rester aussi tracée et contraignante que si elle avait été prise dans le back-office.

**Corollaire de conception.** Si l'arbitrage devient cliquable dans un canal, alors la question centrale n'est plus l'ergonomie mais **l'identité** : qui a le droit de cliquer. C'est le point traité en priorité (§2), avant toute fonctionnalité.

---

## 1. Hiérarchie de valeur

Classement par valeur ajoutée décroissante, et non par facilité d'implémentation.

| Rang | Capacité | Pourquoi | Brightidea |
|---|---|---|---|
| **1** | **Arbitrage de gate en canal** (approuver / réviser / refuser motivé) | Débloque le point de blocage réel du processus. Le censeur décide là où il est. | ❌ |
| **2** | **Vote pondéré en canal** | Le débat a lieu dans le canal ; l'agrégat qui *instruit* la décision doit s'y construire. | ❌ |
| **3** | **Alerte de dérive** (KPI hors seuil → re-arbitrage) | Ferme la boucle Projeter → Écouter là où l'équipe réagit. | ❌ |
| **4** | **Capture** (message → idée, canevas Recueillir) | Alimentation du portefeuille. Utile, mais banalisé. | ✅ |
| **5** | **Digest périodique** | Entretient l'attention sans saturer. | ❌ |
| **6** | **Consultation** (recherche, fiche idée) | Confort. | Partiel |

---

## 2. Identité & habilitation — le préalable

**Le risque.** Dans un canal, tout le monde voit les mêmes boutons. Si « Approuver » est cliquable par n'importe quel membre, le droit de veto — pierre angulaire de la gouvernance KayrosLab — devient décoratif.

**Règles retenues.**

1. **Aucune action sans compte lié.** Un identifiant de plateforme (`slack:U123`, `teams:29:1abc`, `discord:456`) doit être **explicitement rattaché** à un compte KayrosLab. Le rattachement se fait par l'utilisateur lui-même, authentifié dans le back-office (jeton de liaison à usage unique, expirant).
2. **Le rôle vient de KayrosLab, jamais du chat.** Être administrateur Slack ne confère aucun droit d'arbitrage. Le RBAC existant (`comex`, `expert`, `redteam`, `facilitateur`, `contributeur`) reste seul juge.
3. **Le tenant vient du compte lié**, jamais du canal ni de la charge utile reçue. Un espace de travail peut héberger plusieurs tenants ; l'isolation ne doit pas dépendre de la configuration du canal.
4. **Action non habilitée = message éphémère**, visible du seul cliqueur. On n'humilie pas publiquement, et on n'expose pas la composition des rôles.
5. **Toute requête entrante est vérifiée cryptographiquement** avant traitement (§3.4). Une requête non signée est rejetée sans être lue.

> **Conséquence assumée.** Un nouvel arrivant ne peut rien faire tant qu'il n'a pas lié son compte. C'est un frottement délibéré : il vaut mieux un utilisateur bloqué qu'un veto usurpé.

---

## 3. Architecture fonctionnelle

### 3.1 Un modèle d'action, trois adaptateurs

Les trois plateformes offrent les mêmes primitives sous des noms différents. La logique métier ne doit **jamais** connaître la plateforme.

| Primitive | Slack | Teams | Discord |
|---|---|---|---|
| Commande | Slash command | Bot command | Slash command |
| Capture depuis un message | Message shortcut | Message extension | Menu contextuel (Apps) |
| Message riche | Block Kit | Adaptive Card | Embed |
| Bouton d'action | Block actions | `Action.Execute` | Message component |
| Formulaire | Modal (`views.open`) | Task module | Modal |
| Envoi sortant | Webhook entrant / `chat.postMessage` | Webhook / connecteur | Webhook |
| Vérification | Signature HMAC + horodatage | Jeton JWT | Signature Ed25519 |

**Conception.** Le cœur expose des **intentions** (`arbitrer_gate`, `voter`, `soumettre_idee`…) et des **vues abstraites** (titre, champs, actions). Chaque adaptateur traduit dans sa syntaxe native. Ce module prolonge `core/notify.mjs`, qui possède déjà l'abstraction de canal sortant.

### 3.2 Sens des flux

**Sortant (KayrosLab → canal).** Gate ouvert · vote enregistré · décision prise · seuil KPI franchi · jalon en retard · digest.
**Entrant (canal → KayrosLab).** Soumission d'idée · vote · arbitrage · consultation · liaison de compte.

### 3.3 Dégradation maîtrisée

Un canal indisponible ne doit jamais bloquer le processus — règle déjà appliquée au `CompositeNotifier`. Réciproquement, **l'absence de connecteur ne retire aucune fonction** : tout reste faisable dans le back-office. Le chat est un accélérateur, pas une dépendance.

### 3.4 Sécurité des requêtes entrantes

- **Vérification de signature obligatoire** avant tout traitement, selon le mécanisme natif de chaque plateforme.
- **Anti-rejeu** : requête horodatée de plus de 5 minutes rejetée.
- **Idempotence** : un même identifiant d'interaction ne produit qu'un seul effet (un double-clic sur « Approuver » n'arbitre pas deux fois).
- **Aucun secret dans les messages** : ni jeton, ni identifiant interne exploitable.
- **Journalisation** : toute action entrante est tracée avec son origine (plateforme, canal, utilisateur lié).

---

## 4. Parcours fonctionnels

### 4.1 Arbitrage d'un gate — le parcours central

**Déclencheur.** Ouverture d'un gate (`gate_opened`).

**Message publié** dans le canal de gouvernance du tenant :

- Titre de l'idée, type de gate, rôle requis
- **L'agrégat de vote qui instruit** : moyenne pondérée, nombre d'évaluateurs, recommandation, mention explicite si les avis sont dispersés
- Si aucun vote : *« Aucun vote préalable — la décision ne sera pas instruite »*
- Trois actions : **Approuver** · **Réviser** · **Refuser (veto)**
- Lien vers la fiche complète

**Comportement.**

| Cas | Réponse |
|---|---|
| Utilisateur non lié | Message éphémère : invitation à lier son compte |
| Rôle non habilité | Message éphémère : action réservée au rôle requis |
| Approuver | Résolution immédiate ; message mis à jour |
| Réviser / Refuser | **Formulaire de motif obligatoire** ; sans motif, pas de résolution |
| Gate déjà résolu | Message éphémère indiquant l'auteur et l'horodatage de la décision |

**Après résolution.** Le message original est **mis à jour** (boutons retirés, décision, auteur, motif, horodatage affichés). L'historique du canal devient une trace d'audit lisible, cohérente avec l'historique interne de l'idée.

> **Point non négociable.** Le motif obligatoire sur refus et révision est repris tel quel depuis le back-office. La commodité du canal ne doit pas créer une voie de contournement des règles de gouvernance.

### 4.2 Vote pondéré en canal

**Déclencheur.** Publication d'une idée pour évaluation, ou commande explicite.

Sélecteur de note (0–100) ; le vote est enregistré avec le **rôle** de l'évaluateur, ce qui applique la pondération existante (COMEX ×3, expert et Red Team ×2, contributeur ×1). L'agrégat affiché se met à jour : moyenne pondérée, dispersion, consensus, recommandation indicative.

**Un évaluateur ne vote qu'une fois** : un nouveau vote remplace le précédent, il ne s'ajoute pas. Le vote n'est pas anonyme — cohérent avec le principe de traçabilité du système.

### 4.3 Capture d'idée

**Trois entrées.** (a) Raccourci sur un message existant, (b) commande slash, (c) onglet d'accueil / message direct.

Le formulaire reprend le **canevas Recueillir** (valeur, problème, ressources, parties prenantes, risques, équipe). À la soumission, l'utilisateur reçoit le nombre d'**hypothèses dérivées** pour *Construire* et de **cibles d'attaque** pour *Éprouver* — y compris les angles morts détectés sur les champs laissés vides.

Le **lien conversation ↔ idée est bidirectionnel** : l'idée conserve la référence du message d'origine, et un fil de réponse signale la création. Si une campagne exige la modération, l'auteur est informé que sa soumission attend un feu vert et n'entre pas encore dans le portefeuille.

### 4.4 Alerte de dérive

Quand la boucle Projeter détecte un KPI hors seuil, un message est publié : KPI concerné, valeur constatée, seuil, écart vs projeté et position par rapport à l'intervalle P10–P90. Action proposée : **ouvrir un re-arbitrage**, qui crée un gate — lequel repasse par le parcours §4.1.

C'est le bouclage complet : le réel dérive, le canal alerte, le COMEX ré-arbitre.

### 4.5 Digest

Digest périodique par canal, reprenant `buildDigest` : activités agrégées par idée et par type, contributeurs, gates en attente. **Un digest vide n'est pas publié** — règle déjà en vigueur.

---

## 5. Exigences fonctionnelles (EF-88 → EF-109)

### 5.1 Connecteurs & sécurité

- **EF-88 (🔴)** Abstraction multi-plateforme : la logique métier expose des intentions et des vues indépendantes de Slack, Teams et Discord.
- **EF-89 (🔴)** Toute requête entrante est **vérifiée cryptographiquement** (signature native) et **anti-rejouée** (fenêtre de 5 minutes) avant traitement.
- **EF-90 (🔴)** Liaison de compte explicite entre identifiant de plateforme et compte KayrosLab, par jeton à usage unique expirant.
- **EF-91 (🔴)** Le **rôle et le tenant proviennent du compte lié**, jamais du chat ni de la charge utile reçue.
- **EF-92 (🔴)** Idempotence des interactions : une même interaction ne produit qu'un seul effet.
- **EF-93 (🔴)** Panne d'un canal sans effet sur le processus ; absence de connecteur sans perte de fonction.

### 5.2 Gouvernance en canal

- **EF-94 (🔴)** Publication d'un gate ouvert dans le canal du tenant, avec l'agrégat de vote qui l'instruit.
- **EF-95 (🔴)** Arbitrage depuis le canal : approuver, réviser, refuser.
- **EF-96 (🔴)** **Motif obligatoire** pour refus et révision, imposé par formulaire.
- **EF-97 (🔴)** Action refusée si le compte n'est pas lié ou le rôle non habilité, via message **éphémère**.
- **EF-98 (🔴)** Message mis à jour après résolution : décision, auteur, motif, horodatage ; boutons retirés.
- **EF-99 (🔴)** Gate déjà résolu : seconde tentative sans effet, avec restitution de la décision existante.

### 5.3 Évaluation

- **EF-100 (🔴)** Vote depuis le canal, pondéré par le rôle du compte lié.
- **EF-101 (🔴)** Agrégat mis à jour en place : moyenne pondérée, dispersion, consensus, recommandation.
- **EF-102 (🔴)** Un évaluateur ne compte qu'une fois ; un nouveau vote remplace le précédent.

### 5.4 Collecte

- **EF-103 (🔴)** Capture d'idée depuis un message existant, une commande, ou l'accueil de l'application.
- **EF-104 (🔴)** Formulaire reprenant le canevas Recueillir, avec restitution des hypothèses et cibles d'attaque dérivées.
- **EF-105 (🔴)** Lien bidirectionnel conversation ↔ idée.
- **EF-106 (🔴)** Information de l'auteur si sa soumission est soumise à modération.

### 5.5 Suivi

- **EF-107 (🔴)** Alerte de dérive KPI avec écart vs projeté et position P10–P90.
- **EF-108 (🔴)** Ouverture d'un re-arbitrage depuis l'alerte.
- **EF-109 (🔴)** Digest périodique par canal ; digest vide non publié.

---

## 6. Différences entre plateformes — ce qui change vraiment

| Sujet | Slack | Teams | Discord | Impact |
|---|---|---|---|---|
| Maturité des formulaires | Modals natifs, très souples | Task modules, plus rigides | Modals limités (5 champs) | **Le canevas Recueillir complet ne tient pas dans un modal Discord** → saisie en deux temps ou lien vers le back-office |
| Mise à jour d'un message | Native et fiable | Native | Native | Parcours §4.1 identique partout |
| Éphémère | Natif | Limité | Natif (`ephemeral`) | Sur Teams, le refus d'habilitation passe en message direct |
| Publication d'entreprise | Approbation espace de travail | Approbation locataire + Azure AD | Permissions serveur | Teams demande le cycle de validation le plus lourd |
| Cible naturelle | Tech, scale-ups | Grands comptes, secteur régulé | Communautés, écosystèmes ouverts | **Teams est prioritaire** pour la cible entreprise du site |

> **Recommandation de séquencement.** Slack d'abord (implémentation la plus rapide, écosystème le plus documenté), puis Teams (cible commerciale réelle : la page d'offre parle de NIS2, DORA, souveraineté — ce public est sur Teams), Discord ensuite. Discord reste pertinent pour un usage communautaire ou une édition ouverte, pas pour le cœur de cible entreprise.

---

## 7. Risques & points d'attention

| Risque | Analyse | Mitigation |
|---|---|---|
| **Veto usurpé** | Un bouton dans un canal est visible de tous | Liaison de compte obligatoire, RBAC côté KayrosLab, refus éphémère (§2) |
| **Contournement des règles** | La commodité pousse à alléger le motif obligatoire | Motif imposé par formulaire ; même règle qu'en back-office |
| **Fatigue de notification** | Trop de messages = plus aucun message lu | Digest vide non publié, activité filtrée par abonnement, jamais notifier l'auteur de sa propre action |
| **Fuite inter-tenant** | Un canal mal configuré expose des idées d'un autre client | Tenant issu du compte lié, jamais du canal |
| **Dépendance au chat** | Le processus ne doit pas s'arrêter si Slack tombe | Aucune fonction exclusive au chat (§3.3) |
| **Charge de conformité** | Publier sur un marketplace impose un dossier sécurité | Prévoir SSO SAML, politique de rétention, contact sécurité — Brightidea publie ces éléments, un acheteur entreprise les comparera |

---

## 8. Ce que cette intégration apporte de plus que Brightidea

| Capacité | Brightidea | KayrosLab visé |
|---|---|---|
| Capture depuis un message | ✅ | ✅ |
| Canevas structuré à la saisie | ❌ | ✅ avec dérivation hypothèses/cibles |
| Vote pondéré par rôle en canal | ❌ | ✅ |
| **Arbitrage avec veto motivé en canal** | ❌ | ✅ |
| Alerte de dérive réalisé vs projeté | ❌ | ✅ |
| Trace d'audit dans le fil | ❌ | ✅ message mis à jour |
| Multi-plateforme | Slack seul | Slack · Teams · Discord |

Le point 3 est le différenciateur : Brightidea amène **la matière** dans l'outil, KayrosLab amène **la décision** dans le canal.

---

## 9. Réserves

- Les capacités des plateformes ont été établies à partir de la fiche marketplace Brightidea et des modèles d'intégration connus. **Les limites précises des formulaires Teams et Discord doivent être vérifiées** sur la documentation courante avant spécification technique.
- Aucun prototype n'a été réalisé : cette spécification est un cadrage fonctionnel, pas une validation d'implémentation.
- Le connecteur suppose le **backend déployé et joignable** (P2), condition non encore remplie.

---

*Spécification établie par comparaison avec l'app Brightidea (Slack Marketplace) et alignée sur les exigences EF-01 → EF-87 du système.*
