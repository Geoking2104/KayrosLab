# Salon â€” qualitÃ© de parole et portail de publication

Ce document dÃ©crit la chaÃ®ne qui garantit qu'aucun pack mÃ©moire n'est publiÃ©
sans passer les tests de qualitÃ© de parole.

## Principe

```
catalogue (registre)
   â”‚  enrich_catalog.mjs        Å“uvres + auteurs vÃ©rifiÃ©s par RDF Gutenberg
   â–¼
rÃ©colte (harvest_corpus.mjs)   phrases entiÃ¨res 40â€“320 car., provenance, cache
   â”‚
   â–¼
export (kb_export.mjs)         packs kb/<auteur>.json + formules + manifeste
   â”‚
   â–¼
audit (kb_quote_audit.mjs)     chaque formule verbatim = sous-chaÃ®ne d'une source
   â”‚
   â–¼
tests (speech_eval.mjs)        mÃ©moire, contrat, voix, jeu d'or
   â”‚
   â–¼
publish_gate.mjs               promotion atomique â†’ backend/web/public/salon
```

En cas d'Ã©chec, **le miroir publiÃ© reste intact** ; un rapport explique le refus.

## Commandes

```bash
# 1. Ã‰tendre le catalogue (Å“uvres supplÃ©mentaires + nouveaux Ã©crivains)
node salon/scripts/enrich_catalog.mjs --max-new-works 6

# 2. RÃ©colter la mÃ©moire (plafonds rÃ©glables)
node salon/scripts/harvest_corpus.mjs --works 6 --max 360 --workmax 90

# 3. Publier â€” uniquement si les tests passent
node salon/scripts/publish_gate.mjs --works 6 --max 360 --workmax 90

# Variantes utiles
node salon/scripts/publish_gate.mjs --skip-build          # teste les packs existants
node salon/scripts/publish_gate.mjs --llm                 # ajoute des tours modÃ¨le rÃ©el
node --test tests/salon-speech.test.mjs                   # tests unitaires de qualitÃ©

# 4. Publier la page et les packs sur GitHub Pages (/salon/)
node salon/scripts/publish_pages.mjs
```

## Seuils du portail

| Seuil | Valeur par dÃ©faut | Signification |
|---|---:|---|
| `--min-sentences` | 120 | phrases citables minimum par auteur (70 si l'auteur n'a qu'une Å“uvre) |
| `--min-coverage` | 0,95 | part des auteurs du catalogue ayant un pack (bloquant) |
| `--min-turn-pass` | 0,98 | part des tours du jeu d'or conformes au contrat (bloquant) |
| `--min-doctrine` | 0,80 | part des ancres doctrinales retrouvÃ©es (avertissement) |
| `--min-lang` | 0,80 | part des phrases dans la langue de l'auteur (avertissement) |
| `--min-voice-distance` | 0,12 | distance moyenne entre profils de voix (bloquant) |

## Ce que vÃ©rifie `speech_eval.mjs`

**Actifs (toujours, sans LLM)**

1. Couverture : chaque auteur du catalogue a un pack.
2. Bornes : phrases entiÃ¨res de 40 Ã  320 caractÃ¨res, ponctuation finale, dÃ©but propre.
3. Doublons : aucune phrase rÃ©pÃ©tÃ©e dans un pack.
4. Bruit : aucun rÃ©sidu Gutenberg/Ã©diteur.
5. Formules : chaque `verbatim` est une sous-chaÃ®ne exacte d'une phrase du pack.
6. Doctrine : les ancres (`startsWith`) se retrouvent dans la mÃ©moire.
7. Langue : cohÃ©rence avec la langue de l'auteur.
8. Voix : vecteurs de style (longueur, ponctuation, lexique) ; deux packs identiques
   ou trop proches sont refusÃ©s.
9. Jeu d'or : pour chaque auteur, 2 questions (doctrine + gÃ©nÃ©rique) composÃ©es par
   le composeur dÃ©terministe ; contrÃ´le du contrat (premiÃ¨re personne, destinataire
   nommÃ©, phrases closes, citation vÃ©rifiÃ©e, pas d'anachronisme, pas de liste).

**ModÃ¨le rÃ©el (`--llm`, si `SALON_LLM_URL` ou `XAI_API_KEY`)**

MÃªmes contrÃ´les sur des tours rÃ©ellement gÃ©nÃ©rÃ©s ; les Ã©checs sont signalÃ©s et
comptÃ©s dans le rapport.

## Rapports

- `salon/scripts/reports/speech-eval-<date>.json|md`
- `salon/scripts/reports/kb-quote-audit-<date>.md`
- `salon/scripts/reports/publish-gate-<date>.json`
- `salon/scripts/reports/harvest-<date>.json`
- `salon/scripts/reports/catalog-enrich-<date>.json`

## Deux miroirs de publication

- `backend/web/public/salon/` : miroir complet (corpus, formules, packs) lu par
  l'API `/v1/salon/*` et assemblÃ© sur le VPS.
- `salon/` (racine) : page autonome + `catalog.json`, `doctrine.json`,
  `kb-manifest.json` et `kb/` â€” servie par GitHub Pages sur
  `https://www.kayroslab.com/salon/`. Synchronisation : `publish_pages.mjs`.

`www.kayroslab.com` pointe actuellement vers GitHub Pages (CNAME
`geoking2104.github.io`) ; le vhost VPS `/salon/` reste prÃªt pour un basculement
DNS ultÃ©rieur.

## Persistance du cercle

- Chaque navigateur gÃ©nÃ¨re un **UUID anonyme** (`salon-client-v1`) ; aucun compte.
- `GET /v1/salon/room?id=<uuid>` relit la table ; `POST` sauvegarde
  `{ room: { question, authorIds, turns } }`.
- Les tours conservent `authorId`, `text`, `prise`, `citations`, `act`, `to` ; les
  prises et la question sont donc restaurÃ©es avec le fil.
- Sauvegarde dÃ©bouncÃ©e (300 ms) aprÃ¨s chaque tour, invitation ou retrait ;
  l'Ã‰tat est bornÃ© par `sanitizeSalonState` (512 Ko, 48 cercles, 500 tours).
- L'identifiant est non devinable et non listÃ© ; routes limitÃ©es Ã  120 req/min
  (GET) et 60 req/min (POST).

## Retrieval hybride (runtime `/v1/salon/speak`)

1. **Rappel lexical Ã©largi** : BM25 simplifiÃ© + expansion conceptuelle FR/EN
   (rire, vice, libertÃ©, justice, pouvoir, vÃ©ritÃ©, bonheur, vertu, dieu, nature,
   amour, mort, guerre, richesse, travail, Ã©ducation, sociÃ©tÃ©, temps, art).
2. **DiversitÃ©** : 22 candidats, 4 phrases maximum par Å“uvre.
3. **Index vectoriel persistant `bge-m3`** (prioritaire) : 50 phrases par auteur
   couvrant les 20 concepts, embeddÃ©es une fois au dÃ©ploiement (1024 dimensions,
   Ollama local), stockÃ©es dans `backend/fastify/data/salon-emb/`. L'API classe
   les phrases par cosine, puis rerank modÃ¨le sur les 12 meilleures.
4. **Repli dense Ã  la requÃªte** : si l'index manque, les 8 meilleurs candidats
   sont rÃ©-embeddÃ©s avec la question ; repli suivant : rerank modÃ¨le puis lexical.
5. **Garde d'ancrage** : si aucun passage ne porte le concept principal (ou un
   synonyme), le tour devient un **aveu du manque** â€” aucune citation hors sujet.
6. **VÃ©rification** : citation sous-chaÃ®ne exacte, Å“uvre du registre, rejet des
   Å“uvres d'autres auteurs, longueur et premiÃ¨re personne.

La rÃ©ponse expose `retrieval: { mode, coverage, candidates, rerank, dense, index }`.

## Construction de l'index

```bash
node salon/scripts/build_embeddings.mjs --max-per-author 50 --batch 32
```

- SÃ©lection : un passage par concept (rire, vice, libertÃ©, justice, pouvoir,
  vÃ©ritÃ©, bonheur, vertu, dieu, nature, amour, mort, guerre, richesse, travail,
  Ã©ducation, sociÃ©tÃ©, temps, art), puis Ã©chantillonnage rÃ©gulier.
- Sorties : `<auteur>.f32` (vecteurs normalisÃ©s), `<auteur>.json` (phrases +
  provenance), `manifest.json` (version, modÃ¨le, dimensions, compteurs).
- Version d'index (`version: 2`) : un manifeste obsolÃ¨te dÃ©clenche un rebuild ;
  les auteurs dÃ©jÃ  calculÃ©s sont rÃ©utilisÃ©s (reprise aprÃ¨s timeout).
- Le dÃ©ploiement VPS lance ce script Ã  chaque passage ; il skip si l'index est
  dÃ©jÃ  Ã  la bonne version.

## Citations multilingues (i18n)

- **L'original reste la preuve** : une citation est vÃ©rifiÃ©e contre la phrase
  source, dans la langue du livre.
- **Traduction d'affichage** : si la citation n'est pas dans la langue de
  l'utilisateur (`locale: fr|en`), le serveur ajoute `translation` et
  `translationLang` ; l'interface affiche l'original puis la traduction.
- **Citation traduite par le modÃ¨le** : si le modÃ¨le traduit lui-mÃªme la phrase,
  le serveur traduit les sources candidates et vÃ©rifie la correspondance ; la
  citation est marquÃ©e `translated: true` avec `original`.
- Les replis dÃ©terministes sont eux aussi traduits quand la langue diffÃ¨re.

## Diagnostic `bge-m3`

`GET /v1/salon/embeddings/status` renvoie le modÃ¨le, la dimension, la latence et
l'Ã©tat de l'index, sans exposer de secret :

```json
{
  "ok": true, "model": "bge-m3", "dims": 1024, "latencyMs": 4155,
  "index": { "model": "bge-m3", "dims": 1024, "authors": 68, "sentences": 3400, "builtAt": "â€¦" }
}
```

Le dÃ©ploiement VPS installe Ollama en loopback et exÃ©cute `ollama pull bge-m3`
(`deploy/ovh-vps/install-ollama.sh`), avec validation d'un vecteur non vide.

## MÃ©moire : plafonds et cache

- `--works N` : Å“uvres lues par auteur (6 par dÃ©faut) ; les Å“uvres portant une
  ancre de doctrine sont ajoutÃ©es en prioritÃ© (+2 au plus).
- `--max N` : phrases conservÃ©es par auteur (360 par dÃ©faut).
- `--workmax N` : phrases conservÃ©es par Å“uvre (90 par dÃ©faut ; 240 si l'auteur
  n'a qu'une Å“uvre).
- Le cache d'audit (`salon/.cache/sources/<auteur>/<Å“uvre>.txt`) ne contient que
  les phrases rÃ©ellement conservÃ©es â€” il est ignorÃ© par Git et suffit Ã  vÃ©rifier
  chaque citation.

## Ajouter un auteur

1. Ajouter le seed dans `NEW_AUTHORS` (`salon/scripts/enrich_catalog.mjs`) :
   `id`, `name`, `kind`, `lang`, `era`, `blurb`, `wikipedia`, `monogram`, `match`.
2. Lancer `enrich_catalog.mjs --dry-run` et contrÃ´ler les titres retenus.
3. Lancer la rÃ©colte puis le portail ; un auteur sans â‰¥ 120 phrases est refusÃ©.

## IntÃ©gration CI

Le portail renvoie un code non nul en cas d'Ã©chec ; il peut donc servir d'Ã©tape
bloquante avant tout dÃ©ploiement :

```yaml
- run: node salon/scripts/publish_gate.mjs --skip-build
- run: node --test tests/salon-speech.test.mjs
```

## Cercle : persistance, partage, TTL

Le cercle (convives, question, tours, prises) est enregistré côté serveur sous un
identifiant anonyme généré par le navigateur (`salon-client-v1`, UUID).

- `GET /v1/salon/room?id=<uuid>` renvoie `{ room, updatedAt, storage }` ;
  `POST` avec `{ room }` remplace l'état et renvoie le nouvel `updatedAt`.
- `storage` vaut `file` quand `KAYROS_SALON_DIR` pointe sur un volume persistant
  (`/opt/kayroslab/data/salon` en production), `memory` sinon — dans ce dernier
  cas les cercles disparaissent à chaque redémarrage.
- **Partage multi-appareils** : l'URL `…/salon/?c=<uuid>` adopte l'identifiant
  reçu (il est écrit dans `localStorage`), ce qui ouvre le même cercle sur un
  autre navigateur. Le bouton « Copier le lien du cercle » copie cette URL
  (`navigator.clipboard`, repli sur un `prompt`).
- **Synchronisation entre onglets** : la page relit le cercle au retour de focus
  (`focus`, `visibilitychange`) et toutes les 15 s ; elle applique la version
  distante seulement si son `updatedAt` est plus récent et qu'aucun tour n'est en
  cours (`busy`). Une question en cours de frappe n'est jamais écrasée.
- **TTL** : `SALON_ROOM_TTL_DAYS` (30 jours par défaut) purge au démarrage puis
  toutes les 6 h les cercles dont `updatedAt` (ou la date du fichier) dépasse le
  délai. Les cercles sont anonymes : aucun préfixe n'est filtré.
- Limite connue : l'écriture est « dernier arrivé gagne » ; deux onglets qui
  modifient le même cercle au même instant peuvent perdre un tour. Un compte
  (ou un `If-Match` sur `updatedAt`) serait nécessaire pour une fusion.

## Variables d'environnement utiles

| Variable | Effet |
| --- | --- |
| `KAYROS_SALON_DIR` | Répertoire des cercles (`file`) ; sinon mémoire |
| `SALON_ROOM_TTL_DAYS` | Durée de vie d'un cercle inactif (30 par défaut) |
| `SALON_EMBED_MODEL` | Modèle dense (`bge-m3`) |

## Fusion des cercles concurrents

`POST /v1/salon/room` accepte deux champs supplémentaires :

- `baseUpdatedAt` : la version du cercle que le client avait lue ;
- `intent` : `append` (défaut) ou `replace` (action destructive).

Si le serveur a une version plus récente et que l'intention est `append`,
`mergeRooms` (`backend/fastify/lib/salon-merge.mjs`) fait l'union des convives et
des tours, dédoublonne par (auteur, texte) et rétablit l'ordre chronologique.
Sans `baseUpdatedAt` mais avec un cercle déjà rempli, la fusion s'applique aussi :
ne rien perdre prime.

Les actions destructives — recommencer, retirer un convive, poser une nouvelle
question — envoient `intent: 'replace'` : sans cela, la fusion ferait revenir les
tours que l'utilisateur vient de retirer.

## Citations et ponctuation

La vérification (`backend/fastify/lib/salon-quotes.mjs`) compare les citations
après normalisation : apostrophes et guillemets typographiques, tirets, espaces
insécables, **et espace avant `; : ! ? .`**. Une citation de Candide « en
enrageant; car » est donc reconnue dans une source qui porte « enrageant ; car ».
Les ellipses sont vérifiées par fragments ordonnés.

## /health : configuré ? effectif

`/health` expose `llm.provider` (configuré) et `llm.effective` /
`llm.lastFallback` (ce qui a réellement répondu). Un repli NVIDIA ? Mistral est
visible sans consulter les logs ; aucune clé n'est exposée.

## Deux régimes de parole (citation ou doctrine)

Le pack publié fait ~270 phrases par auteur : le mot d'une question peut y
manquer (« devoir » chez Kant, « mariage » chez Austen). Un contrat unique
« cite exactement ou tais-toi » produisait un aveu dans 5 cas sur 8.

- **Régime strict** — le concept de la question figure dans les passages
  retenus : la réplique doit contenir une citation exacte, vérifiée.
- **Régime de doctrine** — le concept manque : la réplique parle depuis les
  passages les plus proches (similarité `bge-m3`), **sans guillemets**. Toute
  citation produite est quand même vérifiée ; si elle est fausse, la réponse est
  refusée. L'API renvoie alors `degraded: "doctrine sans citation"`.
- **Salvage** — réplique valide sauf l'absence de citation : elle est conservée
  (`engine: "llm"`, `degraded: "citation absente"`) au lieu d'être remplacée par
  un gabarit.

La « prise » est nettoyée : ni citation recopiée d'un passage, ni balisage
Markdown, ni phrase dans une autre langue, ni fragment trop court ; sinon elle
est dérivée des premières phrases de la réplique.

Mesure sur 8 auteurs (API live) : **0/8 ? 6–7/8** répliques produites par le
modèle (la variation vient du modèle). Les replis restants sont des citations
inventées ou l'emploi d'une œuvre d'un autre auteur — refusés à dessein.

`providerFallback` est renvoyé à part : `degraded` décrit la réplique, pas la
santé du fournisseur.
