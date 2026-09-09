# Handover — limites de livres par agent & attribution IA (version en ligne)

**Périmètre :** agents auteurs créés depuis la console (`/console/`, onglet Agents → « Ajouter un auteur »).
**Date :** 2026-09-09 · **Statut :** en production sur `api.kayroslab.com`.

---

## 1. Règles de limites (15 / 3)

À la création d'un agent auteur, la chaîne d'ingestion recherche les œuvres du domaine public de
l'auteur (catalogue vérifié **+ recherche temps réel** Project Gutenberg / Wikisource), puis applique
la politique [`applyBookPolicy`](backend/fastify/lib/literary-ledger.mjs) :

| Situation | Comportement | Entrée registre |
|---|---|---|
| Pool ≥ 15 œuvres | **15 maximum** assignées, le surplus est **retenu** (non perdu — rechargeable) | `cap` |
| 3 ≤ Pool < 15 | Tout est assigné (le plancher est satisfait) | `floor-ok` |
| Pool < 3 | Tout est assigné **+ proposition d'ajout manuel** à l'utilisateur | `floor-short` |

- Les œuvres retenues par le cap sont listées dans le registre et restent disponibles pour un
  enrichissement ultérieur (elles ne sont pas supprimées).
- Chaque œuvre assignée génère une entrée `assigned` (titre, source, taille).

## 2. Valeurs par défaut & réglages

| Variable d'environnement | Défaut | Rôle |
|---|---|---|
| `KAYROS_AUTHOR_MAX_BOOKS` | `15` | Plafond d'œuvres par agent |
| `KAYROS_AUTHOR_MIN_BOOKS` | `3` | Plancher déclenchant la proposition d'ajout manuel |
| `KAYROS_MAX_ROOMS_PER_USER` | `3` | Salons maximum par utilisateur (version en ligne) |
| `KAYROS_MAX_BUILT_AGENTS_PER_ROOM` | `3` | Agents construits (personnalité littéraire) maximum par salon |

Toutes sont surchargeables dans `backend/fastify/.env` (production : variables PM2 sur le VPS).
Les limites salons/agents-construits sont appliquées dans `POST /v1/console/rooms`
([routes/console.mjs](backend/fastify/routes/console.mjs)).

## 3. Ajout manuel & attribution IA

Quand le plancher de 3 n'est pas atteignable, la réponse de création contient
`proposal.manual_required = true` et la console affiche le formulaire **« Ajouter et laisser l'IA
attribuer »** (titre + URL d'une source libre : Gutenberg, Wikisource, efele…).

`POST /v1/literary/agents/:agentId/books` traite chaque œuvre :

1. **Téléchargement temps réel** et conversion en texte (txt direct, html → nettoyage,
   epub → décompression + extraction via `adm-zip`).
2. **Attribution par caractéristiques** — score déterministe
   ([scoreWorkAgainstAgent](backend/fastify/lib/literary-ledger.mjs)) :
   - nom d'auteur présent dans la référence du livre (+0.40) ;
   - même époque que l'agent (+0.15) ;
   - recouvrement des termes signatures avec l'empreinte lexicale du corpus de l'agent (+0.09/terme, max 0.45).
3. **Mise à jour de la mémoire** : corpus reconstitué (`data/literary/<agent>.json`), empreinte
   globale recalculée, persona régénéré (`primary_focus`), manifeste des œuvres mis à jour
   (`metadata.literary`).
4. Chaque attribution renvoie sa **justification** (affichée dans la console) et est inscrite au registre.

Formats ingestables : **txt, html, epub**. Les PDF sont acceptés comme **adresses de
téléchargement** référencées (non convertis en texte dans cette version).

## 4. Registre d'ingestion (traçabilité)

- Fichier : `backend/fastify/data/literary/ledger.jsonl` (JSONL append-only, horodaté).
- Contenu : `created` · `assigned` · `cap` · `floor-ok` · `floor-short` · `manual_add` · `attribution`.
- Champs : `ts`, `tenant`, `agent_id`, `book`, `url`, `rule`, `details`.
- Lecture : `GET /v1/literary/ledger?limit=100` (authentifié) — utilisé par la console.

## 5. Endpoints

| Route | Rôle | Usage |
|---|---|---|
| `GET /v1/literary/authors?search=` | membre | Catalogue vérifié (28 auteurs, sources contrôlées) |
| `GET /v1/literary/sources` | membre | Annuaire des 9 bibliothèques + formats + limites actives |
| `GET /v1/literary/search?q=` | membre | Recherche temps réel (Gutenberg, efele, ELG, Wikisource fr/en) |
| `POST /v1/literary/authors/:authorId/agent` | comex/admin | Création depuis le catalogue (politique 15/3) |
| `POST /v1/literary/agents` | comex/admin | Création depuis des œuvres choisies via la recherche |
| `POST /v1/literary/agents/:agentId/books` | comex/admin | Ajout manuel + attribution IA |
| `GET /v1/literary/ledger?limit=` | membre | Registre d'ingestion / d'attribution |

## 6. Limitations connues

- PDF : adresse référencée mais non convertie en texte (prévoir `pdf-parse` si besoin).
- Bookatomy (bookatomy.com) : intégré comme annuaire de découverte par année — le site n'expose
  pas de moteur de recherche public ; les textes passent par les autres sources.
- EbooksGratuits : la recherche site est floue ; un filtre client strict sur auteur/titre est appliqué.
- Wikisource : les pages de désambiguïsation renvoient un extrait court et sont écartées
  (« contenu trop court »).

## 7. Comptes & tests

- Création d'agents auteurs réservée aux rôles **comex/admin** (même RBAC que le reste du back office).
- Tests : `npm test` (backend, 127 tests — dont 9 nouveaux sur catalogue/sources/politique/registre)
  · tests site : `node --test tests/*.test.mjs` depuis la racine (36).
- Le compte de démonstration local est provisionné dans `data/test-users.json` (comex) —
  ce dossier est ignoré par Git.
