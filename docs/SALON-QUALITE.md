# Salon — qualité de parole et portail de publication

Ce document décrit la chaîne qui garantit qu'aucun pack mémoire n'est publié
sans passer les tests de qualité de parole.

## Principe

```
catalogue (registre)
   │  enrich_catalog.mjs        œuvres + auteurs vérifiés par RDF Gutenberg
   ▼
récolte (harvest_corpus.mjs)   phrases entières 40–320 car., provenance, cache
   │
   ▼
export (kb_export.mjs)         packs kb/<auteur>.json + formules + manifeste
   │
   ▼
audit (kb_quote_audit.mjs)     chaque formule verbatim = sous-chaîne d'une source
   │
   ▼
tests (speech_eval.mjs)        mémoire, contrat, voix, jeu d'or
   │
   ▼
publish_gate.mjs               promotion atomique → backend/web/public/salon
```

En cas d'échec, **le miroir publié reste intact** ; un rapport explique le refus.

## Commandes

```bash
# 1. Étendre le catalogue (œuvres supplémentaires + nouveaux écrivains)
node salon/scripts/enrich_catalog.mjs --max-new-works 6

# 2. Récolter la mémoire (plafonds réglables)
node salon/scripts/harvest_corpus.mjs --works 6 --max 360 --workmax 90

# 3. Publier — uniquement si les tests passent
node salon/scripts/publish_gate.mjs --works 6 --max 360 --workmax 90

# Variantes utiles
node salon/scripts/publish_gate.mjs --skip-build          # teste les packs existants
node salon/scripts/publish_gate.mjs --llm                 # ajoute des tours modèle réel
node --test tests/salon-speech.test.mjs                   # tests unitaires de qualité

# 4. Publier la page et les packs sur GitHub Pages (/salon/)
node salon/scripts/publish_pages.mjs
```

## Seuils du portail

| Seuil | Valeur par défaut | Signification |
|---|---:|---|
| `--min-sentences` | 120 | phrases citables minimum par auteur (70 si l'auteur n'a qu'une œuvre) |
| `--min-coverage` | 0,95 | part des auteurs du catalogue ayant un pack (bloquant) |
| `--min-turn-pass` | 0,98 | part des tours du jeu d'or conformes au contrat (bloquant) |
| `--min-doctrine` | 0,80 | part des ancres doctrinales retrouvées (avertissement) |
| `--min-lang` | 0,80 | part des phrases dans la langue de l'auteur (avertissement) |
| `--min-voice-distance` | 0,12 | distance moyenne entre profils de voix (bloquant) |

## Ce que vérifie `speech_eval.mjs`

**Actifs (toujours, sans LLM)**

1. Couverture : chaque auteur du catalogue a un pack.
2. Bornes : phrases entières de 40 à 320 caractères, ponctuation finale, début propre.
3. Doublons : aucune phrase répétée dans un pack.
4. Bruit : aucun résidu Gutenberg/éditeur.
5. Formules : chaque `verbatim` est une sous-chaîne exacte d'une phrase du pack.
6. Doctrine : les ancres (`startsWith`) se retrouvent dans la mémoire.
7. Langue : cohérence avec la langue de l'auteur.
8. Voix : vecteurs de style (longueur, ponctuation, lexique) ; deux packs identiques
   ou trop proches sont refusés.
9. Jeu d'or : pour chaque auteur, 2 questions (doctrine + générique) composées par
   le composeur déterministe ; contrôle du contrat (première personne, destinataire
   nommé, phrases closes, citation vérifiée, pas d'anachronisme, pas de liste).

**Modèle réel (`--llm`, si `SALON_LLM_URL` ou `XAI_API_KEY`)**

Mêmes contrôles sur des tours réellement générés ; les échecs sont signalés et
comptés dans le rapport.

## Rapports

- `salon/scripts/reports/speech-eval-<date>.json|md`
- `salon/scripts/reports/kb-quote-audit-<date>.md`
- `salon/scripts/reports/publish-gate-<date>.json`
- `salon/scripts/reports/harvest-<date>.json`
- `salon/scripts/reports/catalog-enrich-<date>.json`

## Deux miroirs de publication

- `backend/web/public/salon/` : miroir complet (corpus, formules, packs) lu par
  l'API `/v1/salon/*` et assemblé sur le VPS.
- `salon/` (racine) : page autonome + `catalog.json`, `doctrine.json`,
  `kb-manifest.json` et `kb/` — servie par GitHub Pages sur
  `https://www.kayroslab.com/salon/`. Synchronisation : `publish_pages.mjs`.

`www.kayroslab.com` pointe actuellement vers GitHub Pages (CNAME
`geoking2104.github.io`) ; le vhost VPS `/salon/` reste prêt pour un basculement
DNS ultérieur.

## Persistance du cercle

- Chaque navigateur génère un **UUID anonyme** (`salon-client-v1`) ; aucun compte.
- `GET /v1/salon/room?id=<uuid>` relit la table ; `POST` sauvegarde
  `{ room: { question, authorIds, turns } }`.
- Les tours conservent `authorId`, `text`, `prise`, `citations`, `act`, `to` ; les
  prises et la question sont donc restaurées avec le fil.
- Sauvegarde débouncée (300 ms) après chaque tour, invitation ou retrait ;
  l'État est borné par `sanitizeSalonState` (512 Ko, 48 cercles, 500 tours).
- L'identifiant est non devinable et non listé ; routes limitées à 120 req/min
  (GET) et 60 req/min (POST).

## Retrieval hybride (runtime `/v1/salon/speak`)

1. **Rappel lexical élargi** : BM25 simplifié + expansion conceptuelle FR/EN
   (rire, vice, liberté, justice, pouvoir, vérité, bonheur, vertu, dieu, nature,
   amour, mort, guerre, richesse, travail, éducation, société, temps, art).
2. **Diversité** : 22 candidats, 4 phrases maximum par œuvre.
3. **Index vectoriel persistant `bge-m3`** (prioritaire) : 50 phrases par auteur
   couvrant les 20 concepts, embeddées une fois au déploiement (1024 dimensions,
   Ollama local), stockées dans `backend/fastify/data/salon-emb/`. L'API classe
   les phrases par cosine, puis rerank modèle sur les 12 meilleures.
4. **Repli dense à la requête** : si l'index manque, les 8 meilleurs candidats
   sont ré-embeddés avec la question ; repli suivant : rerank modèle puis lexical.
5. **Garde d'ancrage** : si aucun passage ne porte le concept principal (ou un
   synonyme), le tour devient un **aveu du manque** — aucune citation hors sujet.
6. **Vérification** : citation sous-chaîne exacte, œuvre du registre, rejet des
   œuvres d'autres auteurs, longueur et première personne.

La réponse expose `retrieval: { mode, coverage, candidates, rerank, dense, index }`.

## Construction de l'index

```bash
node salon/scripts/build_embeddings.mjs --max-per-author 50 --batch 32
```

- Sélection : un passage par concept (rire, vice, liberté, justice, pouvoir,
  vérité, bonheur, vertu, dieu, nature, amour, mort, guerre, richesse, travail,
  éducation, société, temps, art), puis échantillonnage régulier.
- Sorties : `<auteur>.f32` (vecteurs normalisés), `<auteur>.json` (phrases +
  provenance), `manifest.json` (version, modèle, dimensions, compteurs).
- Version d'index (`version: 2`) : un manifeste obsolète déclenche un rebuild ;
  les auteurs déjà calculés sont réutilisés (reprise après timeout).
- Le déploiement VPS lance ce script à chaque passage ; il skip si l'index est
  déjà à la bonne version.

## Citations multilingues (i18n)

- **L'original reste la preuve** : une citation est vérifiée contre la phrase
  source, dans la langue du livre.
- **Traduction d'affichage** : si la citation n'est pas dans la langue de
  l'utilisateur (`locale: fr|en`), le serveur ajoute `translation` et
  `translationLang` ; l'interface affiche l'original puis la traduction.
- **Citation traduite par le modèle** : si le modèle traduit lui-même la phrase,
  le serveur traduit les sources candidates et vérifie la correspondance ; la
  citation est marquée `translated: true` avec `original`.
- Les replis déterministes sont eux aussi traduits quand la langue diffère.

## Diagnostic `bge-m3`

`GET /v1/salon/embeddings/status` renvoie le modèle, la dimension, la latence et
l'état de l'index, sans exposer de secret :

```json
{
  "ok": true, "model": "bge-m3", "dims": 1024, "latencyMs": 4155,
  "index": { "model": "bge-m3", "dims": 1024, "authors": 68, "sentences": 3400, "builtAt": "…" }
}
```

Le déploiement VPS installe Ollama en loopback et exécute `ollama pull bge-m3`
(`deploy/ovh-vps/install-ollama.sh`), avec validation d'un vecteur non vide.

## Mémoire : plafonds et cache

- `--works N` : œuvres lues par auteur (6 par défaut) ; les œuvres portant une
  ancre de doctrine sont ajoutées en priorité (+2 au plus).
- `--max N` : phrases conservées par auteur (360 par défaut).
- `--workmax N` : phrases conservées par œuvre (90 par défaut ; 240 si l'auteur
  n'a qu'une œuvre).
- Le cache d'audit (`salon/.cache/sources/<auteur>/<œuvre>.txt`) ne contient que
  les phrases réellement conservées — il est ignoré par Git et suffit à vérifier
  chaque citation.

## Ajouter un auteur

1. Ajouter le seed dans `NEW_AUTHORS` (`salon/scripts/enrich_catalog.mjs`) :
   `id`, `name`, `kind`, `lang`, `era`, `blurb`, `wikipedia`, `monogram`, `match`.
2. Lancer `enrich_catalog.mjs --dry-run` et contrôler les titres retenus.
3. Lancer la récolte puis le portail ; un auteur sans ≥ 120 phrases est refusé.

## Intégration CI

Le portail renvoie un code non nul en cas d'échec ; il peut donc servir d'étape
bloquante avant tout déploiement :

```yaml
- run: node salon/scripts/publish_gate.mjs --skip-build
- run: node --test tests/salon-speech.test.mjs
```

## Cercle : persistance, partage, TTL

Le cercle (convives, question, tours, prises) est enregistr� c�t� serveur sous un
identifiant anonyme g�n�r� par le navigateur (`salon-client-v1`, UUID).

- `GET /v1/salon/room?id=<uuid>` renvoie `{ room, updatedAt, storage }` ;
  `POST` avec `{ room }` remplace l'�tat et renvoie le nouvel `updatedAt`.
- `storage` vaut `file` quand `KAYROS_SALON_DIR` pointe sur un volume persistant
  (`/opt/kayroslab/data/salon` en production), `memory` sinon � dans ce dernier
  cas les cercles disparaissent � chaque red�marrage.
- **Partage multi-appareils** : l'URL `�/salon/?c=<uuid>` adopte l'identifiant
  re�u (il est �crit dans `localStorage`), ce qui ouvre le m�me cercle sur un
  autre navigateur. Le bouton � Copier le lien du cercle � copie cette URL
  (`navigator.clipboard`, repli sur un `prompt`).
- **Synchronisation entre onglets** : la page relit le cercle au retour de focus
  (`focus`, `visibilitychange`) et toutes les 15 s ; elle applique la version
  distante seulement si son `updatedAt` est plus r�cent et qu'aucun tour n'est en
  cours (`busy`). Une question en cours de frappe n'est jamais �cras�e.
- **TTL** : `SALON_ROOM_TTL_DAYS` (30 jours par d�faut) purge au d�marrage puis
  toutes les 6 h les cercles dont `updatedAt` (ou la date du fichier) d�passe le
  d�lai. Les cercles sont anonymes : aucun pr�fixe n'est filtr�.
- Limite connue : l'�criture est � dernier arriv� gagne � ; deux onglets qui
  modifient le m�me cercle au m�me instant peuvent perdre un tour. Un compte
  (ou un `If-Match` sur `updatedAt`) serait n�cessaire pour une fusion.

## Variables d'environnement utiles

| Variable | Effet |
| --- | --- |
| `KAYROS_SALON_DIR` | R�pertoire des cercles (`file`) ; sinon m�moire |
| `SALON_ROOM_TTL_DAYS` | Dur�e de vie d'un cercle inactif (30 par d�faut) |
| `SALON_EMBED_MODEL` | Mod�le dense (`bge-m3`) |
