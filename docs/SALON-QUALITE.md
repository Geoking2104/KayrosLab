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

## Retrieval hybride (runtime `/v1/salon/speak`)

1. **Rappel lexical élargi** : BM25 simplifié + expansion conceptuelle FR/EN
   (rire, vice, liberté, justice, pouvoir, vérité, bonheur, vertu, dieu, nature,
   amour, mort, guerre, richesse, travail, éducation, société, temps, art).
2. **Diversité** : 22 candidats, 4 phrases maximum par œuvre.
3. **Rerank par le modèle** : le proxy classe les 22 candidats et renvoie les
   3 meilleurs (parseur tolérant JSON ou indices).
4. **Garde d'ancrage** : si la couverture de la question est < 0,34 et qu'un
   seul terme est couvert (questions de 5 termes et plus), le tour devient un
   **aveu du manque** — aucune citation hors sujet.
5. **Vérification** : citation sous-chaîne exacte, œuvre du registre, rejet des
   œuvres d'autres auteurs, longueur et première personne.

La réponse expose `retrieval: { mode: "hybrid", coverage, candidates, rerank }`
ainsi que `engine`, `provider`, `degraded` et les `citations` vérifiées.

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
