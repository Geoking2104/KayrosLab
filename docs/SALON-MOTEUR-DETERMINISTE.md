# Salon — moteur déterministe du fil de discussion

Ce document répond à une remarque précise : **le fil ne répond pas à la question
posée par l'hôte**. Il établit ce qui, dans la logique d'alors, s'y opposait, puis
décrit le moteur déterministe livré et ce qu'apporte (ou non) `laya-onnx`.

Lié : [`SALON-AGENT-AUTEUR.md`](./SALON-AGENT-AUTEUR.md) (contrat de parole),
[`SALON.md`](./SALON.md). Fichiers : `salon-engine.js`, `circle-run.js`,
`circle-speech.js`, `salon/scripts/align_corpus.mjs`, `tests/salon-engine.test.mjs`.

---

## 1. Ce qui s'opposait à un fil relié à la question

Le salon servi (page statique) parlait à `POST /v1/demo/chat`, qui n'est qu'un
**relais LLM** (`backend/fastify/routes/llm.mjs`) : il reçoit `system` + `user` et
appelle le modèle à `temperature 0.4`. Aucune mémoire, aucun fil, aucun cadrage
côté serveur. Toute l'intelligence était donc côté navigateur, où cinq défauts
cumulés coupaient le fil de la question :

1. **La mémoire de l'auteur était absente du prompt.** `circle-run.js` envoyait
   `system = "Tu es <nom>. Role: <role>. …"` : le nom seul. Ni le `blurb` (la
   thèse), ni la méthode, ni les œuvres, ni aucun passage n'entraient dans l'appel.
   L'« intelligence conférée à chaque auteur » ne participait pas.
2. **Le fil n'était jamais renvoyé.** Chaque tour était une question isolée ; les
   agents ne s'entendaient pas et ne répondaient pas les uns aux autres.
3. **La question n'était pas circonscrite.** `frameQuestions()` et `askVoice()`
   appliquaient un gabarit figé (« si IA, liberté ou conscience : grain / test /
   espèce ») quelle que soit la question posée.
4. **Le repli déterministe était hors sujet par construction.** `localVoice()`
   était codé en dur sur l'IA et la conscience (« La lecture trop nette confond
   l'outil et l'agent… »). Sans modèle (ou en échec), la réplique parlait d'autre
   chose que la question.
5. **L'ancrage n'était pas une phrase.** Les passages sont des tranches coupées au
   milieu d'une phrase ; `proofFromAuthor()` recollait une tranche ou une note
   d'éditeur (« t l'auteur eut ordre… [7]… des jésuites »). Le contrat
   (`SALON-AGENT-AUTEUR.md` §3) demandait pourtant une **phrase entière**, ou
   l'aveu du manque.

À noter : `circle-speech.js` reconstruisait bien un début de « fil récent » et
parsait `PRISE`/`REPLIQUE`, mais **sans mémoire ni passages**, et il écrasait le
`user` du moteur — il neutralisait donc, à son insu, toute amélioration du prompt.

### 1 bis. Aucun modèle n'est branché en production

`POST /v1/demo/chat` répond aujourd'hui `[mock] (demo-agent) reponse simulee a: …` :
dans `backend/fastify/lib/context.mjs`, le fournisseur par défaut est
`MISTRAL_API_KEY ? 'mistral' : (ANTHROPIC_API_KEY ? 'anthropic' : 'mock')`. Sans clé,
c'est `mock` (`core/kayros-llm.mjs`). Le client rejette `[mock]` et retombe donc sur
le texte déterministe. **Intégrer une vraie LLM aiderait — mais il n'y en a pas
encore ; et elle ne suffira pas seule à donner une logique aux relations.**

## 2. Le moteur déterministe livré

`backend/web/public/salon/salon-engine.js` — fonction pure, sans aléa ni `Date`,
utilisable navigateur (`window.SalonEngine`) et Node (`module.exports`).

| Fonction | Rôle |
|---|---|
| `scope(question)` | **Cadrage déterministe** : `terms` (racinisation légère), `demand` (definition / cause / maniere / norme / verite / quantite / valeur / these), `domain` + `label` (16 domaines + générique, classés par clé trouvée pondérée par la position), `keys` (vocabulaire du dossier), `concepts`. |
| `retrieve(passages, scope, k)` | Classe la mémoire de l'auteur par pertinence (recouvrement de termes, requête élargie au vocabulaire du domaine) ; extrait pour chaque passage une **phrase entière** (`bestSentence`), sans résidu d'OCR ni note d'éditeur. |
| `compose({author, scope, passage, lastTurn, act, method})` | Compose **PRISE + RÉPLIQUE** : ressaisir la prise précédente → position (thèse du domaine/demande ou `blurb` de l'auteur) → ancrage (une œuvre nommée, une phrase entière, **ou l'aveu du manque**) → avancer. Elenchus : définir et interroger, sans conclure. |
| `answer({author, question, history, …})` | Tour complet : `scope` → `retrieve` → `compose`. C'est le repli **et** la source de vérité d'ancrage. |
| `planTurn({role, history})` | **Planificateur dialectique** : qui parle, à qui (`toName`), sur quel point (`point` = prise précédente), avec quel acte (`ouvre` / `objecte` / `precise` / `minute` / `ajoute`). C'est ce qui donne une **logique aux rapports** — au lieu d'un ordre positionnel. |
| `persona(author, lang)` | Mémoire de l'auteur (nom, genre, époque, thèse/`blurb`, méthode, œuvres) — pour le prompt LLM. |
| `floorPrompt({…})` | `system` + `user` qui portent **question (fil directeur), cadrage, fil récent, passages**. |
| `parseSpeech`, `firstSentences`, `relevance`, … | Utilitaires (contrat PRISE/REPLIQUE). |

### Intégration dans le salon servi

- `circle-run.js` charge `corpus.json` (mémoire), entretient un **fil de discussion**
  (`threadHistory`, borné à 12 tours) et construit l'appel via `floorPrompt` ;
  le repli est `SalonEngine.answer` (plus de texte IA codé en dur).
- `circle-speech.js` **ne réécrit plus** le `user` du moteur (garde le fil et les
  passages) ; il conserve le titrage FR, le parsing `PRISE` et la consignation.
- `corpus.json` est **aligné** à la construction (`salon/scripts/align_corpus.mjs`) :
  chaque passage porte `s`, une phrase entière citables (299/683 passages).

### Effet

Deux questions différentes produisent deux tours différents ; la réplique nomme le
sujet de la question et reste dans le domaine ; **la thèse vient de la mémoire propre
de l'auteur** (son `blurb`), donc les voix diffèrent ; le fil s'accroche à la prise
précédente **en nommant l'interlocuteur** ; l'agent cite une phrase entière quand sa
mémoire répond, sinon il dit qu'il ne peut pas citer.
Vérifié par `tests/salon-engine.test.mjs` (10 tests, déterministes) et par un tour à
quatre convives (`lecteur → objecteur → défenseur → secrétaire`).

## 3. `laya-onnx` : où il aide, où il ne faut pas l'employer

[`laya-onnx`](https://github.com/Geoking2104/laya-onnx) exécute **Laya** sur ONNX
Runtime : un modèle de **décisions typées** (`choice` / `score` / `noul`), sans
génération de tokens. Deux atouts pour ce problème : `argmax` **déterministe**
(`deterministic=True` → `threads=1`, `predict_argmax`) et des sorties typées — pas
de prose à recoller.

Deux limites qui le cantonnent au **serveur**, hors du chemin navigateur :

- **Poids ~1,7 Go** et latence publiée **≈ 2,8 s / appel** (médiane 1,76 s). Pour
  le tour d'un convive dans une page, c'est hors budget.
- Il **ne rédige pas** : il tranche. Il ne remplace donc pas `compose()`.

**Proposition (adaptateur optionnel, côté `backend/`).** S'en servir comme **garde
de précision** là où un verdict typé suffit, en amont du moteur :

| Question Laya (`noul`/`choice`/`score`) | Usage |
|---|---|
| `noul` « ce passage répond-il à CETTE question ? » | Filtre de récupération : n'ancrer que sur un `true`. |
| `choice` « laquelle des œuvres de cet auteur est ici pertinente ? » (`criteria` = titres) | Choisit l'œuvre à nommer quand plusieurs passages rivalisent. |
| `score` « à quel point ce tour quitte-t-il la question de table ? » | Rejette un tour hors dossier avant affichage. |

Schéma prêt : [`salon/scripts/laya-gate-questions.json`](../salon/scripts/laya-gate-questions.json).
Le garde s'insère dans `speak.ts` (app serveur, où l'API XAI est déjà choisie) et
**pas** dans la page ; le navigateur garde `salon-engine.js`, sans dépendance.

## 4. Brancher la LLM, mémoire par auteur, corpus plus riche

### 4.1 Brancher la LLM (une clé, un redéploiement)

Le câblage est automatique : `backend/fastify/lib/context.mjs` choisit
`MISTRAL_API_KEY ? 'mistral' : (ANTHROPIC_API_KEY ? 'anthropic' : 'mock')`, et le
déploiement VPS (`deploy-vps-backend.yml`) écrit la clé dans le `.env` du serveur.

1. GitHub → Settings → Secrets and variables → Actions → **New secret** :
   `MISTRAL_API_KEY` = votre clé Mistral ; (option) `MISTRAL_MODEL` = `mistral-small-latest`.
2. Relancer **Deploy KayrosLab backend - OVH VPS** (Actions → Run workflow).
3. Vérifier : `curl -s https://api.kayroslab.com/health` → `"llm":{"provider":"mistral","live":true,…}`.

Tant que la clé est absente, le déploiement **n'échoue plus** : il avertit et le
salon reste sur le moteur déterministe (`provider: "mock"`). Côté navigateur, rien
à changer : le `floorPrompt` porte déjà persona + question + cadrage + fil + passages.

### 4.2 Mémoire par auteur

Chaque convive relit désormais **ses propres tours** (`selfByAuthor` dans
`circle-run.js`, borné à 8), en plus du fil partagé :

- `floorPrompt` reçoit un bloc « Ta mémoire — tes tours précédents (reste cohérent,
  ne te répète pas) » ;
- `compose` reformule sa prise en « Comme je le tenais déjà : … » quand il a déjà
  parlé — la voix reste la même, sans se répéter.

### 4.3 Corpus plus riche

`salon/scripts/harvest_corpus.mjs` reconstruit la mémoire depuis le **catalogue**
(chaque œuvre porte son URL Gutenberg) : phrases entières et propres (en-tête/pied
Gutenberg, préfaces, notices éditoriales et lignes d'imprimeur écartés), échantillon
régulier par œuvre. Résultat : **54 auteurs, ~2 000 phrases citables** (min. 18 par
auteur) contre 683 extraits coupés auparavant.

```bash
node salon/scripts/harvest_corpus.mjs --works 3 --max 40 --workmax 20
```

Les clés de domaine de `salon-engine.js` incluent aussi les termes **anglais**
(`freedom`, `power`, `justice`, `truth`, `pleasure`, `war`…), car le corpus est
surtout anglophone alors que les questions sont en français.

## 5. Étapes suivantes

1. **Prompt serveur** : porter le même contrat dans `speak.ts` (il y est déjà) et
   aligner les deux implémentations, pour supprimer la double logique.
2. **Laya (option)** : brancher le garde `noul` de récupération derrière un drapeau,
   mesurer précision/latence, puis décider.
3. **Traduction/sémantique** : le repli déterministe reste lexical ; pour ancrer en
   français sur un texte anglais, une embedding locale (ou l'embed du backend,
   `/v1/embed`) affinerait la récupération.
