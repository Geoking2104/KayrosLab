# Agent auteur — spécification fonctionnelle et technique

Salon n’est pas un chatbot. Un agent auteur est un **convive** : une voix assise à une table, qui répond depuis des œuvres du domaine public. Cette note corrige le contrat de parole. Elle remplace l’ancien réflexe « coller un passage » par une **réflexion en quatre temps** dont le produit audible est une suite de phrases complètes.

Lié : [`SALON.md`](./SALON.md). Hors périmètre : la console et l’impersonator ([`impersonator-agent.md`](./impersonator-agent.md)).

---

## 1. Problème observé

Les répliques n’étaient pas des phrases intelligibles. Trois causes, souvent cumulées :

1. **Mémoire coupée.** Les passages sont des tranches de 720–900 caractères. Le fallback et, trop souvent, le modèle, recollent le morceau tel quel. Une réplique commence au milieu d’une phrase d’un livre, donc elle n’est pas une réponse.
2. **Récupération lexicale trop pauvre.** Le WASM et le fallback notent des termes ≥ 4 lettres. Une question sur l’optimisme ramène un dîner dans *Candide* parce que « table » coïncide avec le salon. Le livre parle, mais pas de la question.
3. **Contexte trop ornemental, trop peu argumentatif.** Figure, dispositio, empreinte lexicale et échantillon de voix occupaient le system prompt. Rien n’obligeait l’agent à ressaisir la thèse précédente, poser la sienne, l’étayer par une œuvre nommée, avancer le fil.

---

## 2. Définitions

| Concept | Définition |
|---|---|
| **Agent auteur** | Convive identifié par un `id` / `@handle`, un `kind`, un `blurb`, une méthode (`auto` / `rhetorique` / `elenchus`), une liste d’œuvres et des passages. |
| **Question de table** | La question du cercle. Elle reste l’horizon de chaque tour. |
| **Réplique précédente** | Dernier tour (hôte ou auteur) auquel ce tour s’adresse (`move.to`). |
| **Prise** | Une phrase, la thèse que *ce* tour ajoute. Visible sous la réplique. La chaîne des prises est l’évolution de la réflexion. |
| **Réplique** | 3 à 7 phrases complètes, à la première personne, adressées à un destinataire nommé une fois. |
| **Ancrage** | Au plus une citation courte, extraite d’une phrase entière d’une œuvre chargée, nommée. |

---

## 3. Contrat de sortie (obligatoire)

Chaque tour d’agent produit deux champs :

```
PRISE: <une phrase assertive, dans la langue de la question>
REPLIQUE:
<90 à 170 mots, phrases complètes, sans liste, sans titre>
```

La réplique doit, dans l’ordre, sans nommer ces temps :

1. **Ressaisir** — une clause qui dit ce que l’interlocuteur vient de soutenir.
2. **Prendre position** — la prise, dans la voix de l’auteur et selon son rôle (`kind` + `blurb`).
3. **Ancrer** — un seul lieu nommé et, si le passage est pertinent, une phrase entière tissée, jamais un bloc collé.
4. **Avancer** — une conséquence, une distinction, ou une question courte à celui à qui l’on parle.

Interdit : phrase tronquée ; collage d’extrait hors sujet ; œuvre inventée ; répondre à la table entière quand `to` est un nom ; inventaire d’œuvres ; nommer la figure.

Si aucun passage n’est pertinent : le dire, puis argumenter depuis la thèse connue du `blurb` et des titres chargés — jamais fabriquer une citation.

---

## 4. Réflexion (interne, quatre temps)

| Temps | Question interne | Produit |
|---|---|---|
| I. Écoute | Que vient de soutenir l’interlocuteur ? Quelle est la question de table ? | Reformulation fidèle. |
| II. Mémoire | Quel passage *répond* à cette thèse ? | Un passage ou l’aveu d’un manque. |
| III. Jugement | Que puis-je signer avec mes livres, dans mon rôle ? | La **prise**. |
| IV. Parole | Comment le dire en phrases, pour que le tour suivant s’y accroche ? | La **réplique**. |

L’elenchus remplace III–IV par une définition reprise et une seule question, jusqu’à l’aporie.
L’objection accorde un point, puis retourne la thèse. Elle ne vise pas la personne.

---

## 5. Rôle

| `kind` | Devoir de parole |
|---|---|
| philosophe | Distinguer un mot, puis conclure — ou, en elenchus, interroger. |
| écrivain / dramaturge / poète | Montrer une scène ou un être ; le jugement reste dans l’image. |
| essayiste | Une maxime, puis son prix. |
| savant | Un fait observé, puis la limite de ce qu’il prouve. |
| économiste | Un mécanisme nommé, sans morale collée. |
| tradition | Une parole de l’écriture, puis le silence qu’elle ouvre. |

---

## 6–9. Technique, interface, acceptation

Voir le détail dans ce fichier au commit : query enrichie (question + dernière prise), chunks alignés sur la phrase, format PRISE/REPLIQUE, affichage de la prise sous chaque réplique, fallback `composeFromMemory`.

Fichiers : `salon/src/lib/salon/reflect.ts`, `speak.ts`, `catalog.ts`, `rhetoric.ts`, `memory.ts`, `engine.ts`, `types.ts`, `Seance.tsx`.
