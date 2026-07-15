# KayrosLab

> **Du Signal Faible à la Décision Stratégique**  
> Une plateforme d’idéation collaborative augmentée par l’IA, conçue pour transformer des signaux émergents en stratégies robustes et actionnables.

---

## Vision

KayrosLab n’est **pas un simple chatbot**. C’est un **véritable atelier d’idéation stratégique** dans lequel l’IA agit comme un collaborateur créatif doté d’une **mémoire vivante** de chaque idée.

Contrairement aux LLM classiques qui oublient tout à chaque conversation, KayrosLab construit une **fiche d’identité de l’idée** qui s’enrichit à chaque étape : origine des signaux, hypothèses testées, débats entre agents et humains, versions successives, scoring multi-critères, et interventions du Red Team.

---

## Fonctionnalités Clés

- **5 briques d’idéation structurées** : Écouter → Cartographier → Construire → Éprouver → Arbitrer
- **Système multi-agents hybride** : Agents IA (Planner, Critic, Devil’s Advocate, Red Team, Bisociateur, Synthesizer) + Agents Humains (individus et groupes)
- **Mémoire partagée** entre les agents dans l’étape Éprouver
- **Collision Mode** : Génération d’idées originales par bisociation entre concepts réels
- **Red Team offensif** : Attaques structurées + Kill Shots pour tester la robustesse des idées
- **Kayroslab Index (KI)** : Scoring intelligent et visuel (Radar Chart) basé sur la qualité réelle du travail
- **Timeline vivante** de l’idée (traçabilité complète des contributions IA + Humaines)
- **Persistance robuste** (localStorage complet : Timeline, tâches, contributions, état du workflow, mémoire partagée)
- **Multi-utilisateurs** + Attribution de tâches + Historique des contributions par personne
- **Mode collaboratif simulé** : Simulation d’actions d’autres collaborateurs en temps réel
- **Approche Human-in-the-Loop avancée** : Votes, validation par rôles métier, file de tâches

---

## Le Processus en 5 Étapes

| Étape | Nom | Rôle principal | Sortie |
|-------|-----|----------------|--------|
| **01** | **Écouter** | Réduction du bruit + scoring | Signaux qualifiés |
| **02** | **Cartographier** | Réseau de tendances | Visualisation des relations + ponts stratégiques |
| **03** | **Construire** | Constructeur de scénarios | Scénarios candidats + brief structuré |
| **04** | **Éprouver** | Future Proofing multi-agents (Critic + Devil’s Advocate + **Red Team**) | Idées challengées + rapport d’attaque |
| **05** | **Arbitrer** | Challenge humain + décision | Décision finale + Gantt + livrable |

---

## Ce qui rend KayrosLab unique

| Critère | ChatGPT / Claude | **KayrosLab** |
|-----------------------------|---------------------------|----------------------------------------|
| Mémoire de l’idée | Aucune | **Fiche d’identité persistante** + Mémoire partagée |
| Créativité | Réponses linéaires | **Bisociation forcée** (Le Bisociateur) |
| Robustesse stratégique | Faible | **Red Team offensif** + Devil’s Advocate |
| Scoring | Subjectif | **KI intelligent** (5 dimensions + contexte réel) |
| Traçabilité | Faible | **Timeline complète** (IA + Humain) |
| Gouvernance | Suggestion | **Human-in-the-Loop structuré** + attribution de tâches |

---

## État Actuel du Projet (Juillet 2026)

Le projet est disponible sous forme de **prototype standalone haute-fidélité** :

- `kayroslab-complete-persisted.html` → **Version recommandée** (la plus à jour)

Cette version intègre :
- Visualisation du flux de travail avec tous les agents visibles directement sous chaque étape
- Rôle Red Team offensif dans l’étape Éprouver
- Mémoire partagée entre les agents
- Persistance complète via localStorage
- Multi-utilisateurs + attribution de tâches
- Mode collaboratif simulé

---

## Getting Started

1. Clone le repository :
   ```bash
   git clone https://github.com/Geoking2104/KayrosLab.git
   cd KayrosLab
   ```

2. Ouvre le fichier recommandé dans ton navigateur :
   ```bash
   open kayroslab-complete-persisted.html
   ```

3. Explore le flux via l’onglet **"Interactive Showcase"** → déploie les 5 étapes.

---

## Roadmap

- [ ] Intégration React / Vite (version production)
- [ ] Export PDF du livrable complet (avec KI, Timeline, Red Team report, Gantt)
- [ ] Système de vote multi-critères complet avec Radar Chart
- [ ] Connexion réelle aux bases de données (OpenAlex, arXiv, etc.)
- [ ] Mode multi-utilisateurs temps réel
- [ ] Version SaaS / Self-hosted

---

## Philosophie

> « La meilleure idée n’est pas celle qui vient le plus vite, mais celle qui a été correctement **écoutée**, **cartographiée**, **construite**, **éprouvée** (Red Team inclus) et **arbitrée**. »

---

## Auteur

**Geoffroy de La Tournelle**  
Founder & Director @ KayrosLab  
[LinkedIn](https://www.linkedin.com/in/gdelatournelle/) • contact@gdelatournelle.fr

---

## Licence

Ce projet est actuellement en développement interne.  
Toute utilisation, fork ou contribution doit faire l’objet d’une discussion préalable.

---

**KayrosLab** — *Transformer le bruit du monde en décisions stratégiques claires.*