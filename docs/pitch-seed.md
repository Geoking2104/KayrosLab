# KayrosLab — Pitch & démo seed (1 page)

**Tagline.** Les agents proposent. La décision reste humaine.

## Problème
Les équipes stratégique / innovation utilisent des LLM « chat » : une réponse, pas d’arbitrage, pas de traçabilité, pas de portefeuille d’hypothèses.

## Solution
**KayrosLab** = atelier d’idéation **gouvernée** :

1. **Exploration sémantique** → champs connexes (InfraNodus-like)
2. **Boucle d’hypothèses** comparables (novelty / relevance / testability)
3. **Cycle 8 étapes** multi-agents (écouter → réaliser) avec **gates humaines**
4. **Mémoire L0–L3** (faits, scénarios, persona tenant-scoped)
5. **Positionner** : scanners + ontologie tech/business + export OWL

## Preuve technique (live)
| Surface | URL |
|---------|-----|
| Démo publique | https://www.kayroslab.com/kayroslab-complete-with-ai-agents.html |
| Cycle SSE | …/cycle-timeline.html |
| Portfolio | …/portfolio-board.html |
| Ontologie | …/ontology-explorer.html |
| API | https://api.kayroslab.com/health |

**Script démo 8 min**
1. Idée IoT / B2B → explorer possibles (30 s)
2. Choisir 1–2 ponts sémantiques → 3 pistes (1 min)
3. Retenir une hypothèse → cycle agents jusqu’à Red Team (3 min)
4. Gate / annotation humaine → synthèse KI (1 min)
5. Timeline SSE + mémoire L1 positionning (1 min)
6. Portfolio kanban + idée dormante → réactiver (1 min)

## Seed données
```bash
# Fichier
KAYROS_IDEAS_FILE=/opt/kayroslab/data/ideas.json node core/seed-demo.mjs
# Postgres
DATABASE_URL=postgres://… node core/seed-demo.mjs
```

## Différenciation
| LLM chat | KayrosLab |
|----------|-----------|
| 1 réponse | N hypothèses scorées |
| Boîte noire | Gates + journal |
| Session volatile | L0–L3 + tenant |
| Pas de portfolio | Kanban stages × status |

## Ask (seed)
Capital d’amorçage pour : multi-instance Postgres prod, connecteurs (Slack), ontology UX Positionner, go-to-market innovation / COMEX EU.

Contact : contact@kayroslab.com · Geoffroy de La Tournelle
