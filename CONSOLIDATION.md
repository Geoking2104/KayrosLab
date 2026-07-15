# KayrosLab — Consolidation vers un fichier de référence unique

> Suivi de la consolidation des prototypes en **un seul fichier de référence**.
> Décision (16/07/2026) : **promouvoir le prototype le plus riche** comme référence, puis **porter** les fonctionnalités des autres — sans merge de code risqué immédiat.

## Fichier de référence retenu

**`kayroslab-reference.html`** — prototype standalone le plus complet fonctionnellement :
workflow en 5 étapes (Écouter → Cartographier → Construire → Éprouver → Arbitrer), Working Groups (Human-in-the-Loop), roundtable, livrables PDF, calcul ROI, feed, AI facilitator, persistance localStorage.

Le badge « Open in Browser » et la section démo du README pointent désormais vers ce fichier.

## Artefacts à consolider puis retirer

| Fichier source | Statut | À porter dans la référence |
|---|---|---|
| `kayroslab-reference.html` | ✅ Référence | — |
| `kayroslab-complete-with-ai-agents.html` | 🔵 À porter puis retirer | AI Connectors (CRUD connecteurs), délégation externe LLM (Claude/GPT/Gemini/DeepSeek), KI dynamique 6 dimensions, onglet Agent Call History (tokens/coût) |
| `kayroslab-enhanced-future-proofing.html` | 🔵 À porter puis retirer | Collision Mode « Enhanced », variantes Future Proofing avancées |

## Backlog de portage (features à réintégrer)

- [ ] **AI Connectors** : gestion CRUD des connecteurs (nom, rôle, provider, clé) — depuis `with-ai-agents`.
- [ ] **Délégation à un agent externe** : bouton « Déléguer à l'agent externe » dans l'étape Éprouver — depuis `with-ai-agents`.
- [ ] **KI dynamique 6 dimensions** (global, vélocité, divergence, fiabilité, impact, originalité) + radar — depuis `with-ai-agents`.
- [ ] **Agent Call History** : historique des appels (modèle, tokens in/out, coût estimé) — depuis `with-ai-agents`.
- [ ] **Collision Mode Enhanced** — depuis `enhanced-future-proofing`.
- [ ] **Harmonisation des dimensions KI** : 5 stratégiques d'abord (Fit, Désirabilité, Faisabilité, Viabilité, Adaptabilité), 6 techniques ensuite (cf. specs).

## Précautions techniques (cf. SPECIFICATIONS_TECHNIQUES.md §12)

1. **Collisions de noms** : les prototypes définissent tous des fonctions globales homonymes (`switchTab`, etc.) → namespacer avant fusion de code.
2. **État & persistance** : unifier les clés `localStorage` (`kayros_connectors`, `kayros_agent_history`, …) et migrer vers IndexedDB (multi-idées isolées).
3. **Sécurité** : retirer toute `apiKey` du client (proxy backend en palier P2).
4. **Non-régression** : tester chaque portage (captures avant/après) avant de retirer le fichier source.

## Processus

Travail effectué sur une **branche dédiée + Pull Request** (pas de commit direct sur `main`), avec revue avant fusion.
