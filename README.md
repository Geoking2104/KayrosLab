# KayrosLab

[![Open in Browser](https://img.shields.io/badge/▶_Open_in_Browser-Live_Demo-2563eb?style=for-the-badge)](https://raw.githack.com/Geoking2104/KayrosLab/main/kayroslab-reference.html)
[![Website](https://img.shields.io/badge/Website-kayroslab.com-0ea5e9?style=for-the-badge)](https://www.kayroslab.com)

**Du Signal Faible à la Décision Stratégique — Atelier d’Idéation Agentique Hybride**

KayrosLab est un **atelier d’idéation stratégique** qui transforme des signaux faibles en idées robustes, challengées et arbitrées grâce à une architecture agentique avancée (Plan-and-Solve + ReAct), une mémoire partagée + vectorielle, et un Human-in-the-Loop structuré.

Contrairement aux LLMs classiques (ChatGPT, Claude, Gemini…), KayrosLab ne se contente pas de générer du texte : il suit un **processus rigoureux, traçable et résilient** en 5 étapes.

> ▶ **Démo en ligne (sans installation)** : clique sur le badge **Open in Browser** ci-dessus, ou ouvre
> https://raw.githack.com/Geoking2104/KayrosLab/main/kayroslab-reference.html

---

## 🌟 Ce qui rend KayrosLab unique par rapport aux LLMs standards

| Critère                        | ChatGPT / Claude / Gemini                  | **KayrosLab**                                                                 |
|--------------------------------|--------------------------------------------|-------------------------------------------------------------------------------|
| **Structure**                  | Conversation linéaire                      | **Processus structuré en 5 étapes** (Écouter → Arbitrer)                     |
| **Agents**                     | Un seul modèle                             | **Multi-agents spécialisés** (Red Team offensif, Devil’s Advocate, Planner…) |
| **Raisonnement**               | Prompt simple                              | **Plan-and-Solve + ReAct** (planification + raisonnement itératif avec outils) |
| **Mémoire**                    | Contexte de session limité                 | **Shared Memory + Vector Memory** (recherche sémantique)                     |
| **Robustesse**                 | Aucune                                     | **Retry + Circuit Breaker** + fallback intelligent                           |
| **Traçabilité**                | Faible                                     | Timeline complète + évaluation des outputs agents + scoring KI               |
| **Décision humaine**           | Informelle                                 | **Human-in-the-Loop structuré** (votes multi-critères, Working Groups)       |
| **Multi-projets**              | Non                                        | **Gestion multi-idées** avec persistance isolée                              |
| **Souveraineté**               | Dépendance cloud                           | **LLM-ready** (Ollama local, Claude via API, abstraction propre)             |
| **Déploiement**                | Nécessite backend                          | **Standalone** (un seul fichier HTML autonome)                               |

**En résumé** : KayrosLab transforme l’IA générative en un **système d’idéation gouverné**, comparable à un CODIR augmenté par des agents IA.

---

## 🔄 Les 5 Étapes du Processus

| Étape | Nom | Rôle principal | Sortie |
|-------|-----|----------------|--------|
| **01** | **Écouter** | Réduction du bruit + scoring | Signaux qualifiés |
| **02** | **Cartographier** | Réseau de tendances | Visualisation des relations + ponts stratégiques |
| **03** | **Construire** | Constructeur de scénarios | Scénarios candidats + brief structuré |
| **04** | **Éprouver** | Future Proofing multi-agents (Critic + Devil’s Advocate + **Red Team**) | Idées challengées + rapport d’attaque |
| **05** | **Arbitrer** | Challenge humain + décision | Décision finale + Gantt + livrable |

---

## 📦 Fichier Standalone Complet

Le prototype le plus abouti est disponible directement dans le dépôt :

**[`kayroslab-reference.html`](kayroslab-reference.html)** — prototype de reference : workflow 5 etapes complet (Ecouter -> Arbitrer), Working Groups (Human-in-the-Loop), livrables PDF, ROI

Ce fichier unique contient :
- L’ensemble du workflow en 5 étapes
- L’architecture agentique complète (Plan-and-Solve + ReAct)
- Le système d’évaluation des agents
- La mémoire partagée + vectorielle
- La gestion multi-idées
- La préparation LLM (Anthropic SDK + Ollama local)
- Le Circuit Breaker + Retry avec backoff
- L’interface multi-utilisateurs et collaborative simulée

Tu peux l’ouvrir directement dans un navigateur sans installation.

---

## 🛠️ Architecture Technique Actuelle

- **Frontend** : HTML + Tailwind + JavaScript (standalone)
- **Agents** : ReAct + Plan-and-Solve (simulation avancée, prêt pour vrais LLMs)
- **Outils** : Tool Registry extensible (`search_regulatory_risks`, `calculate_ki_impact`…)
- **Mémoire** : Shared Memory + Vector Memory (similarité cosinus)
- **Résilience** : Retry exponentiel + Circuit Breaker (CLOSED / OPEN / HALF_OPEN)
- **Persistance** : localStorage (multi-idées)
- **LLM** : Abstraction `KayrosLLM` (mock → Anthropic / Ollama)

---

## 🚀 Feuille de Route

| Phase | Objectif                              | Statut      |
|-------|---------------------------------------|-------------|
| v1    | Prototype standalone complet          | ✅ Terminé  |
| v2    | Architecture agentique (ReAct + Plan-and-Solve) | ✅ Terminé |
| v3    | Résilience (Retry + Circuit Breaker)  | ✅ Terminé  |
| v4    | Multi-idées + Vector Memory           | ✅ Terminé  |
| v5    | Intégration réelle LLM (Ollama / Claude) | En cours |
| v6    | Synchronisation cloud (ElectricSQL)   | Prévu       |
| v7    | Version décentralisée (Holochain)     | Vision long terme |

---

## 📬 Contact

**Geoffroy de La Tournelle**
Founder & Director – KayrosLab
[geoffroydelatournelle@gmail.com](mailto:geoffroydelatournelle@gmail.com)
[LinkedIn](https://www.linkedin.com/in/gdelatournelle/)

---

*KayrosLab – Transformer le bruit en stratégie gouvernée.*
