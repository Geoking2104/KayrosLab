# `core/canvas/` — Atelier d'idéation visuel

Lot **v11** du [CDC](../../CDC_CANVAS_IDEATION.md). Moteur **zéro dépendance** (ESM, Node 20+), réutilisé par l'application navigateur et le backend, comme le reste de `core/`.

Le canvas est une **surface amont** : il précède `00 Recueillir` et alimente `02 Cartographier` / `03 Construire`. Il ne remplace aucune étape du cycle gouverné.

```
[Canvas divergent] ──promotion──► 00 Recueillir → … → 08 Réaliser
```

## Exigences couvertes

| Réf | Exigence | Module |
|---|---|---|
| EF-201 | Sourçage explicite (`isSourced`, jamais de faux positif) | `model.mjs` |
| EF-211/212/213 | 7 types de nœuds, 5 relations orientées, CRUD immuable | `model.mjs` |
| EF-214 | Annuler / rétablir, y compris sur les mutations d'agents | `model.mjs` (`UndoStack`) |
| EF-215 | Clustering sémantique **déterministe** | `clustering.mjs` |
| EF-216 | Libellés LLM, jamais écrasables sur un choix humain | `clustering.mjs` |
| EF-217 | Déduplication **suggérée**, fusion jamais automatique | `clustering.mjs` |
| EF-218 | Nœuds figés respectés par le layout | `clustering.mjs` |
| EF-222 | Recherche lexicale + sémantique intra-canvas | `model.mjs`, `vectors.mjs` |
| EF-231 | Contradictions conservées, jamais lissées | `model.mjs` |
| EF-257/258 | Matrice Impact × Effort via `scorecard.mjs` | `promotion.mjs` |
| EF-259/260 | Promotion → intake `Recueillir`, lien bidirectionnel | `promotion.mjs` |
| EF-262 | Hérite du palier de souveraineté du moteur | `index.mjs` |
| EF-200/206 | Ingestion, découpage, vectorisation, scope tenant | `ingest.mjs` |
| EF-201 | Citations avec marqueurs ; citation inventée = non sourcé | `ingest.mjs` |
| EF-207 | Retrait de source + invalidation des assertions | `ingest.mjs` |
| EF-208 | Document sensible : refus motivé ou bascule locale tracée | `ingest.mjs` |
| EF-209 | Quota annoncé **avant** dépassement, alerte à 80 % | `ingest.mjs` |
| EF-225 | Expansion d'un nœud (variantes / sous-problèmes / contre-exemples) | `personas.mjs` |
| EF-226/230 | Swarm parallèle, sorties au fil de l'eau, coût et interruption | `personas.mjs` |
| EF-227/228 | 6 personas standard, prompts et critères exposés, extensible | `personas.mjs` |
| EF-229 | Agents du cœur exposés comme personas, sans duplication | `personas.mjs` |
| EF-232/233/234 | SCAMPER, Six chapeaux, Premiers principes | `frameworks.mjs` |
| EF-236/237 | Pré-mortem noté, causes → hypothèses réfutables | `frameworks.mjs` |
| EF-240/241 | Identité agent Ed25519, appartenance aux espaces | `identity.mjs` |
| EF-242 | Production signée ; non signée = refusée | `identity.mjs` |
| EF-243 | Un acteur non humain ne résout aucun gate, n'exerce aucun veto | `identity.mjs` |
| EF-244/245 | Journal typé, chaîné par hachage, rupture localisée | `journal.mjs` |
| EF-246 | État reconstructible par rejeu, vérifié par test | `journal.mjs` |
| EF-247 | Export JSONL vérifiable hors ligne | `journal.mjs` |
| EF-220/221 | Fusion CRDT commutative, tombstones, file hors ligne | `sync.mjs` |
| EF-248→251 | Workflows YAML déclaratifs + garde-fou de décision | `workflow.mjs` |
| EF-252/253 | Index transversal, recherche hybride avec plancher | `search.mjs` |
| EF-254 | Réponse avec reçus sur l'historique | `search.mjs` |
| EF-204/205 | Voix segmentée en concepts, locale ou désactivée | `voice.mjs` |
| EF-255/256 | CLI JSON in/out, jetons scopés et révocables | `cli.mjs` |
| EF-239 | Moodboard SVG déterministe, mention illustrative gravée | `visual.mjs` |

## Usage

```js
import { createEngine } from '../index.mjs';
import { createCanvasStudio, buildMatrix, promote } from './index.mjs';

const engine = createEngine({ sovereignty: 'local' });   // P1 : Ollama, rien ne sort
const studio = createCanvasStudio(engine);

await studio.create({ id: 'w1', nom: 'Session stratégique', createdBy: 'geoffroy' });
await studio.addNode('w1', { titre: 'Offre de mobilité partagée' });

const { workspace, clusters, nonIndexes } = await studio.recluster('w1', { llm: engine.llm });
const doublons = await studio.duplicates('w1');          // suggestions, rien n'est appliqué

const { idea, traitement } = promote(workspace, { clusterId: clusters[0].id, ideaId: 'i1' });
// idea.stage === 'recueillir' ; traitement.cibles contient déjà les angles morts
```

## Décisions de conception

**Clustering — single-linkage à seuil, pas HDBSCAN.** Le CDC recommandait HDBSCAN ; en zéro dépendance il est disproportionné pour v11. Le single-linkage par union-find conserve ce qui comptait : pas de `k` à fixer, le bruit reste du bruit, et le résultat est **déterministe sans graine** — plus fort que le « rejouable à graine fixée » exigé par EF-215. HDBSCAN reste ouvert en v12 si la mesure sur données réelles l'impose.

**Effet de chaînage.** Le single-linkage fusionne deux groupes reliés par une suite de nœuds ponts. Le garde-fou n'est pas un relèvement de seuil — sur une chaîne dense tous les liens sont forts et aucun seuil ne sépare — mais une **coupe d'arbre couvrant maximal** (`splitBySize`), qui retire les liens les plus faibles du squelette. C'est la coupe du dendrogramme single-link, faite explicitement.

**Déterminisme par ordre canonique.** Sur des poids ex æquo l'arbre couvrant maximal n'est pas unique. Le tri par id précède tout calcul : le déterminisme vient de l'ordre, pas d'un pari sur l'unicité.

**PRNG partagé.** Le layout importe `mulberry32` de `projection.mjs`. Le déterminisme du canvas et celui du Monte-Carlo reposent sur la même source — deux implémentations divergentes du même générateur seraient un piège silencieux.

**Scope vectoriel.** Les stores existants filtrent par `ideaId`. Plutôt que de modifier `core/memory.mjs` — en service pour la mémoire agent — `CanvasVectorIndex` encapsule le mapping `workspaceId → ws:<id>`. Un seul endroit à changer le jour où les stores accepteront un scope générique.

**Écriture atomique.** `FileCanvasRepository` écrit dans un fichier temporaire puis renomme. Les workspaces sont nettement plus volumineux que les idées ; une interruption en cours d'écriture corromprait tout le portefeuille de canvas.

**Frontière de l'ingestion.** Le décodage binaire (PDF, DOCX) est impossible en zéro dépendance et n'a rien à faire dans un cœur qui doit tourner dans le navigateur. `IngestionService` traite du **texte** ; l'extraction binaire est injectée via `extractors` — implémentée côté backend Fastify (`pdf-parse`, `mammoth`). La frontière est explicite, pas subie.

**Ed25519 via WebCrypto.** Disponible en Node 20+ *et* dans les navigateurs récents : signature réelle sans embarquer une bibliothèque de crypto. La sérialisation canonique (clés triées récursivement) est ce qui rend une signature reproductible — sans elle, `{a,b}` et `{b,a}` produiraient deux signatures pour un contenu identique.

**Pourquoi pas Yjs, finalement.** `sync.mjs` implémente la sémantique de fusion — LWW-Element-Set avec tombstones, commutative, idempotente, associative. Il manquait un *transport*, pas un algorithme : SSE le fournit (`backend/fastify/lib/canvas-hub.mjs`), sans dépendance et sans WebSocket à opérer. Ajouter Yjs aurait signifié une dépendance de plus **et** deux modèles de fusion à maintenir en parallèle — le sien étant un CRDT de texte, pertinent pour de la prose, pas pour un canvas de nœuds.

*Limite assumée* : deux personnes éditant simultanément le même champ texte tombent en dernier-écrivain-gagne, avec conflit signalé. Yjs ferait mieux sur ce cas précis ; il reste ouvert si l'usage le réclame.

**Pourquoi pas `pg` dans le cœur.** Même frontière : `core/` définit l'interface du repository, `backend/fastify/lib/canvas-postgres.mjs` l'implémente. Le journal y est *append-only au niveau de la base* (trigger), pas seulement par convention applicative — un audit qu'un `UPDATE` peut réécrire n'est pas un audit.

**Parseur YAML : un sous-ensemble assumé.** Ancres, multi-documents et blocs littéraux lèvent une erreur explicite plutôt que d'être mal interprétés. Écrire un parseur YAML complet serait une erreur ; en importer un ferait sauter la contrainte zéro dépendance.

**Le désaccord n'est jamais moyenné.** `applySwarm` matérialise chaque verdict en arête typée. Sans verdict explicite, la relation est `derive` : poser `soutient` par défaut introduirait un biais favorable silencieux.

**Synthèse visuelle sans modèle d'image.** Appeler une API de génération romprait la souveraineté du palier P1 — le concept sortirait avec l'image — et ajouterait un coût par clic. Le moodboard est *dérivé du vecteur sémantique* : deux concepts proches donnent deux palettes proches. Ce n'est pas une illustration créative, c'est une empreinte visuelle stable — l'usage réel étant de reconnaître un cluster d'un coup d'œil. La mention « ILLUSTRATIF — non validé » est un `<text>` du SVG, pas une légende affichée à côté : elle survit à la copie de l'image.

## Périmètre

**63 exigences sur 63.** Le CDC est couvert.

## Tests

```bash
cd core && node --test          # 255 tests, zéro dépendance

echo '{"cmd":"workspace.list","token":"t"}' | node core/bin/kayros-cli.mjs   # EF-255
node core/bin/kayros-cli.mjs --schema                                     # surface auto-descriptive
```

### Recettes d’intégration

```bash
cd backend/fastify && npm install && npm run verifier
```

| Recette | Vérifications | Ce qu’elle éprouve |
|---|---|---|
| `recette-p2` | 70 | Parcours HTTP complet, PostgreSQL réel, triggers et contraintes |
| `contrat-api` | 21 | Le frontend et le backend parlent la même langue |
| `temps-reel` | 20 | Deux clients simultanés, présence, réconciliation, streaming |
| `auth-reelle` | 26 | scrypt, jetons HMAC, révocation, isolation tenant bout en bout |
| `reprise-sinistre` | 25 | Perte de la table des canvas, reconstruction intégrale par rejeu |

### Recette P2 — réserve levée

```bash
cd backend/fastify && npm install && node tests/recette-p2.mjs
```

**70 vérifications** contre un vrai PostgreSQL 18 (PGlite, WASM — même moteur, mêmes triggers, mêmes contraintes) et un vrai serveur Fastify, en HTTP. La réserve du CDC §8.2 est levée pour le périmètre canvas.

La recette a trouvé **trois défauts qu'aucun test unitaire ne pouvait voir** :

1. **Le trigger append-only bloquait le `ON DELETE CASCADE`.** Un canvas ayant un journal devenait indestructible, y compris pour une demande légitime d'effacement. Corrigé par une purge délibérée (`repo.purge()`), qui exige un motif et s'inscrit elle-même dans `canvas_purge_log`.
2. **Un événement sans `id` explicite n'était pas rejouable.** Les tests fournissaient toujours un id ; un client normal ne le fait pas — `createNode` générait alors un UUID différent à chaque rejeu et EF-246 tombait. Le `Recorder` fige désormais les identifiants avant journalisation.
3. **Le nombre de nœuds produits par transformation n'était pas borné.** La consigne demandait « 1 à 3 propositions » : une consigne adressée à un LLM n'est pas une contrainte tant qu'elle n'est pas appliquée.

Reste non couvert par la recette : l'authentification réelle (scrypt/HMAC), la charge, et un PostgreSQL serveur distant plutôt qu'embarqué.
