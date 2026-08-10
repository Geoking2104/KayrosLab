# KayrosLab — Analyse d'écarts fonctionnels vs Brightidea (Idea Box)

> **Objet.** Synthèse extensive des éléments fonctionnels **manquants dans KayrosLab**, établie par observation directe de l'instance Brightidea `cubediagnostics.brightidea.com` (Idea Box, 32 idées, pipeline « Research Pipeline »).
> **Date.** 2026-07-21 · **Version.** 1.0 · **Statut.** À arbitrer.

---

## 0. Résumé exécutif

Brightidea et KayrosLab **ne jouent pas le même match**, et c'est le point central de cette analyse.

- **Brightidea** est une **plateforme SaaS de gestion de l'innovation** : elle industrialise la *collecte de masse*, le *tri collaboratif*, le *pipeline stage-gate* et le *suivi d'impact financier*. Son intelligence est **organisationnelle** (workflow, rôles, règles, notifications).
- **KayrosLab** est un **moteur d'idéation gouverné par IA** : sa valeur est la *qualité du raisonnement* (multi-agents, Red Team, bisociation), la *gouvernance des sorties* (gates, veto) et la *rigueur des chiffres* (Monte-Carlo déterministe).

**Conséquence.** Les écarts identifiés sont massivement des écarts de **plateforme** (persistance, multi-utilisateur, portefeuille, administration), **pas** des écarts d'intelligence. KayrosLab est en avance sur le raisonnement et très en retard sur l'industrialisation.

**Chiffre clé.** Sur les 15 familles fonctionnelles observées chez Brightidea, KayrosLab en couvre **2 pleinement**, **3 partiellement**, et **10 pas du tout**.

**Recommandation directrice.** Ne pas chercher à cloner Brightidea. Cibler la **couche portefeuille + persistance multi-utilisateur** (P0), qui débloque tout le reste, et conserver l'avantage IA comme différenciateur.

---

## 1. Méthode & périmètre

**Source.** Navigation directe de l'instance : `/IdeaBox/boards` (liste + facettes), `/app/pipeline/2372` (pipeline stage-gate), `/app/pipeline/2372/configure/*` (administration).

**Limites de l'observation.** Instance en essai (29 jours restants), jeu de données de démonstration (Artemis). Les pages `Scorecards` et `Dashboard` n'ont pas rendu leur contenu détaillé — leurs capacités sont **inférées de la navigation et des filtres**, et marquées comme telles (⚠️ inféré).

**Convention de lecture.**

| Symbole | Sens |
|---|---|
| 🟢 | Couvert par KayrosLab |
| 🟡 | Partiellement couvert |
| 🔴 | Absent |
| ⚠️ | Observation inférée, à confirmer |

---

## 2. Le modèle Brightidea observé

### 2.1 Entité « idée »

Chaque idée porte : identifiant stable (`D100`…`D131`), titre, **auteur nommé** (avatar), corps de texte, badge de **statut**, compteur de **votes**, compteur de **commentaires**, et — pour les idées matures — un bloc de **questions structurées** posées à la soumission :

- Quelle est la proposition de valeur ?
- Quel problème résolvez-vous ?
- Quelles ressources clés votre proposition nécessite-t-elle ?
- Qui sont les parties prenantes clés ?
- Quels sont les risques clés d'exécution ?
- Décrivez l'expérience de votre équipe.

C'est un **canevas d'intake normalisé** : toutes les idées deviennent comparables dès l'entrée.

### 2.2 Deux axes orthogonaux : Statut × Étape

C'est la subtilité structurante du modèle, et **KayrosLab ne l'a pas**.

| Axe | Valeurs observées | Rôle |
|---|---|---|
| **Statut** (état social/décisionnel) | New · Under Review · Community Discussion · Not Pursued · For Future Consideration · In Development · Completed · No Plans to Implement | Où en est la *décision* |
| **Étape** (avancement projet) | Screening · Project ROI Analysis · Project Implementation · Impact Tracking | Où en est l'*exécution* |

Une idée peut être « Under Review » (statut) tout en étant en « Project ROI Analysis » (étape). KayrosLab confond ces deux dimensions dans une séquence unique.

### 2.3 Pipeline stage-gate opérationnel

Vue kanban par colonnes, avec **compteurs de charge (WIP)** :

| Phase | Étape opérationnelle | Volume |
|---|---|---|
| Screening | Screen Project Opportunities | 7 |
| Project ROI Analysis | Develop Business Case | 7 |
| Project Implementation | Evaluate Project Opportunities | 10 |
| Project Implementation | Plan and Prepare Projects | 6 |
| Project Implementation | Conduct Pilot | 1 |
| Project Implementation | Roll Out | 1 |
| Impact Tracking | Track Business Impact | 0 |

**Observation majeure.** Le processus ne s'arrête pas à la décision : il va jusqu'au **pilote**, au **déploiement** et au **suivi d'impact réel**.

### 2.4 Scoring différencié par étape

Les scores affichés changent d'échelle selon la phase :

- **Screening** : 3.5 · 4.0 · 6.0 → échelle ~0–10
- **Evaluate Project Opportunities** : 52 · 60 · 64 · 68 · 70 · 72 · 76 → échelle ~0–100

Il existe donc **plusieurs grilles d'évaluation (scorecards), une par étape**, avec des critères et pondérations propres. Certaines idées affichent `-` (non encore évaluées).

### 2.5 Suivi financier

Les facettes exposent **Cost ($)** et **Benefit ($)** avec les états « No Investments Recorded » / « No Benefits Recorded » : chaque idée peut porter des **investissements** et des **bénéfices constatés**, alimentant l'étape *Track Business Impact*.

### 2.6 Administration & configuration

Le menu *Setup* révèle la profondeur de la plateforme :

| Section | Capacité |
|---|---|
| Site / Information | Identité de la campagne |
| **People** | Annuaire des participants |
| **Roles** | Rôles fonctionnels |
| **Access Groups** | Groupes de permissions (visibilité/action) |
| **Workflow** | Configuration des étapes et transitions |
| **Scorecards** | Grilles d'évaluation paramétrables ⚠️ inféré |
| **Rules** | Moteur de règles / automatisations ⚠️ inféré |
| **Email Alerts** | 3 modes : *Activity-Based*, *Scheduler*, *Rules-Driven* |
| **Edit Master Template** | Gabarit réutilisable pour dupliquer une campagne |

### 2.7 Vues, recherche et engagement

- Vues multiples : **List · Steps · Dashboard · Knowledge Base**
- **Recherche plein texte** globale + **facettes** (My Activities, Status, Stage, Category, Cost, Benefit)
- **Multi-campagnes** (sélecteur « Idea Box » → plusieurs pipelines/sites)
- Engagement : **vote**, **commentaire**, **abonnement**, **partage**, notifications
- Actions groupées, *Quick Add*, support intégré (Intercom)

---

## 3. État actuel de KayrosLab

**Acquis solides (le différenciateur) :**

- Processus **cyclique en 6 étapes** (Écouter → Cartographier → Construire → Éprouver → Arbitrer → Projeter → Écouter)
- **Multi-agents IA** : Planner, Critic, Devil's Advocate, **Red Team offensive**, Bisociateur, Synthesizer
- **Orchestration réelle** : Plan-and-Solve + ReAct, Planner LLM avec repli déterministe
- **Gouvernance** : gates, RBAC (rôles comex/expert/red team), **droit de veto**, classifieur de sensibilité
- **Mémoire** : Shared + Vector (InMemory/Qdrant), orchestrateur *memory-aware*
- **Chiffres déterministes** : Monte-Carlo seedé (P10/P50/P90), estimation ETP/budget/TCO/ROI
- **Boucle apprenante** : KPIs → re-injection dans Écouter → re-arbitrage
- **Résilience** : Retry + Circuit Breaker, multi-provider (Claude/Ollama), souveraineté locale
- 45 tests, zéro dépendance

**Limites structurelles :**

- **Mono-idée dans l'usage réel** : pas de vision portefeuille
- **Persistance faible** : `localStorage`, pas de base partagée
- **Mono-utilisateur** : pas de comptes, pas de sessions concurrentes
- **Pas de collecte ouverte** : aucune soumission par une communauté
- **Pas d'exécution post-décision** : Projeter produit une roadmap, mais rien ne suit son exécution réelle

---

## 4. Écarts fonctionnels détaillés

### A. Collecte & soumission ouverte 🔴

| Fonctionnalité Brightidea | KayrosLab | Criticité | Effort |
|---|---|---|---|
| Formulaire de soumission structuré (canevas de questions) | 🔴 absent | **Haute** | M |
| Soumission par tout collaborateur (crowd-sourcing) | 🔴 absent | **Haute** | L |
| Campagnes/défis thématiques multiples | 🔴 absent | Moyenne | L |
| Modération / file d'attente d'entrée | 🔴 absent | Moyenne | M |
| *Quick Add* (saisie rapide) | 🔴 absent | Basse | S |

**Analyse.** KayrosLab démarre sur un corpus de signaux fourni ; il n'a **aucun mécanisme d'alimentation par une organisation**. C'est le premier verrou d'adoption en entreprise : sans collecte, pas de matière.

**Recommandation.** Créer une **étape 0 « Recueillir »** (ou une porte d'entrée d'Écouter) : formulaire structuré reprenant le canevas Brightidea (valeur, problème, ressources, parties prenantes, risques, équipe). Ces champs alimenteraient directement les hypothèses de *Construire* et les cibles d'attaque d'*Éprouver* — synergie forte avec l'existant.

---

### B. Portefeuille & pipeline multi-idées 🔴

| Fonctionnalité | KayrosLab | Criticité | Effort |
|---|---|---|---|
| Vue kanban par étapes avec colonnes | 🔴 absent | **Critique** | M |
| Compteurs de charge (WIP) par étape | 🔴 absent | Haute | S |
| Vues alternatives (List / Steps / Dashboard) | 🔴 absent | Haute | M |
| Transitions d'idées entre étapes | 🟡 conceptuel (pas d'UI portefeuille) | **Critique** | M |
| Comparaison inter-idées | 🔴 absent | Haute | M |
| Actions groupées (bulk) | 🔴 absent | Basse | S |

**Analyse.** C'est **l'écart le plus structurant**. KayrosLab raisonne remarquablement sur *une* idée mais ne sait pas répondre à « où en est mon portefeuille de 32 idées ? ». Or c'est précisément la question d'un COMEX.

**Recommandation.** **P0.** Une vue portefeuille kanban sur les 6 étapes, avec compteurs et KI comparatif par idée. C'est le déblocage le plus rentable : il transforme un outil d'atelier en outil de pilotage.

---

### C. Double axe Statut × Étape 🔴

| Fonctionnalité | KayrosLab | Criticité | Effort |
|---|---|---|---|
| Statut décisionnel indépendant de l'étape | 🔴 absent | **Haute** | S |
| États « For Future Consideration », « Not Pursued », « On Hold » | 🟡 partiel (Go/No-Go/Révision) | Haute | S |
| Idées dormantes réactivables | 🟡 prévu (capitalisation No-Go) | Moyenne | S |

**Analyse.** KayrosLab a une position unique dans le flux, alors que la réalité exige deux dimensions : *où en est la décision* vs *où en est l'exécution*. Sans cela, impossible de modéliser « idée validée mais gelée faute de budget ».

**Recommandation.** **P0, effort faible, valeur élevée.** Ajouter un champ `statut` orthogonal à `étape` dans le modèle de données. Notre `capitalisation No-Go` de l'étape Projeter est déjà un embryon de cette logique.

---

### D. Scorecards configurables 🟡

| Fonctionnalité | KayrosLab | Criticité | Effort |
|---|---|---|---|
| Grille d'évaluation **par étape** (échelles différenciées) | 🔴 absent (KI unique) | **Haute** | M |
| Critères et pondérations **paramétrables** | 🔴 figés dans le code | Haute | M |
| Score agrégé multi-évaluateurs | 🔴 absent | Haute | M |
| État « non évalué » explicite | 🔴 absent | Basse | S |
| Historique du score dans le temps | 🟡 KI recalculé, non historisé | Moyenne | S |

**Analyse.** Le **KI** de KayrosLab (5 dimensions stratégiques + 6 techniques) est conceptuellement **plus riche** que les scorecards observées. Mais il est **figé** (codé en dur) et **mono-grille**, là où Brightidea permet une grille par étape, configurable par l'organisation.

**Recommandation.** Rendre le KI **paramétrable** (critères, poids, échelle) et **multi-grilles** (une par étape : screening léger, évaluation approfondie). Conserver le calcul KI comme moteur — c'est un avantage, pas un défaut.

---

### E. Évaluation collaborative 🔴

| Fonctionnalité | KayrosLab | Criticité | Effort |
|---|---|---|---|
| Vote de la communauté | 🔴 absent | **Haute** | M |
| Notation par plusieurs évaluateurs | 🔴 absent | **Haute** | M |
| Agrégation + pondération par rôle | 🟡 RBAC existe, pas d'agrégation de votes | Haute | M |
| Discussion / commentaires par idée | 🔴 absent | Haute | M |
| Working Group formalisé | 🟡 spécifié, non implémenté | Haute | M |

**Analyse.** La gouvernance de KayrosLab est **binaire et verticale** (un censeur approuve/veto). Brightidea est **horizontal et quantitatif** (N votes, moyenne). Les deux sont complémentaires : le vote collectif *instruit* la décision, le veto la *tranche*.

**Recommandation.** Ajouter une couche de vote/notation multi-évaluateurs **en amont du gate**, dont le résultat agrégé devient une entrée de la décision COMEX. Cela renforce le HIL sans diluer le veto.

---

### F. Suivi financier & impact réel 🟡

| Fonctionnalité | KayrosLab | Criticité | Effort |
|---|---|---|---|
| Investissements enregistrés par idée | 🔴 absent | **Haute** | M |
| Bénéfices constatés par idée | 🔴 absent | **Haute** | M |
| Étape dédiée « Track Business Impact » | 🟡 Projeter s'arrête à la projection | Haute | M |
| **Réalisé vs projeté** (écart) | 🔴 absent | **Critique** | M |
| ROI agrégé au niveau portefeuille | 🔴 absent | Haute | M |

**Analyse.** KayrosLab **projette** remarquablement (Monte-Carlo, P10/P50/P90, TCO, ROI projeté) mais **ne confronte jamais la projection au réel**. Brightidea, à l'inverse, trace le réel sans le projeter finement.

**Recommandation — opportunité de différenciation forte.** Boucler *projeté → réalisé* : notre boucle EF-43 (KPIs → Écouter) est **déjà l'ossature technique** de ce suivi. Il manque le stockage des valeurs réalisées et le calcul d'écart. **C'est l'écart où KayrosLab peut dépasser Brightidea**, pas seulement le rattraper.

---

### G. Administration, rôles & permissions 🟡

| Fonctionnalité | KayrosLab | Criticité | Effort |
|---|---|---|---|
| Annuaire des participants (People) | 🔴 absent | **Haute** | M |
| Rôles configurables | 🟡 RBAC codé en dur | Haute | M |
| Groupes d'accès / visibilité fine | 🔴 absent | Haute | L |
| Configuration du workflow sans code | 🔴 absent | Moyenne | L |
| Gabarit de campagne réutilisable | 🔴 absent | Basse | M |

**Analyse.** KayrosLab possède les **concepts** (rôles comex/expert/red team, veto) mais **aucune administration** : tout est en dur. Inutilisable en entreprise multi-équipes.

---

### H. Moteur de règles & automatisations 🔴

| Fonctionnalité | KayrosLab | Criticité | Effort |
|---|---|---|---|
| Règles conditionnelles (si X alors Y) | 🔴 absent | Moyenne | L |
| Transitions automatiques d'étape | 🟡 orchestrateur enchaîne, pas de règles métier | Moyenne | M |
| Escalades sur seuil / délai | 🟡 seuils KPI en Projeter uniquement | Moyenne | M |

**Analyse.** Écart réel mais **non prioritaire** : c'est une couche de confort qui n'a de sens qu'une fois le portefeuille et les rôles en place.

---

### I. Notifications & communication 🔴

| Fonctionnalité | KayrosLab | Criticité | Effort |
|---|---|---|---|
| Alertes email par activité | 🔴 absent | **Haute** | M |
| Alertes planifiées (digest) | 🔴 absent | Moyenne | M |
| Alertes pilotées par règles | 🔴 absent | Moyenne | M |
| Abonnement à une idée | 🔴 absent | Haute | S |
| Notification de gate en attente | 🔴 absent | **Critique** | S |

**Analyse.** **Point de rupture opérationnel.** Un gate de gouvernance en attente **sans notification** bloque le processus indéfiniment : le censeur ne sait pas qu'on l'attend. C'est un défaut fonctionnel bloquant de l'implémentation actuelle, pas un simple confort.

**Recommandation.** **P0, effort faible.** Notifier l'ouverture d'un gate. Sans cela, toute la gouvernance reste théorique.

---

### J. Recherche & navigation 🔴

| Fonctionnalité | KayrosLab | Criticité | Effort |
|---|---|---|---|
| Recherche plein texte globale | 🟡 recherche vectorielle interne, non exposée | Haute | S |
| Facettes de filtrage combinables | 🔴 absent | Haute | M |
| Filtres « mes activités » | 🔴 absent | Moyenne | S |
| Tri (récence, score, votes) | 🔴 absent | Moyenne | S |

**Analyse.** KayrosLab dispose d'une **recherche sémantique** (embeddings + Qdrant) techniquement supérieure au plein texte de Brightidea, mais **elle n'est pas exposée à l'utilisateur**. Écart d'interface, pas de capacité — donc peu coûteux à combler.

---

### K. Reporting & tableaux de bord 🔴

| Fonctionnalité | KayrosLab | Criticité | Effort |
|---|---|---|---|
| Dashboard de pipeline | 🔴 absent | **Haute** | M |
| Taux de conversion par étape (entonnoir) | 🔴 absent | Haute | M |
| Temps moyen passé par étape | 🔴 absent | Moyenne | M |
| Reporting portefeuille pour COMEX | 🔴 absent | **Haute** | M |
| Export (PDF/Excel) | 🟡 PDF par idée | Moyenne | S |

**Analyse.** KayrosLab produit d'excellents livrables **par idée** mais **aucune vue agrégée**. Un COMEX pilote un portefeuille, pas une idée.

---

### L. Base de connaissance & capitalisation 🟡

| Fonctionnalité | KayrosLab | Criticité | Effort |
|---|---|---|---|
| Knowledge Base intégrée | 🔴 absent | Moyenne | M |
| Capitalisation des idées non retenues | 🟡 spécifié (No-Go), non implémenté en UI | Haute | S |
| Réutilisation d'idées passées | 🟡 mémoire vectorielle le permet techniquement | Moyenne | S |

**Analyse.** Le socle technique (mémoire vectorielle) est là et **supérieur** ; c'est l'exposition produit qui manque.

---

### M. Persistance & multi-utilisateur 🔴

| Fonctionnalité | KayrosLab | Criticité | Effort |
|---|---|---|---|
| Base de données partagée | 🔴 `localStorage` | **Critique** | L |
| Comptes utilisateurs / authentification | 🔴 absent | **Critique** | L |
| Sessions concurrentes | 🔴 absent | **Critique** | L |
| Multi-tenant / isolation client | 🔴 absent | Haute | L |
| Historique d'audit persistant | 🟢 `core/audit.mjs` (`FileAuditStore` JSONL + hydratation `ctx.activites`) — `KAYROS_AUDIT_FILE` | **Haute** | M |

**Analyse.** **Verrou racine.** Sans persistance serveur ni comptes, aucune fonctionnalité collaborative (vote, commentaire, notification, portefeuille partagé) n'est réalisable. Tout le reste en dépend.

---

### N. Cycle de vie post-décision 🟡

| Fonctionnalité | KayrosLab | Criticité | Effort |
|---|---|---|---|
| Étape Pilote | 🔴 absent | Haute | M |
| Étape Déploiement (Roll Out) | 🔴 absent | Haute | M |
| Suivi d'exécution des jalons | 🟡 roadmap produite, exécution non suivie | **Haute** | M |
| Clôture et bilan | 🔴 absent | Moyenne | S |

**Analyse.** Notre étape **Projeter** est désormais **complète** (EF-39→45 🟢) : roadmap + ressources/budget + projections probabilisées Monte-Carlo, matrice de risques (EF-42), boucle Projeter → Écouter (EF-43 : seuils KPI + dérive → signal → gate `re_arbitrage`), capitalisation No-Go (EF-44, idées dormantes reactivables) et jalons de gouvernance futurs (EF-45 : gates COMEX datés, matérialisés à échéance) — le tout tracé par le journal d'audit persistant (EF-32). Le différenciateur « projeté → réalisé » est en place ; reste le reporting d'impact en continu côté connecteurs.

**Étape 5 Arbitrer 🟢.** La **synthèse d'arbitrage** (F1) compose désormais un dossier COMEX à partir de données réelles uniquement (`GET /v1/ideas/:id/arbitrage` : recommandation du groupe de travail, red flags de la matrice de risques, projection, gates en attente), le **vote multi-critères** est formalisé (EF-13, Working Group quorum + pondération par rôle, consultatif) et la **décision est tracée et immuable** (EF-14 : journal append-only `idea.decisions` horodaté et signé par l'auteur, alimenté à chaque résolution de gate, exposé par `GET /v1/ideas/:id/decisions`).

---

### O. Engagement & vie sociale 🔴

| Fonctionnalité | KayrosLab | Criticité | Effort |
|---|---|---|---|
| Commentaires / fil de discussion | 🔴 absent | Haute | M |
| Votes / likes | 🔴 absent | Haute | S |
| Abonnements | 🔴 absent | Moyenne | S |
| Partage d'idée | 🔴 absent | Moyenne | S |
| Attribution & visibilité de l'auteur | 🔴 absent | Haute | S |

---

## 5. Ce que KayrosLab possède et Brightidea non

À préserver absolument — c'est la raison d'être du produit.

| Capacité KayrosLab | Absent chez Brightidea |
|---|---|
| **Multi-agents IA spécialisés** (Planner, Critic, Devil's Advocate, Bisociateur, Synthesizer) | ✅ |
| **Red Team offensive** produisant des *kill shots* | ✅ |
| **Bisociation / Collision Mode** (créativité forcée) | ✅ |
| **Orchestration Plan-and-Solve + ReAct** | ✅ |
| **Gouvernance avec droit de veto** et classifieur de sensibilité | ✅ |
| **Monte-Carlo déterministe** (P10/P50/P90, valeur attendue) | ✅ |
| **Mémoire vectorielle sémantique** entre idées | ✅ |
| **Souveraineté** (Ollama local, aucune donnée sortante) | ✅ |
| **Résilience** (Retry + Circuit Breaker, multi-provider) | ✅ |
| **Boucle apprenante** KPIs → nouveaux signaux | ✅ |

**Positionnement qui en découle.** KayrosLab n'est pas « un Brightidea moins cher ». C'est **la couche d'intelligence critique** qui manque à Brightidea. Deux stratégies possibles : (1) devenir une plateforme complète, (2) se positionner en **complément/greffon** d'une plateforme existante. Cette analyse ne tranche pas — c'est un arbitrage produit.

---

## 6. Backlog priorisé

### P0 — Verrous bloquants (sans eux, rien d'autre n'est possible)

| # | Élément | Famille | Effort | Justification |
|---|---|---|---|---|
| 1 | **Persistance serveur + modèle de données** | M | L | Racine de toutes les fonctions collaboratives |
| 2 | **Comptes utilisateurs & authentification** | M | L | Prérequis vote, commentaire, attribution |
| 3 | **Vue portefeuille kanban 6 étapes + WIP** | B | M | Transforme l'atelier en outil de pilotage |
| 4 | **Statut orthogonal à l'étape** | C | S | Faible coût, forte valeur de modélisation |
| 5 | **Notification d'ouverture de gate** | I | S | La gouvernance actuelle est bloquante sans elle |

### P1 — Adoption en entreprise

| # | Élément | Famille | Effort |
|---|---|---|---|
| 6 | Formulaire de soumission structuré (« Recueillir ») | A | M |
| 7 | Vote & notation multi-évaluateurs, agrégés avant le gate | E | M |
| 8 | Commentaires par idée | O | M |
| 9 | KI paramétrable + grille par étape | D | M |
| 10 | Dashboard portefeuille (entonnoir, conversion) | K | M |
| 11 | Rôles & annuaire configurables | G | M |
| 12 | Recherche sémantique exposée + facettes | J | S |

### P2 — Industrialisation & différenciation

| # | Élément | Famille | Effort |
|---|---|---|---|
| 13 | **Réalisé vs projeté** (suivi d'impact financier) | F | M |
| 14 | Étapes Pilote / Roll Out / Bilan | N | M |
| 15 | Alertes email (activité, digest, règles) | I | M |
| 16 | Moteur de règles & transitions automatiques | H | L |
| 17 | Multi-campagnes & gabarits | A/G | L |
| 18 | Knowledge Base & capitalisation exposée | L | M |

**Lecture.** Le P0 est presque entièrement une **dette de plateforme**, pas d'intelligence. C'est cohérent avec le diagnostic : KayrosLab a construit le moteur avant le châssis.

---

## 7. Risques & points d'attention

| Risque | Analyse | Mitigation |
|---|---|---|
| **Dérive « clone de Brightidea »** | Vouloir tout rattraper dilue le différenciateur IA et engage sur un terrain où le concurrent a 15 ans d'avance | Ne traiter que P0 + P1 ciblés ; assumer de ne pas couvrir H, et une partie de G |
| **Sous-estimation du chantier persistance** | Passer de `localStorage` à un backend multi-tenant est un projet en soi, pas une tâche | Le traiter comme un lot autonome avec son propre jalon |
| **Gouvernance théorique** | Gates sans notification = processus bloqué en production | P0 #5, effort faible, à traiter immédiatement |
| **KI figé** | Chaque organisation a ses critères ; un KI en dur limite l'adoption | Paramétrage (P1 #9) |
| **Complexité UI** | 6 étapes × 2 axes × N idées × scorecards : risque d'illisibilité | Concevoir la vue portefeuille avant d'ajouter des dimensions |
| **Observation partielle** | Scorecards/Dashboard/Rules non rendus ⚠️ | Refaire une passe ciblée avant de spécifier D, H et K en détail |

---

## 8. Impact sur les spécifications

Les écarts retenus doivent devenir des exigences fonctionnelles numérotées. La numérotation actuelle va jusqu'à **EF-45** (étape Projeter) ; les nouvelles exigences démarreraient donc à **EF-46**.

**Blocs à créer :**

| Bloc | Périmètre | EF proposées |
|---|---|---|
| Persistance & comptes | Base partagée, authentification, multi-tenant, audit persistant | EF-46 → EF-50 |
| Portefeuille | Kanban, WIP, vues, comparaison inter-idées | EF-51 → EF-55 |
| Statut × Étape | Axe décisionnel, états dormants, réactivation | EF-56 → EF-58 |
| Collecte | Formulaire structuré, campagnes, modération | EF-59 → EF-62 |
| Évaluation collaborative | Vote, notation multi-évaluateurs, agrégation, commentaires | EF-63 → EF-67 |
| Scorecards | KI paramétrable, grille par étape, historisation | EF-68 → EF-71 |
| Notifications | Gate, activité, digest | EF-72 → EF-75 |
| Impact réel | Investissements, bénéfices, réalisé vs projeté | EF-76 → EF-79 |
| Cycle aval | Pilote, Roll Out, bilan | EF-80 → EF-83 |
| Reporting | Dashboard, entonnoir, export portefeuille | EF-84 → EF-87 |

**Impact sur le modèle de processus.** Deux évolutions structurelles à arbitrer :

1. Ajouter une **étape 0 « Recueillir »** en amont d'Écouter (collecte ouverte).
2. Étendre **Projeter** vers l'aval (Pilote → Roll Out → Bilan), ou créer une **étape 7 « Réaliser »**.

Ces deux points modifient le schéma canonique des 6 étapes : **à valider avant toute rédaction de spec.**

---

## 9. Conclusion

KayrosLab a construit ce qui est **le plus difficile à copier** : un moteur de raisonnement gouverné, multi-agents, avec rigueur numérique et souveraineté. Brightidea a construit ce qui est **le plus long à construire** : une plateforme d'entreprise complète, administrable et collaborative.

L'écart n'est pas un retard d'intelligence, c'est **une absence de châssis**. Les cinq éléments P0 — persistance, comptes, portefeuille, statut orthogonal, notification de gate — conditionnent tout le reste.

**Une décision produit est à prendre avant d'engager le chantier** : KayrosLab devient-il une plateforme autonome, ou la couche d'intelligence qui se greffe sur les plateformes existantes ? Le backlog ci-dessus est valable dans les deux cas pour le P0, mais diverge fortement en P1/P2.

---

*Document établi par observation directe de `cubediagnostics.brightidea.com` — instance d'essai, jeu de données de démonstration. Les éléments marqués ⚠️ demandent une seconde passe de vérification.*
