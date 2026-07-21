# KayrosLab — Spécifications Fonctionnelles

> **Du Signal Faible à la Décision Stratégique — Atelier d'Idéation Agentique Hybride, vers un « LLM gouverné ».**

| | |
|---|---|
| **Document** | Spécifications fonctionnelles (SFD) |
| **Version** | 0.2 — décisions produit intégrées, en cours de validation |
| **Date** | 15 juillet 2026 |
| **Statut** | 🟡 En validation (les specs techniques suivront une fois ce document validé) |
| **Auteur** | Geoffroy de La Tournelle — Founder & Director, KayrosLab |
| **Dépôt** | https://github.com/Geoking2104/KayrosLab |
| **Audience** | Mixte : COMEX / produit **et** équipe technique |
| **Périmètre** | Système **cible** (orchestrateur + agents IA + censeurs humains + exposition « LLM gouverné »), fondé sur l'existant du dépôt et des prototypes |

**Convention de lecture.** Chaque fonctionnalité est qualifiée :
`🟢 Existant` (codé dans un artefact) · `🟠 Partiel` (simulé / maquetté) · `🔵 Cible` (à construire). Les identifiants d'exigences sont de la forme `EF-XX` (exigence fonctionnelle) et `US-XX` (user story).

---

## 0. Résumé exécutif

KayrosLab est un **atelier d'idéation stratégique gouverné** qui transforme des signaux faibles en décisions robustes via un processus traçable et **cyclique en 6 étapes** (Écouter → Cartographier → Construire → Éprouver → Arbitrer → Projeter, qui reboucle sur Écouter). Sa singularité par rapport à un LLM conversationnel classique tient à trois piliers :

1. **Un collectif d'agents IA spécialisés** (Planner, Critic, Devil's Advocate, Red Team, Bisociateur, Synthesizer) plutôt qu'un modèle unique.
2. **Un orchestrateur** qui planifie, séquence et arbitre les agents (paradigme *Plan-and-Solve + ReAct*) avec mémoire partagée et vectorielle.
3. **Des censeurs humains** (Human-in-the-Loop structuré) disposant de **droits de validation et de veto** à des points de contrôle définis.

**L'objectif de transformation** — « faire de KayrosLab un LLM » — est précisé dans ce document comme la construction d'un **« LLM gouverné »** : un produit agentique qui **orchestre de vrais LLMs** (Claude via API, Ollama en local) derrière une couche de gouvernance et expose une **interface unique**. KayrosLab ne devient pas un modèle entraîné ; il devient un **système d'IA composite gouverné** qui *se comporte* comme un assistant expert, mais **traçable, résilient et arbitré par des humains**.

---

## 1. Contexte & Vision

### 1.1 Positionnement

Les LLMs classiques (ChatGPT, Claude, Gemini) génèrent du texte de façon linéaire, sans mémoire durable de l'idée, sans contradiction organisée, ni gouvernance humaine formalisée. KayrosLab industrialise un **processus d'idéation** dans lequel l'IA est un collaborateur au sein d'un dispositif contrôlé.

### 1.2 Objectif de transformation : le « LLM gouverné »

> **Définition retenue (validée).** Un **LLM gouverné** = une interface unique (chat/API) adossée à un orchestrateur qui décompose la demande, mobilise des agents IA spécialisés s'appuyant sur de vrais LLMs, applique des garde-fous de résilience, et **soumet les sorties sensibles à des censeurs humains** avant restitution.

**Ce que c'est :** un système agentique composite, souverain (LLM local possible), traçable et arbitré.
**Ce que ce n'est pas :** un modèle de fondation entraîné par KayrosLab, ni un simple wrapper d'API sans gouvernance.

```mermaid
flowchart LR
    U["Utilisateur / Système appelant"] --> IF["Interface unique<br/>chat + API"]
    IF --> ORCH["Orchestrateur KayrosLab"]
    ORCH --> AG["Agents IA spécialisés"]
    AG --> LLM["LLMs réels<br/>Claude API / Ollama local"]
    ORCH --> GOV["Couche de gouvernance<br/>censeurs humains + veto"]
    GOV --> IF
    ORCH --> MEM["Mémoire partagée + vectorielle"]
    ORCH --> RES["Résilience<br/>Retry + Circuit Breaker"]
```

**Objectifs mesurables (cibles proposées, à arbitrer avec le COMEX) :**

| Objectif | Indicateur | Cible |
|---|---|---|
| Robustesse des idées | Score KI moyen des idées arbitrées | ≥ 7,5 / 10 |
| Gouvernance effective | % de décisions sensibles passées par un censeur humain | 100 % |
| Traçabilité | % d'outputs agents horodatés et rattachés à une idée | 100 % |
| Souveraineté | Fonctionnement complet en LLM local (Ollama) sans cloud | Oui/Non |
| Résilience | % d'appels LLM récupérés par retry/fallback | ≥ 95 % |

---

## 2. Cartographie de l'existant

| Artefact | Emplacement | Rôle réel | Qualification |
|---|---|---|---|
| `kayroslab-complete-with-ai-agents.html` | Dépôt | **Fichier de référence unique** (décision actée) : AI Connectors + délégation externe (simulée), KI dynamique, historique appels/coûts | 🟠 (référence) |
| `kayroslab_standalone.html` (163 Ko) | Prototype local (mai) | App la plus riche fonctionnellement : workflow 5 étapes, Working Groups (HIL), roundtable, livrables/PDF, ROI, feed — **source à ré-intégrer** dans le fichier de référence | 🟢 / 🟠 |
| `kayroslab-enhanced-future-proofing.html` | Dépôt | Variante Future Proofing + Collision Mode — **à consolider puis retirer** | 🟠 |
| `kayroslab-complete-updated.html` | Dépôt | ~~Placeholder vide~~ — **supprimé** (décision actée) | 🗑️ Retiré |
| `Kayros_standalone.html` | Prototype local | Landing / pricing (marketing) | Hors périmètre app |

> **Décision actée (produit).** Le badge « Open in Browser » pointe désormais vers `kayroslab-complete-with-ai-agents.html`, désigné **fichier de référence unique**. Le placeholder est supprimé. La variante `enhanced-future-proofing` et les fonctions du prototype 163 Ko (workflow 5 étapes complet) doivent être **fusionnées** dans ce fichier de référence — c'est un lot d'ingénierie identifié au backlog (§10), qui sera cadré avec les specs techniques.

**Synthèse Existant vs Cible (macro) :**

| Domaine | Existant | Cible |
|---|---|---|
| Processus 5 étapes | 🟢 Écran par étape (163 Ko) | 🔵 Piloté par l'orchestrateur, transitions gouvernées |
| Agents IA | 🟠 Planner/Critic/Bisociateur scriptés | 🔵 Agents réels (LLM) : + Devil's Advocate, Red Team, Synthesizer |
| Orchestrateur | ❌ | 🔵 Plan-and-Solve + ReAct, Tool Registry |
| Censeurs humains | 🟠 Working Groups, votes, tâches | 🔵 Rôles + droits de veto formalisés aux gates |
| Mémoire | 🟠 localStorage | 🔵 Shared Memory + Vector Memory (recherche sémantique) |
| LLM réels | 🟠 Délégation simulée | 🔵 Claude API + Ollama, abstraction `KayrosLLM` |
| Résilience | ❌ | 🔵 Retry backoff + Circuit Breaker |
| Exposition « LLM gouverné » | ❌ | 🔵 Interface/endpoint unique |

---

## 3. Acteurs & rôles

### 3.1 Agents IA spécialisés

| Agent | Fonction | Entrée | Sortie | Statut |
|---|---|---|---|---|
| **Planner** | Décompose la demande en sous-tâches, choisit les outils/agents | Objectif d'idée, contexte | Plan structuré | 🟠→🔵 |
| **Critic** | Identifie faiblesses, biais, angles morts | Proposition | Liste de critiques priorisées | 🟠→🔵 |
| **Devil's Advocate** | Conteste systématiquement l'hypothèse dominante | Scénario retenu | Contre-arguments | 🔵 |
| **Red Team** | Attaques offensives + *kill shots* pour tester la robustesse | Idée challengée | Rapport d'attaque + vulnérabilités | 🔵 |
| **Bisociateur** | Génère des idées originales par collision de concepts distants | 2+ concepts | Idées bisociatives | 🟠→🔵 |
| **Synthesizer** | Consolide débats et versions en une synthèse arbitrable | Timeline, contributions | Synthèse + recommandations | 🟠→🔵 |
| **Connecteurs externes** | Délégation à un LLM tiers (Claude/GPT/Gemini/DeepSeek) comme « compétence » | Sous-tâche | Réponse + coût/tokens | 🟠 (simulé) |

### 3.2 Orchestrateur

Composant central qui : (a) reçoit la demande via l'interface unique ; (b) établit un **plan** (Plan-and-Solve) ; (c) exécute un cycle **ReAct** (raisonnement ↔ action outil ↔ observation) ; (d) mobilise les agents et la mémoire ; (e) applique la résilience ; (f) déclenche les **gates de gouvernance** humaine ; (g) restitue une réponse tracée. `🔵 Cible`.

### 3.3 Censeurs humains (Human-in-the-Loop)

| Rôle humain | Responsabilité | Droit de veto | Point d'intervention |
|---|---|---|---|
| **Arbitre / COMEX** | Décision finale, priorisation ; validation roadmap/budget & jalons futurs | ✅ Oui | Étapes 5 (Arbitrer) & 6 (Projeter) |
| **Expert métier** | Validation de pertinence sectorielle | ⚠️ Conditionnel | Étapes 3–4 |
| **Red Team humaine** | Challenge final avant décision ; scénario adverse projeté | ⚠️ Alerte bloquante | Étapes 4 & 6 |
| **Facilitateur** | Anime le processus, arbitre les Working Groups, valide le RACI | ❌ Non (orchestration) | Toutes étapes |
| **Censeur de sortie** | Contrôle des outputs sensibles avant restitution en mode « LLM gouverné » | ✅ Oui | Gate de sortie (§7) |

> **Working Groups (existant 🟢).** Le prototype 163 Ko permet déjà de rejoindre un groupe de travail, d'assigner/cocher des tâches et de commenter — socle concret des censeurs humains à formaliser.

### 3.4 Matrice rôles (type RACI + veto)

Légende : **R**esponsable · **A**pprobateur · **C**onsulté · **I**nformé · **V** = droit de veto.

| Activité | Orchestrateur | Planner | Critic/Devil | Red Team | Synthesizer | Expert métier | Arbitre COMEX |
|---|---|---|---|---|---|---|---|
| Qualifier les signaux (É1) | A | R | C | I | I | C | I |
| Cartographier tendances (É2) | A | R | C | I | C | C | I |
| Construire scénarios (É3) | A | R | C | I | R | **C/V** | I |
| Éprouver / attaquer (É4) | A | C | R | **R/V** | C | C | I |
| Arbitrer & décider (É5) | C | I | C | C | R | C | **A/V** |
| Projeter trajectoire & roadmap (É6) | A | R | C | C | R | C | **A/V** |
| Restituer en mode LLM gouverné | A | C | C | C | R | I | **A/V** |

---

## 4. Architecture fonctionnelle cible

```mermaid
flowchart TD
    subgraph Entree["Interface unique"]
        CHAT["Chat / API"]
    end
    subgraph Coeur["Cœur agentique"]
        ORCH["Orchestrateur<br/>Plan-and-Solve + ReAct"]
        TOOLS["Tool Registry<br/>search_regulatory_risks, calculate_ki_impact..."]
        AGENTS["Agents IA<br/>Planner, Critic, Devil, Red Team, Bisociateur, Synthesizer"]
    end
    subgraph Memoire["Mémoire"]
        SHARED["Shared Memory"]
        VECTOR["Vector Memory<br/>similarité cosinus"]
    end
    subgraph LLMs["Fournisseurs LLM"]
        CLAUDE["Claude API"]
        OLLAMA["Ollama local"]
    end
    subgraph Gouvernance["Gouvernance humaine"]
        WG["Working Groups"]
        VOTE["Votes multi-critères"]
        VETO["Points de veto"]
    end
    subgraph Robustesse["Résilience"]
        RETRY["Retry backoff"]
        CB["Circuit Breaker<br/>CLOSED / OPEN / HALF_OPEN"]
    end
    CHAT --> ORCH
    ORCH --> AGENTS
    ORCH --> TOOLS
    AGENTS --> KLLM["Abstraction KayrosLLM"]
    KLLM --> CLAUDE
    KLLM --> OLLAMA
    ORCH --> SHARED
    ORCH --> VECTOR
    ORCH --> RETRY --> CB
    ORCH --> WG
    WG --> VOTE --> VETO
    VETO --> ORCH
    ORCH --> KI["Kayroslab Index (KI)"]
    ORCH --> TL["Timeline / audit"]
    ORCH --> CHAT
```

---

## 5. Le processus en 6 étapes (cyclique)

```mermaid
flowchart LR
    E1["01 · Écouter<br/>signaux qualifiés"] --> E2["02 · Cartographier<br/>réseau de tendances"]
    E2 --> E3["03 · Construire<br/>scénarios + brief"]
    E3 --> E4["04 · Éprouver<br/>Critic + Devil + Red Team"]
    E4 --> E5["05 · Arbitrer<br/>décision + livrable"]
    E5 --> E6["06 · Projeter<br/>trajectoire + prospective"]
    E4 -. "kill shot / veto" .-> E3
    E5 -. "révision demandée" .-> E4
    E6 -. "KPIs / signaux de suivi (boucle)" .-> E1
```

> **Modèle cyclique.** Le processus n'est plus linéaire : **Projeter** reboucle sur **Écouter** via les KPIs et signaux de suivi (tâche planifiée), rendant l'idéation continue et apprenante.

Chaque étape est spécifiée ci-dessous : objectif, **fonctionnalités détaillées**, agents, censeurs, entrées/sorties, statut, user stories + critères d'acceptation.

### Étape 1 — Écouter

**Objectif.** Réduire le bruit et qualifier les signaux faibles.
**Agents.** Planner (cadrage), Critic (scoring). **Censeurs.** Expert métier (consulté).
**Entrées.** Corpus de signaux / sources. **Sorties.** Signaux qualifiés & scorés.
**Statut.** 🟢 Réduction de bruit et promotion de signal existent (`promoteNoiseSignal`, `renderNoiseReduction`). 🔵 Scoring assisté par LLM réel.

**Fonctionnalités détaillées.**

| # | Fonctionnalité | Détail |
|---|---|---|
| F1 | Cadrage d'écoute | Le Planner formule périmètre : question stratégique + sources + horizon. |
| F2 | Ingestion multi-source | Saisie texte/URL, upload, connecteurs veille. Signal `{id, source, date, contenu, url?}`. |
| F3 | Déduplication / clustering | Regroupement sémantique (embeddings) → évite doublons, pré-forme les clusters. |
| F4 | Scoring LLM expliqué | Pertinence · fraîcheur · impact → note 0–100 + justification traçable. |
| F5 | Réduction de bruit | Seuil configurable ; signaux sous seuil masqués mais conservés (réversible). |
| F6 | Promotion en signal qualifié | Action humaine horodatée, écrite en mémoire vectorielle (`ideaId`). |
| F7 | Tagging thématique | Tags/clusters proposés pour préparer Cartographier. |

- **EF-01 (🟢)** Le système présente les signaux et permet d'en promouvoir en signaux qualifiés.
- **EF-02 (🔵)** Chaque signal reçoit un score de pertinence expliqué (source, fraîcheur, impact).

> **US-01.** En tant que **stratège**, je veux **filtrer le bruit et promouvoir les signaux prometteurs** afin de **concentrer l'idéation sur l'essentiel**.
> **Critères d'acceptation.**
> *Étant donné* une liste de signaux, *quand* j'en promeus un, *alors* il rejoint la liste des signaux qualifiés avec horodatage.
> *Étant donné* un signal qualifié, *quand* le scoring LLM est activé, *alors* un score et sa justification s'affichent.

### Étape 2 — Cartographier

**Objectif.** Construire le réseau de tendances et repérer les ponts stratégiques.
**Agents.** Planner, Bisociateur (ponts). **Censeurs.** Expert métier (consulté).
**Statut.** 🟢 Réseau de tendances (`renderTrendNetwork`), sélection et envoi vers le scénario (`sendNetworkSelectionToScenario`).

**Fonctionnalités détaillées.**

| # | Fonctionnalité | Détail |
|---|---|---|
| F1 | Construction du réseau | Nœuds = tendances/clusters ; arêtes typées (corrélation, causalité, opposition) proposées par le LLM. |
| F2 | Détection de ponts (bisociation) | Liens non-évidents entre clusters distants, score nouveauté × plausibilité + justification. |
| F3 | Centralité / tendances-pivots | Repérage des nœuds leviers (fort pouvoir structurant). |
| F4 | Zones de tension | Contradictions/oppositions → zones fertiles pour l'idéation. |
| F5 | Horizon temporel | Étiquetage court/moyen/long par tendance (prépare Projeter). |
| F6 | Sélection → Construire | Sélection de nœuds/ponts → payload structuré transmis à l'étape 3. |
| F7 | Recall mémoire | Réutilise les signaux qualifiés d'Écouter via recall vectoriel (`ideaId`). |

- **EF-03 (🟢)** Visualiser les relations entre tendances et sélectionner des nœuds.
- **EF-04 (🔵)** Suggestion automatique de ponts non-évidents (bisociation) entre clusters distants.

> **US-02.** En tant que **facilitateur**, je veux **visualiser les liens entre tendances** afin d'**identifier des opportunités de croisement**.
> **Critères.** *Étant donné* un réseau, *quand* je sélectionne des nœuds, *alors* je peux les envoyer à l'étape Construire.

### Étape 3 — Construire

**Objectif.** Générer des scénarios candidats et un brief structuré.
**Agents.** Planner, Synthesizer, Bisociateur (Collision Mode). **Censeurs.** Expert métier (**consulté / veto conditionnel**).
**Statut.** 🟢 Scenario builder, canvas, collider (`renderScenarioBuilder`, `runShowcaseCollision`, `sendScenarioToCollider`). 🟠 Collision Mode (démo). 🔵 Génération assistée LLM réel.

**Fonctionnalités détaillées.**

| # | Fonctionnalité | Détail |
|---|---|---|
| F1 | Canvas de scénario | Composer/éditer un scénario à partir des nœuds/ponts sélectionnés en Cartographier. |
| F2 | Génération assistée LLM | `Synthesizer` produit 2–3 variantes typées (rupture / prudente / optimiste). |
| F3 | Collision Mode (bisociation) | `Bisociateur` force la collision de 2 concepts distants → idées scorées nouveauté × faisabilité. |
| F4 | Brief structuré | Problème · insight · proposition de valeur · cible · hypothèses clés · métriques. |
| F5 | Hypothèses explicites | Chaque scénario liste ses hypothèses critiques (matière d'Éprouver). |
| F6 | Pré-scoring KI provisoire | KI initial (5 dimensions stratégiques) pour prioriser les scénarios. |
| F7 | Traçabilité | Chaque idée bisociative ajoutée ⇒ timeline horodatée + mémoire. |

- **EF-05 (🟢)** Composer un scénario à partir de signaux/tendances (canvas éditable).
- **EF-06 (🟠→🔵)** Lancer un **Collision Mode** produisant des idées originales par bisociation.
- **EF-07 (🔵)** Produire un **brief structuré** exportable.

> **US-03.** En tant que **stratège**, je veux **assembler des scénarios et déclencher une collision créative** afin d'**obtenir des options non triviales**.
> **Critères.** *Étant donné* un canvas non vide, *quand* je lance Collision Mode, *alors* au moins une idée bisociative est ajoutée à la timeline et tracée.

### Étape 4 — Éprouver

**Objectif.** Challenger les idées (Future Proofing) : Critic + Devil's Advocate + **Red Team offensive**.
**Agents.** Critic, Devil's Advocate, **Red Team**, connecteurs externes. **Censeurs.** Red Team humaine (**alerte bloquante**).
**Statut.** 🟠 Timeline scriptée (Planner→Critic→Bisociateur) + délégation externe simulée + KI dynamique (`runEnhancedFutureProofing`, `delegateToExternalAgent`, `calculateIntelligentKI`). 🔵 Red Team réelle + rapport d'attaque + boucle de correction.

**Fonctionnalités détaillées.**

| # | Fonctionnalité | Détail |
|---|---|---|
| F1 | Future Proofing multi-agents | Timeline horodatée `Critic → Devil's Advocate → Red Team`. |
| F2 | Critic | Angles morts, biais, failles logiques. |
| F3 | Devil's Advocate | Conteste systématiquement les hypothèses clés issues de Construire. |
| F4 | Red Team offensive | Kill shots (attaques létales) + scénarios d'échec plausibles. |
| F5 | Rapport d'attaque | Chaque attaque `{type, sévérité, hypothèse visée, argument/preuve}`. |
| F6 | Boucle de correction | Vulnérabilité « critique » ⇒ renvoi en Étape 3 + blocage d'Arbitrer. |
| F7 | Délégation externe | Sous-tâches à un LLM externe, journalisées (modèle, tokens, coût). |
| F8 | Recalcul KI réel | KI recalculé d'après le travail d'attaque (stratégique + technique). |
| F9 | Red flags résiduels | Faiblesses non bloquantes listées pour l'arbitrage. |

- **EF-08 (🟠)** Lancer un Future Proofing multi-agents affichant une timeline horodatée.
- **EF-09 (🟠)** Déléguer une sous-tâche à un LLM externe et journaliser tokens & coût estimé.
- **EF-10 (🔵)** Produire un **rapport d'attaque** (kill shots) ; une vulnérabilité critique **renvoie le scénario en Étape 3**.
- **EF-11 (🟢/🔵)** Recalculer le **KI** en fonction du travail réel (voir §6.4).

> **US-04.** En tant que **Red Team (humaine ou IA)**, je veux **attaquer l'idée et émettre des kill shots** afin de **ne laisser passer que des idées robustes**.
> **Critères.** *Étant donné* une idée en Étape 4, *quand* une attaque est marquée « critique », *alors* la transition vers Étape 5 est **bloquée** jusqu'à correction ou levée de veto.
> *Étant donné* une délégation externe, *quand* la réponse arrive, *alors* l'appel est historisé (modèle, tokens in/out, coût).

### Étape 5 — Arbitrer

**Objectif.** Challenge humain final, décision, livrable (Gantt, PDF).
**Agents.** Synthesizer. **Censeurs.** **Arbitre / COMEX (approbateur + veto)**.
**Statut.** 🟢 Livrables + génération PDF + ROI + délivrance (`generateIdeaPdf`, `openDeliveryModal`, `updateRoiCalculations`). 🔵 Vote multi-critères formalisé + décision tracée.

**Fonctionnalités détaillées.**

| # | Fonctionnalité | Détail |
|---|---|---|
| F1 | Synthèse d'arbitrage | `Synthesizer` consolide scénario, KI, rapport d'attaque, red flags, ROI. |
| F2 | Vote multi-critères | Working Group : pondération sur les dimensions KI, vote par membre, agrégation tracée. |
| F3 | Décision Go / No-Go / Révision | Tranchée par l'Arbitre / COMEX. |
| F4 | Gate d'approbation + veto | Décision via gate humain ; Révision ⇒ renvoi en Étape 4. |
| F5 | Livrable | PDF + récap ROI + Gantt/roadmap synthétique. |
| F6 | Traçabilité immuable | Décision + auteur + horodatage immuables (audit). |
| F7 | Justification | Motif de décision consigné. |

- **EF-12 (🟢)** Générer un livrable (PDF) et un récapitulatif ROI de l'idée.
- **EF-13 (🔵)** Vote multi-critères (Working Group) débouchant sur une décision **Go / No-Go / Révision**.
- **EF-14 (🔵)** La décision et son auteur humain sont horodatés et immuables dans la timeline.

> **US-05.** En tant qu'**arbitre COMEX**, je veux **trancher sur la base d'une synthèse tracée** afin d'**assumer une décision auditable**.
> **Critères.** *Étant donné* une idée éprouvée, *quand* je vote « No-Go » ou « Révision », *alors* l'idée n'est pas restituée en sortie et la raison est journalisée.

### Étape 6 — Projeter 🔵 *(nouvelle)*

**Objectif.** Transformer **toute décision** d'Arbitrer (Go / No-Go / Révision) en **trajectoire pilotée et prospective probabilisée**, avec allocation de ressources, puis **reboucler automatiquement** sur Écouter.
**Agents.** Planner (roadmap/ressources), Synthesizer (récit/projection), Red Team (scénario adverse projeté), Critic (stress de trajectoire). **Censeurs.** COMEX (roadmap, budget, gates), Facilitateur (RACI).
**Entrées.** Décision + livrable + KI figé + red flags (Arbitrer). **Sorties.** *(Go)* `roadmap{jalons, RACI, ressources, budget, KPIs, risquesProbabilisés, gatesFuturs}` + `projections{scénariosPondérés, P10/P50/P90, valeurAttendue}` ; *(No-Go)* `capitalisation{apprentissages, réactivation, signaux}`.
**Statut.** 🔵 Cible (à construire).

**Portée selon la décision.** **Go** → roadmap + ressources/budget + suivi + projections probabilistes. **No-Go** → capitalisation (apprentissages archivés, conditions de réactivation, signaux à re-surveiller). **Révision** → note de trajectoire conditionnelle renvoyée à Éprouver.

**Fonctionnalités détaillées.**

| # | Fonctionnalité | Détail |
|---|---|---|
| F1 | Roadmap d'exécution (Go) | Now / Next / Later, jalons datés, dépendances. |
| F2 | Attribution & RACI | Porteurs/responsables par jalon. |
| F3 | Ressources & budget | Capacité (ETP), budget/coûts, arbitrage de capacité, TCO/ROI projeté. |
| F4 | Simulation probabiliste | Scénarios base/optimiste/adverse **avec probabilités** + valeur attendue ; Monte-Carlo léger → P10/P50/P90. |
| F5 | Indicateurs de suivi | *Leading/lagging* + seuils d'alerte. |
| F6 | Risques probabilisés | Red flags résiduels → matrice probabilité × impact + déclencheurs de re-arbitrage. |
| F7 | Boucle automatisée | KPIs/signaux ré-injectés dans Écouter via tâche planifiée ; re-arbitrage si seuil franchi. |
| F8 | Jalons de gouvernance | Gates futurs datés (COMEX). |
| F9 | Capitalisation (No-Go) | Archivage structuré des apprentissages + conditions de réactivation. |
| F10 | Export exécution | Roadmap (Gantt) + fiche projet + tableau KPI + note prospective probabiliste. |

> **Rigueur.** Les probabilités/espérances/quantiles sont calculés par un **outil déterministe** (Monte-Carlo/espérance) : le LLM fournit hypothèses et distributions, l'outil calcule — jamais de chiffres inventés. Tout est tracé (hypothèses → résultat).

- **EF-39 (🔵)** Générer, sur décision **Go**, une roadmap datée (Now/Next/Later) avec RACI proposé.
- **EF-40 (🔵)** Estimer **ressources et budget** (ETP, coûts, TCO/ROI projeté) et arbitrer la capacité.
- **EF-41 (🔵)** Produire des **projections de trajectoire probabilisées** (scénarios pondérés, valeur attendue, P10/P50/P90) via un outil déterministe.
- **EF-42 (🔵)** Maintenir une **matrice de risques** (probabilité × impact) avec déclencheurs de re-arbitrage.
- **EF-43 (🔵)** **Reboucler automatiquement** vers Écouter : les KPIs de suivi ré-alimentent le corpus via tâche planifiée.
- **EF-44 (🔵)** Sur décision **No-Go**, produire un **dossier de capitalisation** (apprentissages, conditions de réactivation).
- **EF-45 (🔵)** Planifier des **jalons de gouvernance futurs** (gates COMEX datés).

> **US-06.** En tant que **porteur de projet**, je veux **transformer une décision en trajectoire pilotée et probabilisée** afin de **piloter l'exécution et déclencher un re-arbitrage au bon moment**.
> **Critères.**
> *Étant donné* une décision **Go**, *quand* Projeter s'exécute, *alors* une roadmap datée avec RACI, ressources et budget est produite.
> *Étant donné* des variables clés incertaines, *quand* la simulation tourne, *alors* des scénarios **probabilisés** (valeur attendue + P10/P50/P90) calculés par outil déterministe sont restitués.
> *Étant donné* un KPI franchissant son seuil d'alerte, *quand* la boucle planifiée s'exécute, *alors* un signal est ré-injecté en Écouter et un re-arbitrage est proposé.

---

## 6. Modules transverses

### 6.1 Orchestration (Plan-and-Solve + ReAct) — `🔵 Cible`
- **EF-15** L'orchestrateur établit un plan explicite avant d'agir, puis boucle raisonnement→outil→observation.
- **EF-16** Chaque étape du plan est visible dans la timeline (transparence du raisonnement).
> **Critère.** *Étant donné* une demande, *quand* l'orchestrateur agit, *alors* le plan et chaque action outil sont journalisés et rattachés à l'idée.

### 6.2 Mémoire (Shared + Vector) — `🟠→🔵`
- **EF-17 (🟠)** Persistance de l'état (localStorage aujourd'hui : connecteurs, historique, workflow).
- **EF-18 (🔵)** **Vector Memory** : recherche sémantique (similarité cosinus) pour rappeler idées/contributions passées.
> **Critère.** *Étant donné* une nouvelle idée, *quand* elle est saisie, *alors* le système propose les idées passées les plus similaires.

### 6.3 Gouvernance & censeurs humains — `🟠→🔵`
- **EF-19 (🟢)** Working Groups : rejoindre, assigner/cocher des tâches, commenter.
- **EF-20 (🔵)** **Points de veto** aux gates (É3, É4, É5, sortie) avec rôle habilité et justification obligatoire.
- **EF-21 (🔵)** Votes multi-critères pondérés (les 5 dimensions KI).
> **Critère.** *Étant donné* un gate avec veto disponible, *quand* un censeur habilité l'active, *alors* la progression est stoppée et l'événement est tracé (qui, quand, pourquoi).

### 6.4 Kayroslab Index (KI) — `🟢/🔵`

**Décision actée : le KI repose d'abord sur 5 dimensions stratégiques, puis sur 6 dimensions techniques.**

- **Couche 1 — Dimensions stratégiques (référence de décision, cible) :** **Fit stratégique, Désirabilité, Faisabilité, Viabilité, Adaptabilité**. Ce sont les axes du Radar Chart d'arbitrage (Étape 5) et la base des votes multi-critères des censeurs.
- **Couche 2 — Dimensions techniques (opérationnelles, existant) :** global, vélocité, divergence, fiabilité, impact, originalité — calculées dynamiquement à partir de l'activité d'idéation (items canvas, longueur timeline, présence Bisociateur, appels externes). Elles instrumentent le processus et alimentent la couche stratégique.

- **EF-22 (🟢)** Recalcul du KI technique (6 dimensions) en temps réel selon l'activité d'idéation.
- **EF-23 (🔵)** KI stratégique (5 dimensions) + **Radar Chart** + historique ; les 6 dimensions techniques alimentent le calcul des 5 dimensions stratégiques.
> **Critère.** *Étant donné* une idée en Étape 5, *quand* le KI stratégique est affiché, *alors* les 5 axes (Fit, Désirabilité, Faisabilité, Viabilité, Adaptabilité) sont visibles sur un radar et servent de base au vote.

### 6.5 Connecteurs LLM & AI Connectors — `🟠→🔵`
- **EF-24 (🟠)** Gérer des connecteurs (nom, rôle, provider, clé API démo) en CRUD, stockés localement.
- **EF-25 (🔵)** Abstraction **`KayrosLLM`** : bascule mock → Claude API → Ollama sans changer le code appelant.
- **EF-26 (🔵)** Sélection du fournisseur par politique (souveraineté : forcer Ollama local).
> **Sécurité (voir §8).** Les clés API ne doivent jamais être en clair côté client en production.

### 6.6 Résilience (Retry + Circuit Breaker) — `🔵 Cible`
- **EF-27** Retry exponentiel avec backoff sur échec d'appel LLM.
- **EF-28** Circuit Breaker à 3 états (CLOSED / OPEN / HALF_OPEN) + **fallback** (autre fournisseur ou réponse dégradée tracée).
> **Critère.** *Étant donné* un fournisseur en échec répété, *quand* le seuil est atteint, *alors* le circuit passe OPEN et l'orchestrateur bascule sur le fallback, l'incident étant journalisé.

### 6.7 Persistance & multi-idées — `🟠→🔵`
- **EF-29 (🟠)** Persistance par idée (localStorage).
- **EF-30 (🔵)** Gestion **multi-idées** isolées (une fiche d'identité par idée) + migration vers IndexedDB.

### 6.8 Traçabilité / Timeline / audit — `🟢/🔵`
- **EF-31 (🟢)** Timeline horodatée des contributions (acteur, action, détail).
- **EF-32 (🔵)** Journal d'audit exportable (contributions IA + humaines, décisions, veto).

### 6.9 Exposition « LLM gouverné » — `🔵 Cible` (cœur de la transformation)
- **EF-33** Interface unique (chat + API) acceptant une requête et un **niveau de gouvernance** (voir §7).
- **EF-34** Toute sortie « sensible » traverse un **gate de censure humaine** avant restitution.
- **EF-35** La réponse restituée est accompagnée de sa **trace** (agents mobilisés, sources, statut de gouvernance).

---

## 7. Mode « LLM gouverné » — séquence & interface

```mermaid
sequenceDiagram
    participant U as Utilisateur
    participant IF as Interface unique
    participant O as Orchestrateur
    participant A as Agents IA
    participant L as LLM réel (Claude/Ollama)
    participant H as Censeur humain
    U->>IF: Requête + niveau de gouvernance
    IF->>O: Transmission
    O->>O: Plan (Plan-and-Solve)
    loop Cycle ReAct
        O->>A: Sous-tâche
        A->>L: Appel LLM (avec Retry/Circuit Breaker)
        L-->>A: Réponse
        A-->>O: Observation + trace
    end
    O->>O: Synthèse + score KI
    alt Sortie sensible
        O->>H: Demande de validation
        H-->>O: Approuvé / Veto (motivé)
    end
    O-->>IF: Réponse gouvernée + trace
    IF-->>U: Restitution
```

**Spécification de l'interface (fonctionnelle).**

| Champ (entrée) | Description |
|---|---|
| `requête` | Demande en langage naturel |
| `niveau_gouvernance` | `auto` (IA seule) · **`supervisé` (défaut — censeur si sortie sensible)** · `strict` (censeur obligatoire). **Décision actée : `strict` n'est PAS le défaut** ; il est activé à la demande ou par politique. |
| `souveraineté` | `cloud` (Claude) · `local` (Ollama) |
| `idée_cible` | Rattachement à une fiche d'idée existante (optionnel) |

| Champ (sortie) | Description |
|---|---|
| `réponse` | Résultat restitué |
| `statut_gouvernance` | `auto` · `validé_humain` · `bloqué_veto` |
| `trace` | Agents mobilisés, sources, appels LLM, score KI |
| `idée_ref` | Référence de la fiche d'idée mise à jour |

- **EF-36 (🔵)** En mode `strict`, aucune réponse n'est restituée sans approbation d'un censeur habilité. **`strict` n'est pas le mode par défaut.**
- **EF-37 (🔵)** En cas de veto, la sortie retournée est un message de blocage motivé, jamais le contenu sensible.
- **EF-38 (🔵)** Le mode par défaut est **`supervisé`** : la réponse est restituée directement, sauf si l'orchestrateur la classe « sensible », auquel cas elle passe par un censeur.

> **US-06.** En tant que **système appelant**, je veux **interroger KayrosLab comme un LLM tout en garantissant une supervision humaine** afin d'**obtenir des réponses stratégiques auditables**.
> **Critères.** *Étant donné* `niveau_gouvernance = strict`, *quand* la réponse est prête, *alors* elle est mise en attente de validation humaine avant restitution.

---

## 8. Exigences non-fonctionnelles (observables fonctionnellement)

| Domaine | Exigence | Statut |
|---|---|---|
| **Sécurité** | Clés API jamais en clair côté client en production ; passage par un backend/coffre | 🔵 |
| **Souveraineté** | Fonctionnement complet possible en LLM local (Ollama), sans dépendance cloud | 🔵 |
| **Coût** | Journalisation tokens in/out + coût estimé par appel ; plafond configurable | 🟠→🔵 |
| **Performance** | Retour d'un cycle simple < 5 s (cloud) ; timeline mise à jour en temps réel | 🟠 |
| **Offline-first** | L'app tourne sans backend pour la démo (standalone) | 🟢 |
| **Accessibilité** | Contrastes, navigation clavier, tailles de cibles | 🔵 |
| **Auditabilité** | Toute décision humaine est immuable et exportable | 🔵 |

---

## 9. Personas

| Persona | Besoin principal | Étapes clés |
|---|---|---|
| **Stratège / Idéateur** | Transformer des signaux en scénarios solides | É1 → É3 |
| **Facilitateur** | Animer le collectif et l'IA, arbitrer les groupes | Toutes |
| **Expert métier / Censeur** | Valider la pertinence, poser un veto | É3–É5 |
| **Arbitre COMEX** | Décider et assumer, avec traçabilité | É5 |
| **Intégrateur** | Appeler KayrosLab comme un « LLM gouverné » via API | Mode §7 |

---

## 10. Backlog fonctionnel & feuille de route

Priorisation **MoSCoW** (Must / Should / Could / Won't-now) alignée sur la roadmap v1–v7.

| Lot | Fonctions (EF) | Priorité | Roadmap |
|---|---|---|---|
| **Consolidation artefacts** en 1 fichier de référence (fusion 163 Ko + ai-agents + future-proofing) | EF-01→14 | **Must** | v1–v2 |
| Orchestrateur réel (Plan-and-Solve + ReAct) | EF-15, EF-16 | **Must** | v2 |
| Connexion LLM réelle (`KayrosLLM` → Claude/Ollama) | EF-25, EF-26 | **Must** | v5 |
| Résilience (Retry + Circuit Breaker) | EF-27, EF-28 | **Must** | v3 |
| Gouvernance & veto formalisés | EF-20, EF-21, EF-34, EF-36, EF-37 | **Must** | v2–v4 |
| Red Team réelle + rapport d'attaque | EF-10 | **Should** | v4 |
| Vector Memory (recherche sémantique) | EF-18 | **Should** | v4 |
| Multi-idées + IndexedDB | EF-30 | **Should** | v4 |
| KI stratégique + Radar | EF-23 | **Could** | v4 |
| Interface « LLM gouverné » (API) | EF-33, EF-35 | **Must** | v5 |
| Synchronisation cloud (ElectricSQL) | — | **Won't-now** | v6 |
| Version décentralisée (Holochain) | — | **Won't-now** | v7 |

---

## 11. Hypothèses, risques & questions ouvertes

**Hypothèses.**
1. Le prototype 163 Ko (mai) est considéré comme la référence fonctionnelle de l'existant « workflow 5 étapes ».
2. Les LLMs cibles sont Claude (API) et Ollama (local) ; pas de fine-tuning propre à ce stade.
3. La gouvernance humaine s'appuie sur les Working Groups existants, à formaliser en rôles/veto.

**Risques.**
| Risque | Impact | Mitigation |
|---|---|---|
| Écart vision/code (beaucoup de « simulé ») | Attentes non tenues | Ce doc sépare Existant/Cible ; roadmap MoSCoW |
| Clés API côté client | Sécurité | Backend/coffre obligatoire en prod (EF, §8) |
| Latence multi-agents + gate humain | UX dégradée | Modes `auto/supervisé/strict`, async |
| Badge → placeholder | Crédibilité démo | ✅ Résolu : badge repointé vers `with-ai-agents`, placeholder supprimé |

**Décisions actées (15/07/2026).**
1. ✅ **Badge repointé** vers `kayroslab-complete-with-ai-agents.html` (démo réellement fonctionnelle).
2. ✅ **Placeholder supprimé** ; le dépôt est **consolidé autour d'un fichier de référence unique** (`kayroslab-complete-with-ai-agents.html`). La fusion des fonctions du prototype 163 Ko (workflow 5 étapes) et de la variante `enhanced-future-proofing` dans ce fichier est un **lot d'ingénierie** cadré avec les specs techniques.
3. ✅ Le mode **`strict` n'est PAS le défaut** ; le défaut est **`supervisé`** (§7).
4. ✅ **KI = 5 dimensions stratégiques d'abord** (Fit, Désirabilité, Faisabilité, Viabilité, Adaptabilité), **puis les 6 dimensions techniques** en couche opérationnelle (§6.4).

**Question restante.**
- Fusion effective des 3 apps en un seul fichier : périmètre exact et priorité (à cadrer dans `SPECIFICATIONS_TECHNIQUES.md`).

---

## 12. Glossaire

| Terme | Définition |
|---|---|
| **LLM gouverné** | Système agentique composite qui orchestre de vrais LLMs sous supervision humaine, exposé via une interface unique |
| **Plan-and-Solve** | Paradigme : planifier explicitement avant d'exécuter |
| **ReAct** | Boucle Raisonnement ↔ Action (outil) ↔ Observation |
| **Censeur humain** | Acteur habilité à valider/bloquer (veto) une sortie ou une transition |
| **Gate** | Point de contrôle où une validation (IA et/ou humaine) est requise |
| **KI (Kayroslab Index)** | Score composite de qualité d'une idée |
| **Kill shot** | Attaque Red Team invalidant une idée |
| **Bisociation** | Génération d'idées par collision de concepts distants |
| **Circuit Breaker** | Coupe-circuit à états (CLOSED/OPEN/HALF_OPEN) protégeant des pannes en cascade |

---

## 13. Plateforme & collaboration (EF-46 → EF-87)

> **Origine.** Ces exigences sont issues de l'analyse d'écarts vs Brightidea (cf. `ANALYSE-ECARTS-BRIGHTIDEA.md`).
> Elles couvrent la **couche plateforme** — persistance, portefeuille, collaboration, reporting — par opposition
> aux EF-01→45 qui couvrent le **processus d'idéation** lui-même.
> **Statuts au 2026-07-21** : 🟢 réalisé · 🟡 partiel · 🔴 à construire.

### 13.1 Persistance & comptes (EF-46 → EF-50)

- **EF-46 (🟡)** Les données (idées, comptes, gates) sont persistées côté serveur et survivent à un redémarrage.
  *Réalisé en fichiers JSON à écriture atomique (mono-serveur). Une base partagée reste nécessaire pour le multi-instance.*
- **EF-47 (🟢)** Un utilisateur dispose d'un compte : mot de passe haché (scrypt + sel), jeton de session signé, aucune donnée secrète stockée en clair.
- **EF-48 (🟢)** Les données sont **isolées par tenant** ; le tenant provient du jeton et jamais de la requête cliente.
- **EF-49 (🟢)** Chaque transition (étape, statut) et chaque résolution de gate est **horodatée, attribuée et persistée** (audit).
- **EF-50 (🟢)** Une session peut être révoquée (déconnexion, compromission) et les tentatives de connexion sont limitées.

> **US-07.** En tant qu'**administrateur**, je veux que **comptes, idées et arbitrages survivent à un redémarrage** afin de **ne pas perdre le travail en cours**.
> **Critères.** *Étant donné* un serveur redémarré, *quand* un utilisateur se reconnecte, *alors* il retrouve son portefeuille et les gates en attente.

### 13.2 Portefeuille (EF-51 → EF-55)

- **EF-51 (🟢)** Vue portefeuille en colonnes par étape (kanban) avec déplacement d'une idée d'une étape à l'autre.
- **EF-52 (🟢)** Chaque colonne affiche son **compteur de charge (WIP)**.
- **EF-53 (🔴)** Vues alternatives : liste triable et tableau de bord.
- **EF-54 (🔴)** Comparaison de plusieurs idées côte à côte (KI, votes, impact).
- **EF-55 (🟡)** Filtres combinables (statut, étape, catégorie) et recherche plein texte. *Statut et texte disponibles ; facettes incomplètes.*

### 13.3 Statut × Étape (EF-56 → EF-58)

- **EF-56 (🟢)** Le **statut décisionnel** est indépendant de l'**étape d'exécution** ; les deux évoluent séparément.
- **EF-57 (🟢)** Des états dormants existent (`consideration_future`, `en_pause`, `non_poursuivi`) sans suppression de l'idée.
- **EF-58 (🟡)** Une idée dormante peut être **réactivée** et repositionnée à une étape. *Disponible dans le cœur ; pas d'action dédiée dans l'interface.*

> **US-08.** En tant que **facilitateur**, je veux **geler une idée validée sans la supprimer** afin de **pouvoir la réactiver quand le budget existera**.
> **Critères.** *Étant donné* une idée en `en_pause`, *quand* je la réactive, *alors* son statut repasse en revue et l'historique conserve les deux transitions.

### 13.4 Collecte (EF-59 → EF-62)

- **EF-59 (🟢)** Formulaire de soumission structuré (valeur, problème, ressources, parties prenantes, risques, équipe) rendant les idées comparables dès l'entrée.
- **EF-60 (🟢)** Les champs du canevas **alimentent automatiquement** les hypothèses de *Construire* et les cibles d'attaque d'*Éprouver* ; un champ non renseigné devient lui-même un **angle mort** assigné à un agent.
- **EF-61 (🔴)** Campagnes / défis thématiques multiples.
- **EF-62 (🔴)** File de modération des soumissions entrantes.

### 13.5 Évaluation collaborative (EF-63 → EF-67)

- **EF-63 (🟢)** Plusieurs évaluateurs notent une idée (0–100) ; un évaluateur ne compte qu'une fois.
- **EF-64 (🟢)** L'agrégation est **pondérée par rôle** (COMEX ×3, expert/Red Team ×2, contributeur ×1).
- **EF-65 (🟢)** L'agrégat expose la **dispersion** et un indicateur de **consensus**.
- **EF-66 (🟢)** L'agrégat est **transmis au gate** et présenté au censeur : il **instruit** la décision sans la remplacer ; le veto reste entier.
- **EF-67 (🔴)** Fil de commentaires par idée.

### 13.6 Scorecards (EF-68 → EF-71)

- **EF-68 (🟢)** Les grilles d'évaluation sont **paramétrables** : critères, poids, échelle.
- **EF-69 (🟢)** Une grille **par étape** (screening léger échelle 10, évaluation approfondie échelle 100).
- **EF-70 (🟢)** Une idée peut être notée ; une évaluation **partielle** est signalée comme telle (taux de couverture), jamais présentée comme complète.
- **EF-71 (🟢)** Chaque notation est **historisée** (pas d'écrasement), permettant de suivre l'évolution du score.

### 13.7 Notifications (EF-72 → EF-75)

- **EF-72 (🟢)** L'ouverture d'un gate **notifie les censeurs habilités** du tenant concerné. *Sans cette exigence, la gouvernance reste théorique : le processus se fige.*
- **EF-73 (🟢)** Les notifications partent sur des **canaux externes réels** (webhook, email) ; une panne de canal n'empêche ni les autres ni l'arbitrage.
- **EF-74 (🔴)** Notifications d'activité (nouveau vote, changement d'étape, commentaire).
- **EF-75 (🔴)** Digest périodique planifié.

> **US-09.** En tant que **censeur COMEX**, je veux **être prévenu hors de l'application qu'un arbitrage m'attend** afin de **ne pas bloquer le processus sans le savoir**.
> **Critères.** *Étant donné* un gate ouvert, *quand* un canal est configuré, *alors* les porteurs du rôle requis reçoivent un message contenant l'idée et l'agrégat de vote.

### 13.8 Impact réel (EF-76 → EF-79)

- **EF-76 (🟢)** Les **investissements** constatés sont enregistrés par idée.
- **EF-77 (🟢)** Les **bénéfices** constatés sont enregistrés par idée ; le ROI réel est calculé.
- **EF-78 (🟢)** Le **réalisé est confronté au projeté** : écart absolu et relatif, position vis-à-vis de l'intervalle P10–P90. En l'absence de projection, l'écart est déclaré non calculable plutôt qu'affiché à zéro.
- **EF-79 (🟢)** ROI agrégé au niveau du portefeuille. *Ne porte que sur les idées disposant de données financières : agréger des idées sans impact fausserait le ratio.*

> **US-10.** En tant qu'**arbitre COMEX**, je veux **comparer ce qui a été réalisé à ce qui avait été projeté** afin de **calibrer la fiabilité de nos projections**.
> **Critères.** *Étant donné* une idée disposant d'une projection, *quand* des bénéfices sont saisis, *alors* l'écart et la position vs P10–P90 sont restitués.

### 13.9 Cycle aval (EF-80 → EF-83)

> **Arbitrage tranché.** Le cycle aval est porté par une **étape 7 « Réaliser »**, dont les sous-phases
> (**pilote → déploiement → bilan**) sont un attribut interne `execution.phase`. Motif : ajouter trois étapes
> aurait porté le kanban à dix colonnes et dilué l'identité du processus, qui reste un cycle d'**idéation**.
> Le modèle réutilise le motif orthogonal déjà établi entre statut et étape.

- **EF-80 (🟢)** Phase **Pilote** : l'exécution démarre à partir de la roadmap produite en *Projeter*, dont les jalons planifiés deviennent des jalons suivis.
- **EF-81 (🟢)** Phase **Déploiement** : passage de phase tracé.
- **EF-82 (🟢)** Suivi d'exécution des jalons (statut, date cible, date réelle), avec **avancement, blocages et jalons en retard**.
- **EF-83 (🟢)** **Bilan de clôture** : verdict (succès / mitigé / échec) et enseignements consignés ; la clôture bascule l'idée en statut `termine`.

> **Règle de clôture.** Le passage au bilan est **refusé si des jalons restent ouverts**. Un forçage explicite reste possible, mais il est **tracé dans l'historique** — on ne clôt pas silencieusement un projet inachevé.

> **US-11.** En tant que **porteur de projet**, je veux **suivre l'exécution des jalons issus de la roadmap** afin de **constater les dérives avant la clôture**.
> **Critères.** *Étant donné* une idée en `realiser`, *quand* un jalon dépasse sa date cible sans être fait, *alors* il est signalé en retard.
> *Étant donné* des jalons non terminés, *quand* je demande le passage au bilan, *alors* la clôture est refusée sauf forçage explicite tracé.

### 13.10 Reporting (EF-84 → EF-87)

- **EF-84 (🟢)** Tableau de bord portefeuille : volumes, actives/abandonnées, taux d'abandon, KI moyen, charge par étape et par statut.
- **EF-85 (🟢)** **Entonnoir de conversion** par étape, calculé sur l'**historique réel** : une idée n'est comptée comme ayant franchi une étape que si son historique l'atteste.
- **EF-86 (🟢)** Temps moyen passé par étape, déduit des transitions ; les séjours **encore en cours** sont comptés et distingués des séjours terminés.
- **EF-87 (🟢)** Export du portefeuille au format **CSV** (échappement conforme : séparateurs, guillemets et sauts de ligne). *Export PDF non couvert.*

### 13.11 Synthèse d'avancement

| Bloc | EF | Réalisé | Partiel | À construire |
|---|---|---|---|---|
| Persistance & comptes | 46–50 | 4 | 1 | 0 |
| Portefeuille | 51–55 | 2 | 1 | 2 |
| Statut × Étape | 56–58 | 2 | 1 | 0 |
| Collecte | 59–62 | 2 | 0 | 2 |
| Évaluation collaborative | 63–67 | 4 | 0 | 1 |
| Scorecards | 68–71 | 4 | 0 | 0 |
| Notifications | 72–75 | 2 | 0 | 2 |
| Impact réel | 76–79 | 4 | 0 | 0 |
| Cycle aval | 80–83 | 4 | 0 | 0 |
| Reporting | 84–87 | 4 | 0 | 0 |
| **Total** | **42** | **32** | **3** | **7** |

**Écart transverse subsistant.** Aucune de ces exigences n'a été validée **en conditions réelles** : le parcours HTTP complet n'a jamais été exécuté contre un serveur en fonctionnement (déploiement P2 en attente). Les statuts 🟢 attestent d'un code testé unitairement, pas d'une recette fonctionnelle.

---

## Annexe A — Matrice complète Existant → Cible (par exigence)

| EF | Fonction | Existant | Cible |
|---|---|---|---|
| EF-01/02 | Écouter / scoring signaux | 🟢 / 🔵 | Scoring LLM expliqué |
| EF-03/04 | Cartographier / ponts | 🟢 / 🔵 | Ponts auto (bisociation) |
| EF-05/06/07 | Construire / collision / brief | 🟢 / 🟠 / 🔵 | Génération LLM + brief export |
| EF-08→11 | Éprouver / délégation / Red Team / KI | 🟠 / 🟢 | Red Team réelle + rapport |
| EF-12→14 | Arbitrer / PDF / vote / décision | 🟢 / 🔵 | Vote multi-critères tracé |
| EF-15/16 | Orchestration | ❌ | Plan-and-Solve + ReAct |
| EF-17/18 | Mémoire | 🟠 | Vector Memory |
| EF-19→21 | Gouvernance / veto / votes | 🟢 / 🔵 | Rôles + veto formalisés |
| EF-22/23 | KI | 🟢 | KI stratégique + radar |
| EF-24→26 | Connecteurs / KayrosLLM | 🟠 | Claude + Ollama réels |
| EF-27/28 | Résilience | ❌ | Retry + Circuit Breaker |
| EF-29/30 | Persistance / multi-idées | 🟠 | IndexedDB multi-idées |
| EF-31/32 | Traçabilité | 🟢 | Audit exportable |
| EF-33→37 | LLM gouverné | ❌ | Interface + gates de censure |

---

*Fin des spécifications fonctionnelles v0.1 — en attente de validation. Les spécifications techniques (`SPECIFICATIONS_TECHNIQUES.md`) seront dérivées de ce document une fois validé.*
